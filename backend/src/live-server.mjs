import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { aikoSession } from './live-config.mjs';
import { closeLiveSession } from './live-close.mjs';

// Local-only test server. No secrets are served. Port is fixed for strict Host/Origin checks.
export function createLiveServer({ key, fetchImpl = fetch, closeSession = closeLiveSession, limitMs = 120000 } = {}) {
  const origin = 'http://localhost:8787';
  const sessions = new Map();
  let creating = false;
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
  async function hangup(ticket) {
    const entry = sessions.get(ticket);
    if (!entry) return true;
    try {
      if (!await closeSession(entry.id, key)) return false;
      clearTimeout(entry.timer); sessions.delete(ticket); return true;
    } catch { return false; }
  }
  const server = createServer(async (req, res) => {
    const reply = (status, data) => { res.writeHead(status, { ...headers, 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      if (req.headers.host !== 'localhost:8787') { reply(403,{error:'Use localhost:8787.'}); return; }
      if (req.method === 'GET' && ['/','/voice-test.js','/webrtc-offer.mjs','/live-config.mjs'].includes(req.url)) {
        const path = req.url === '/' ? '../public/voice-test.html' : req.url === '/live-config.mjs' ? './live-config.mjs' : `../public${req.url}`;
        const source = await readFile(new URL(path,import.meta.url));
        res.writeHead(200,{...headers,'content-type':req.url==='/'?'text/html; charset=utf-8':'text/javascript; charset=utf-8'});res.end(source);return;
      }
      if (req.method === 'GET' && req.url === '/api/health') {reply(200,{configured:Boolean(key),model:'gpt-live-1'});return;}
      if (req.method !== 'POST' || req.headers.origin !== origin || !['/api/live/session','/api/live/stop'].includes(req.url)) {reply(403,{error:'Request not allowed.'});return;}
      if (!key) {reply(503,{error:'OpenAI key is not configured.'});return;}
      let body='';
      for await(const chunk of req) {body+=chunk;if(Buffer.byteLength(body)>65536){reply(413,{error:'Request too large.'});return;}}
      let input;try{input=JSON.parse(body);if(!input || typeof input!=='object')throw new Error();}catch{reply(400,{error:'Invalid JSON.'});return;}
      if (req.url==='/api/live/stop') {
        if(typeof input.ticket!=='string'){reply(400,{error:'Missing session ticket.'});return;}
        const stopped=await hangup(input.ticket);reply(stopped?200:502,{stopped});return;
      }
      if(typeof input.sdp!=='string' || !input.sdp.startsWith('v=0') || input.sdp.length>60000){reply(400,{error:'Valid connection offer required.'});return;}
      if(creating || sessions.size){reply(409,{error:'End the existing voice test before starting another.'});return;}
      creating=true;
      try {
        const r=await fetchImpl('https://api.openai.com/v1/live/sessions',{
          method:'POST',headers:{Authorization:`Bearer ${key}`,'content-type':'application/json'},
          body:JSON.stringify({session:aikoSession(),transport:{type:'webrtc',sdp:input.sdp}}),signal:AbortSignal.timeout(30000),
        });
        let data;
        try { data=await r.json(); }
        catch {
          console.error('Live response was not JSON:', r.status);
          reply(502,{error:'The voice service returned an unreadable response. Please retry.'});return;
        }
        if(!r.ok) {
          const code=data.error?.code;
          const message=code==='insufficient_quota'?'The OpenAI project has no available API quota. Check credit redemption.':r.status===401?'OpenAI rejected the API key.':r.status===403||r.status===404?'This project cannot start GPT-Live sessions.':r.status===429?'OpenAI rate limit or quota reached.':'OpenAI could not start the voice session.';
          console.error('Live startup failed:',r.status, typeof code==='string'?code:'unknown');reply(r.status,{error:message});return;
        }
        if(typeof data.session?.id!=='string'){reply(502,{error:'Unexpected OpenAI session response.'});return;}
        const ticket=randomUUID();
        const entry={id:data.session.id,timer:null};sessions.set(ticket,entry);
        entry.timer=setTimeout(async()=>{
          if(!await hangup(ticket)) { console.error('Voice session hangup failed; retrying.');entry.timer=setTimeout(()=>void hangup(ticket),5000); }
        },limitMs);entry.timer.unref();
        if(typeof data.transport?.sdp!=='string'){await hangup(ticket);reply(502,{error:'Unexpected OpenAI session response.'});return;}
        reply(201,{ticket,session:{id:data.session.id},transport:{type:'webrtc',sdp:data.transport.sdp},limitMs});
      } finally {creating=false;}
    } catch (error) {
      // Log only error classifications, never credentials, SDP or upstream bodies.
      const code=error.cause?.code || error.code;
      console.error('Live request failed:', error.name, typeof code==='string'?code:'unknown');
      const timeout=error.name==='TimeoutError' || code==='UND_ERR_CONNECT_TIMEOUT';
      reply(timeout?504:502,{error:timeout?'The voice service took too long to connect. Please retry.':'The local voice server could not reach OpenAI. Please retry or restart the voice server.'});
    }
  });
  return {server,closeSessions:()=>Promise.all([...sessions.keys()].map(hangup))};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const app=createLiveServer({key:process.env.OPENAI_API_KEY});
  app.server.listen(8787,'127.0.0.1',()=>console.log('Aiko voice test: http://localhost:8787/'));
  let closing=false;
  const shutdown=async()=>{if(closing)return;closing=true;await app.closeSessions();app.server.close(()=>process.exit(0));};
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
}
