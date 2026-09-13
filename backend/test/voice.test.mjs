import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/handler.mjs';
import { parseTranslationEvent, textTranslationCommand } from '../src/client.mjs';
const env = { LIVEAVATAR_API_KEY: 'private-key', LIVEAVATAR_AVATAR_ID: 'avatar', INWORLD_API_KEY: 'inworld-secret', DEMO_ACCESS_CODE: 'demo', ALLOWED_ORIGIN: 'https://cafe.test' };
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
    return calls.length === 1 ? response({session_token:'scoped-token'}) : response({session_id:'session', livekit_url:'wss://room', ws_url:'wss://avatar', livekit_client_token:'client', livekit_agent_token:'NEVER-EXPOSE'});
  };
  const r = await createHandler(env, fetcher)(request());
  assert.equal(r.status, 201);
  const data = await r.json(); assert.equal(data.roomId, 'session'); assert.equal(data.sessionToken, 'scoped-token');
  assert.ok(!JSON.stringify(data).includes('NEVER-EXPOSE')); assert.ok(!JSON.stringify(data).includes('private-key'));
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.mode,'LITE'); assert.equal(payload.elevenlabs_agent_config,undefined); assert.equal(data.avatarWebsocketUrl,'wss://avatar');
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
test('parses Inworld transcript and translation', () => {
  assert.deepEqual(parseTranslationEvent({type:'conversation.item.input_audio_transcription.completed',transcript:'こんにちは',item_id:'1'}), {type:'transcript',language:'ja',text:'こんにちは',utteranceId:'1'});
  assert.equal(parseTranslationEvent(null),null);
  assert.equal(JSON.parse(textTranslationCommand(' コーヒー ')).text,'コーヒー');
});

import { inputEvents, sessionConfig } from '../src/inworld.mjs';
import { avatarCommand } from '../src/client.mjs';
test('relay prevents clients overriding model or role', () => {
  assert.throws(()=>inputEvents({type:'session.update',session:{}}));
  assert.throws(()=>inputEvents({type:'audio',audio:'not base64!'}));
  assert.equal(inputEvents({type:'text',text:'こんにちは'})[0].item.role,'user');
  assert.equal(sessionConfig({}).session.providerData.stt.language_hints[0],'ja-JP');
});
test('audio and interruption map to HeyGen LITE commands', () => {
  assert.deepEqual(avatarCommand({type:'response.output_audio.delta',delta:'AAAA'}),{type:'agent.speak',audio:'AAAA'});
  assert.deepEqual(avatarCommand({type:'response.output_audio.done'}),{type:'agent.speak_end'});
  assert.deepEqual(avatarCommand({type:'input_audio_buffer.speech_started'}),{type:'agent.interrupt'});
});
