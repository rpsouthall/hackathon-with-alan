import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(tmpdir(), `kyoto-multiplayer-check-${randomUUID()}`);
const require = createRequire(join(web, 'package.json'));
const { build } = require('esbuild');
const { Miniflare } = require('miniflare');
const origin = 'https://kyoto-conversations.hello770000.chatgpt.site';
const secret = randomBytes(32).toString('base64url');
const workerPath = join(out, 'worker.mjs');
const wasmPath = join(out, 'rapier_wasm3d_bg.wasm');
const workerSource = await readFile(join(web, 'multiplayer/worker.ts'), 'utf8');
const prefix = `qa_${randomUUID().slice(0, 8)}`;
const results = [];
const findings = [];
const clients = [];
const report = { sourceSha256: createHash('sha256').update(workerSource).digest('hex'), miniflareVersion: require('miniflare/package.json').version, configuredCompatibilityDate: '2026-05-15', testedCompatibilityDate: '2026-05-15', results, findings };
await mkdir(out, { recursive: true });
await build({ entryPoints: [join(web, 'multiplayer/worker.ts')], outfile: workerPath, bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', external: ['cloudflare:workers'], plugins: [{ name: 'rapier-worker', setup(build) {
  build.onResolve({ filter: /^@dimforge\/rapier3d-compat$/ }, () => ({ path: join(web, 'multiplayer/generated-rapier/rapier.mjs') }));
  build.onResolve({ filter: /\.wasm$/ }, () => ({ path: './rapier_wasm3d_bg.wasm', external: true }));
} }] });
await copyFile(join(web, 'multiplayer/generated-rapier/rapier_wasm3d_bg.wasm'), wasmPath);
await build({ stdin: { contents: `export * from ${JSON.stringify(join(web, 'lib/world/hosted-ticket.ts'))}; export * from ${JSON.stringify(join(web, 'lib/world/schema.ts'))}; export * from ${JSON.stringify(join(web, 'lib/world/player-voice-contract.ts'))};`, sourcefile: 'ticket-client.ts', resolveDir: web, loader: 'ts' }, outfile: join(out, 'client-contracts.mjs'), bundle: true, format: 'esm', platform: 'node', target: 'es2022' });
const { PROTOCOL_VERSION, signWorldTicket, serverMessageSchema, playerVoiceServerSchema } = await import(pathToFileURL(join(out, 'client-contracts.mjs')));
const options = {
  compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
  modulesRoot: out, modules: [{ type: 'ESModule', path: workerPath }, { type: 'CompiledWasm', path: wasmPath }],
  durableObjects: { KYOTO_ROOMS: { className: 'KyotoRoom', useSQLite: true } },
  durableObjectsPersist: join(out, `durable-state-${prefix}`),
  bindings: { WORLD_TICKET_SECRET: secret, WORLD_ALLOWED_ORIGINS: origin },
  ratelimits: { WORLD_ADMISSION: { simple: { limit: 120, period: 60 } } },
  cf: false, inspectorPort: undefined,
};
let mf = new Miniflare(options);
const round = (x) => Math.round(x * 100) / 100;
async function check(name, fn) {
  const started = performance.now();
  try { const detail = await fn(); results.push({ name, pass: true, elapsedMs: round(performance.now() - started), ...(detail === undefined ? {} : { detail }) }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, pass: false, elapsedMs: round(performance.now() - started), error: String(error), stack: error.stack }); console.log(`FAIL ${name}: ${error}`); }
}
async function ticket(roomId, name, overrides = {}) {
  const claims = { roomId, name, playerId: randomUUID(), nonce: randomUUID(), expiresAt: Date.now() + 60000, origin, ...overrides };
  return { claims, token: await signWorldTicket(claims, secret) };
}
async function handshake(admission, overrides = {}) {
  const headers = { Upgrade: 'websocket', Origin: origin, 'Sec-WebSocket-Protocol': `kyoto-v${PROTOCOL_VERSION}, ${admission.token}`, ...overrides };
  if (headers.Upgrade === 'http') delete headers.Upgrade;
  return mf.dispatchFetch('https://backend.local/world', { headers });
}
async function until(predicate, label, timeout = 4000) {
  const start = performance.now();
  while (performance.now() - start < timeout) { const result = predicate(); if (result) return result; await sleep(10); }
  throw new Error(`Timed out: ${label}`);
}
async function connect(roomId, name, admission = undefined) {
  admission ??= await ticket(roomId, name);
  const started = performance.now();
  const response = await handshake(admission);
  assert.equal(response.status, 101, `Expected admission for ${name}: ${response.status}`);
  assert.equal(response.headers.get('sec-websocket-protocol'), `kyoto-v${PROTOCOL_VERSION}`);
  const socket = response.webSocket;
  assert.ok(socket);
  const client = { roomId, name, admission, socket, joinedAt: started, playerId: undefined, latest: undefined, welcomes: [], states: [], errors: [], parseErrors: [], closed: undefined, bytes: 0, stateCount: 0, onState: undefined };
  clients.push(client);
  socket.addEventListener('message', (event) => {
    const now = performance.now();
    client.bytes += typeof event.data === 'string' ? Buffer.byteLength(event.data) : event.data.byteLength;
    if (event.data === 'pong') { client.lastPong = now; return; }
    try {
      const data=JSON.parse(event.data);
      const voice=playerVoiceServerSchema.safeParse(data);
      if(voice.success) { (client.voice ??= []).push(voice.data); if(voice.data.type==='voice-peers') client.roster=voice.data.peers; return; }
      const message = serverMessageSchema.parse(data);
      if (message.type === 'welcome') { client.playerId = message.playerId; client.latest = message.snapshot; client.welcomes.push(message); client.joinLatencyMs = now - started; }
      if (message.type === 'state') { client.latest = message; client.stateCount++; client.states.push({ revision: message.revision, at: now }); if (client.states.length > 300) client.states.shift(); client.onState?.(message, now); }
      if (message.type === 'error') client.errors.push(message.message);
    } catch (error) { client.parseErrors.push(String(error)); }
  });
  socket.addEventListener('close', (event) => { client.closed = { code: event.code, reason: event.reason }; });
  socket.addEventListener('error', (event) => client.errors.push(`socket:${event.message ?? 'error'}`));
  socket.accept();
  socket.send(JSON.stringify({ type: 'join', protocol: PROTOCOL_VERSION, roomId, name }));
  await until(() => client.playerId || client.closed, `welcome ${name}`);
  assert.ok(client.playerId, JSON.stringify(client.closed));
  return client;
}
function command(client, command) { client.socket.send(JSON.stringify({ type: 'command', command })); }
function move(client, x, z, yaw = Math.atan2(x, z)) { client.sequence = (client.sequence ?? -1) + 1; command(client, { type: 'move', direction: [x, z], yaw, sequence: client.sequence }); }
function close(client) { try { client.socket.close(1000, 'QA cleanup'); } catch {} }
const sendVoice=(client,message)=>client.socket.send(JSON.stringify(message));
try {
  await check('signed room retains 32 capacity and symmetric maxdegree7 voice rosters', async()=>{
    const room=`${prefix}_voice`;
    const load=await Promise.all(Array.from({length:32},(_,i)=>connect(room,`Voice ${i}`)));
    await until(()=>load.every(c=>c.latest.players.length===32),'32 members');
    for(const c of load) sendVoice(c,{type:'voice-join'});
    await until(()=>load.every(c=>c.roster?.length>0 && c.roster.length<=7),'symmetric rosters');
    for(const c of load) for(const edge of c.roster) assert.ok(load.find(p=>p.playerId===edge.playerId).roster.some(e=>e.playerId===c.playerId && e.sessionId===edge.sessionId));
    assert.equal((await handshake(await ticket(room,'Overflow'))).status,429);
    const a=load[0],edge=a.roster[0],b=load.find(c=>c.playerId===edge.playerId);
    sendVoice(a,{type:'voice-signal',to:b.playerId,sessionId:edge.sessionId,signal:{kind:'offer',sdp:'x'.repeat(16000)}});
    await until(()=>b.voice.some(m=>m.type==='voice-signal' && m.signal.kind==='offer'),'16KB offer');
    assert.equal(b.voice.find(m=>m.type==='voice-signal').from,a.playerId);
    // ICE bursts do not consume the unchanged gameplay quota or action allowance.
    for(let i=0;i<100;i++) sendVoice(a,{type:'voice-signal',to:b.playerId,sessionId:edge.sessionId,signal:{kind:'ice',candidate:null}});
    for(let i=0;i<20;i++) move(a,0,0);
    a.socket.send('ping');await until(()=>a.lastPong,'heartbeat after ICE');assert.equal(a.closed,undefined);
    sendVoice(b,{type:'voice-leave'});await until(()=>!a.roster.some(e=>e.playerId===b.playerId),'leave cleanup');
    sendVoice(a,{type:'voice-signal',to:b.playerId,sessionId:edge.sessionId,signal:{kind:'ice',candidate:null}});
    await until(()=>a.voice.some(m=>m.type==='voice-error'),'stale rejection');
    for(const c of load) {assert.deepEqual(c.parseErrors,[]);close(c);}
  });
  for(const count of [9,17]) await check(`${count} sequential signed joins have no silent newcomer`,async()=>{
    const room=`${prefix}_fair_${count}`,group=[];
    for(let i=0;i<count;i++) {
      const c=await connect(room,`Fair ${i}`);group.push(c);sendVoice(c,{type:'voice-join'});
      if(i>0) await until(()=>group.every(p=>p.roster?.length>0 && p.roster.length<=7),'newcomer voice edge');
    }
    await until(()=>group.every(c=>c.roster.every(edge=>group.find(p=>p.playerId===edge.playerId)?.roster?.some(e=>e.playerId===c.playerId && e.sessionId===edge.sessionId))),'mutual fair edges');
    for(const c of group) {assert.equal(c.closed,undefined);assert.deepEqual(c.parseErrors,[]);close(c);}
  });
  await check('gameplay-only clients get no voice frames and leave clears roster once',async()=>{
    const room=`${prefix}_legacy`,a=await connect(room,'Voice'),b=await connect(room,'Legacy');
    await until(()=>a.latest.players.length===2 && b.latest.players.length===2,'legacy room');
    assert.deepEqual(a.voice??[],[]);assert.deepEqual(b.voice??[],[]);
    sendVoice(a,{type:'voice-join'});await until(()=>a.voice?.length,'opt in response');
    sendVoice(a,{type:'voice-leave'});await until(()=>a.voice?.length===2,'single opt out response');
    move(b,0,0);b.socket.send('ping');await until(()=>b.lastPong,'legacy heartbeat');
    assert.deepEqual(b.voice??[],[]);assert.deepEqual(a.voice.at(-1),{type:'voice-peers',peers:[],iceServers:[],radius:12});
    assert.equal(b.closed,undefined);close(a);close(b);
  });
  await check('spoofed sender is rejected by strict schema', async()=>{
    const c=await connect(`${prefix}_spoof`,'Spoof');
    sendVoice(c,{type:'voice-join',from:'someone_else'});await until(()=>c.closed,'spoof close');assert.equal(c.closed.code,1002);
  });
  await check('oversized SDP is rejected even inside envelope limit', async()=>{
    const c=await connect(`${prefix}_oversize`,'Oversize');
    sendVoice(c,{type:'voice-signal',to:'p',sessionId:'s',signal:{kind:'offer',sdp:'x'.repeat(16001)}});
    await until(()=>c.closed,'oversize close');assert.equal(c.closed.code,1002);
  });
  await check('unjoined sockets cannot opt into voice', async()=>{
    const admission=await ticket(`${prefix}_unjoined`,'Unjoined');const r=await handshake(admission);const ws=r.webSocket;ws.accept();
    let code;ws.addEventListener('close',e=>code=e.code);ws.send(JSON.stringify({type:'voice-join'}));await until(()=>code,'join first');assert.equal(code,1008);
  });
  await check('existing nonmove action rate limit still applies', async()=>{
    const c=await connect(`${prefix}_actions`,'Actions');for(let i=0;i<11;i++)command(c,{type:'interact',npcId:'cafe_owner'});
    await until(()=>c.closed,'action limit');assert.equal(c.closed.code,1008);
  });
  await check('NPC voice is explicitly unavailable',async()=>{
    const c=await connect(`${prefix}_npc`,'NPC');sendVoice(c,{type:'npc-listen-join'});
    await until(()=>c.voice?.some(m=>m.type==='voice-error' && m.message.includes('unavailable')),'NPC unavailable');close(c);
  });
} finally {
  for(const client of clients) close(client);
  await mf.dispose();
  report.passCount=results.filter(r=>r.pass).length;report.failCount=results.filter(r=>!r.pass).length;
  await writeFile(join(out,'results.json'),JSON.stringify(report,null,2));
  console.log('Report:',join(out,'results.json'));console.log(JSON.stringify({passCount:report.passCount,failCount:report.failCount}));
}
process.exitCode=report.failCount?1:0;
