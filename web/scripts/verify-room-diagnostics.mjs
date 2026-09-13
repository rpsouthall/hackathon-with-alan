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
      if(data.type==='diagnostic-pong') { (client.diagnostics??=[]).push(data); return; }
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
function close(client) { try { client.socket.close(1000, 'QA cleanup'); } catch {} }

try {
  await check('health exposes APAC new-room generation and current gameplay protocol',async()=>{
    const health=await(await mf.dispatchFetch('https://backend.local/health')).json();
    assert.equal(health.locationHint,'apac');assert.equal(health.roomGeneration,'v3-apac');assert.equal(health.protocol,PROTOCOL_VERSION);return health;
  });
  await check('signed clients share a room, and only opt-in caller receives diagnostics',async()=>{
    const room=`${prefix}_diag`,a=await connect(room,'Probe'),b=await connect(room,'Ordinary');
    await until(()=>a.latest.players.length===2 && b.latest.players.length===2,'shared room');
    assert.deepEqual(a.diagnostics??[],[]);assert.deepEqual(b.diagnostics??[],[]);
    a.socket.send(JSON.stringify({type:'diagnostic-ping',id:1}));
    await until(()=>a.diagnostics?.length,'diagnostic reply');
    const r=a.diagnostics[0];assert.equal(r.id,1);assert.equal(r.players,2);assert.equal(r.tick.targetIntervalMs,50);assert.ok(r.tick.samples>0);assert.equal(r.tick.cpuMs,null);
    if(r.tick.processingClock==='below-clock-resolution')assert.equal(r.tick.processingWallMs,null);
    b.socket.send('ping');await until(()=>b.lastPong,'legacy pong');
    assert.deepEqual(b.diagnostics??[],[]);assert.deepEqual(b.parseErrors,[]);assert.equal(b.closed,undefined);
    close(a);close(b);return r;
  });
  await check('diagnostics reject prejoin, malformed and excessive requests',async()=>{
    const admission=await ticket(`${prefix}_prejoin`,'Before join');const response=await handshake(admission);const ws=response.webSocket;ws.accept();
    let code;ws.addEventListener('close',e=>code=e.code);ws.send(JSON.stringify({type:'diagnostic-ping',id:1}));await until(()=>code,'prejoin rejection');assert.equal(code,1008);
    const malformed=await connect(`${prefix}_invalid`,'Malformed');malformed.socket.send(JSON.stringify({type:'diagnostic-ping',id:1,from:'other'}));await until(()=>malformed.closed,'strict rejection');assert.equal(malformed.closed.code,1002);
    const rapid=await connect(`${prefix}_rapid`,'Rapid');for(let i=0;i<2;i++)rapid.socket.send(JSON.stringify({type:'diagnostic-ping',id:i}));await until(()=>rapid.closed,'quota rejection');assert.equal(rapid.closed.code,1008);
  });
} finally {
  for(const client of clients)close(client);await mf.dispose();
  report.passCount=results.filter(r=>r.pass).length;report.failCount=results.filter(r=>!r.pass).length;
  await writeFile(join(out,'results.json'),JSON.stringify(report,null,2));console.log('Report:',join(out,'results.json'));console.log(JSON.stringify({passCount:report.passCount,failCount:report.failCount}));
}
process.exitCode=report.failCount?1:0;
