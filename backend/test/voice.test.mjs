import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/handler.mjs';
import { parseTranslationEvent, textTranslationCommand } from '../src/client.mjs';
const env = { LIVEAVATAR_API_KEY: 'private-key', LIVEAVATAR_AVATAR_ID: 'avatar', LIVEAVATAR_ELEVENLABS_SECRET_ID: 'secret', ELEVENLABS_AGENT_ID: 'agent', DEMO_ACCESS_CODE: 'demo', ALLOWED_ORIGIN: 'https://cafe.test' };
const request = (path='/api/sessions', headers={}) => new Request(`https://cafe.test${path}`, { method: 'POST', headers: { origin: 'https://cafe.test', 'x-demo-access-code': 'demo', ...headers } });
const response = data => Response.json({ data });
test('fails closed without credentials and does not contact providers', async () => {
  const r = await createHandler({}, () => assert.fail())(request()); assert.equal(r.status, 503);
});
test('rejects incorrect access code before spending provider credits', async () => {
  const r = await createHandler(env, () => assert.fail())(request(undefined, { 'x-demo-access-code': 'wrong' })); assert.equal(r.status, 401);
});
test('rejects foreign browser origins', async () => {
  assert.equal((await createHandler(env, () => assert.fail())(request(undefined, { origin: 'https://other.test' }))).status, 403);
});
test('starts connector session and exposes only browser-scoped credentials', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({url, options});
    return calls.length === 1 ? response({session_token:'scoped-token'}) : response({session_id:'session', livekit_url:'wss://room', livekit_client_token:'client', livekit_agent_token:'NEVER-EXPOSE'});
  };
  const r = await createHandler(env, fetcher)(request());
  assert.equal(r.status, 201);
  const data = await r.json(); assert.equal(data.roomId, 'session'); assert.equal(data.sessionToken, 'scoped-token');
  assert.ok(!JSON.stringify(data).includes('NEVER-EXPOSE')); assert.ok(!JSON.stringify(data).includes('private-key'));
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.mode,'LITE'); assert.equal(payload.elevenlabs_agent_config.agent_id,'agent');
  assert.equal(calls[1].options.headers.Authorization,'Bearer scoped-token');
});
test('cleans up session after startup failure and redacts upstream errors', async () => {
  let calls = 0;
  const r = await createHandler(env, async () => {
    calls++;
    if(calls===1) return response({session_token:'scoped-token'});
    if(calls===2) return new Response('sensitive upstream diagnostic', {status:500});
    return response(null);
  })(request());
  assert.equal(r.status,502); assert.equal(calls,3); assert.ok(!(await r.text()).includes('sensitive'));
});
test('stops only using the supplied session-scoped token', async () => {
  let seen;
  const r = await createHandler(env, async (_,options) => { seen=options; return response(null); })(request('/api/sessions/stop',{authorization:'Bearer session-token'}));
  assert.equal(r.status,200); assert.equal(seen.headers.Authorization,'Bearer session-token'); assert.equal(seen.headers['X-API-KEY'],undefined);
});
test('missing stop token rejected without upstream call', async () => {
  assert.equal((await createHandler(env,()=>assert.fail())(request('/api/sessions/stop'))).status,400);
});
test('parses Japanese transcript and English translation without double-consuming wrapper events', () => {
  const encode = x => new TextEncoder().encode(JSON.stringify(x));
  assert.deepEqual(parseTranslationEvent(encode({event_type:'elevenlabs_agent_event',elevenlabs_event_type:'user_transcript',data:{user_transcription_event:{user_transcript:'コーヒーをください。'}}}),'agent-response'),{type:'transcript',language:'ja',text:'コーヒーをください。'});
  assert.deepEqual(parseTranslationEvent(encode({event_type:'elevenlabs_agent_event',elevenlabs_event_type:'agent_response',data:{agent_response_event:{agent_response:'A coffee, please.'}}}),'agent-response'),{type:'translation',language:'en',text:'A coffee, please.'});
  assert.equal(parseTranslationEvent(encode({event_type:'avatar.transcription'}),'agent-response'),null);
  assert.equal(parseTranslationEvent(encode(null),'agent-response'),null);
});
test('text fallback preserves Japanese in documented connector command', () => {
  const command = JSON.parse(new TextDecoder().decode(textTranslationCommand(' コーヒー ')));
  assert.equal(command.data.text,'コーヒー'); assert.equal(command.data.type,undefined);
  assert.throws(()=>textTranslationCommand(''));
});
