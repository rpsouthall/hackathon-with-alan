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
await build({ stdin: { contents: `export * from ${JSON.stringify(join(web, 'lib/world/hosted-ticket.ts'))}; export * from ${JSON.stringify(join(web, 'lib/world/schema.ts'))}; export * from ${JSON.stringify(join(web, 'lib/world/navigation.ts'))}; export * from ${JSON.stringify(join(web, 'lib/world/venues.ts'))};`, sourcefile: 'ticket-client.ts', resolveDir: web, loader: 'ts' }, outfile: join(out, 'client-contracts.mjs'), bundle: true, format: 'esm', platform: 'node', target: 'es2022' });
const { PROTOCOL_VERSION, signWorldTicket, appearanceSchema, serverMessageSchema, createWalkingMap, venueForNpc, isInsideVenue, canTalkToNpc } = await import(pathToFileURL(join(out, 'client-contracts.mjs')));
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
      const message = serverMessageSchema.parse(JSON.parse(event.data));
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
const position = (client, id = client.playerId) => client.latest?.players.find(p => p.id === id)?.position;
async function follow(client, points) {
  for (const [x, z] of points) {
    const start = performance.now();
    while (true) {
      const p = position(client), dx = x - p[0], dz = z - p[2], distance = Math.hypot(dx, dz);
      if (distance < 0.12) break;
      if (performance.now() - start > 18000) throw new Error(`Unreachable ${x},${z} from ${JSON.stringify(p)}`);
      move(client, dx / Math.max(distance, 0.3), dz / Math.max(distance, 0.3));
      await sleep(50);
    }
  }
  move(client, 0, 0); await sleep(120);
}

let alice, bob, charlie;
try {
  await check(`health exposes protocol ${PROTOCOL_VERSION} and room capacity 32`, async () => {
    const response = await mf.dispatchFetch('https://backend.local/health'); const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.capacity, 32); assert.equal(body.protocol, PROTOCOL_VERSION); return body;
  });
  await check('invalid, expired, future and wrong-origin tickets are rejected', async () => {
    const valid = await ticket(`${prefix}_invalid`, 'Admission');
    const cases = [
      ['wrong origin', valid, { Origin: 'https://attacker.invalid' }, 403],
      ['missing upgrade', valid, { Upgrade: 'http' }, 426],
      ['missing ticket protocol', valid, { 'Sec-WebSocket-Protocol': `kyoto-v${PROTOCOL_VERSION}` }, 401],
      ['malformed token', { token: 'malformed' }, {}, 401],
      ['tampered signature', { token: valid.token.slice(0, valid.token.lastIndexOf('.') + 1) + 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }, {}, 401],
      ['expired', await ticket(`${prefix}_invalid`, 'Expired', { expiresAt: Date.now() - 1 }), {}, 401],
      ['future', await ticket(`${prefix}_invalid`, 'Future', { expiresAt: Date.now() + 120000 }), {}, 401],
      ['claim origin mismatch', await ticket(`${prefix}_invalid`, 'Mismatch', { origin: 'https://different.invalid' }), {}, 401],
    ];
    for (const [name, admission, headers, expected] of cases) assert.equal((await handshake(admission, headers)).status, expected, name);
    return { cases: cases.length };
  });
  await check('signed joins share one room and full NPC cast', async () => {
    alice = await connect(`${prefix}_shared`, 'Alice'); bob = await connect(`${prefix}_shared`, 'Bob');
    await until(() => alice.latest.players.length === 2 && bob.latest.players.length === 2, 'two shared peers');
    assert.equal(alice.latest.npcs.length, 15); assert.equal(bob.latest.npcs.length, 15);
    return { joinLatencyMs: [round(alice.joinLatencyMs), round(bob.joinLatencyMs)] };
  });
  await check('appearance changes replicate to the other peer', async () => {
    command(alice, { type: 'set-appearance', appearance: appearanceSchema.parse({ hair: 'topknot', height: 2.1, top: '#2255aa', bag: true }) });
    await until(() => bob.latest.players.find(p => p.id === alice.playerId)?.appearance.top === '#2255aa', 'appearance');
    assert.equal(bob.latest.players.find(p => p.id === alice.playerId).appearance.height, 2.1);
  });
  await check('movement is authoritative and replicates to both peers', async () => {
    const before = position(bob, alice.playerId)[2];
    for (let i = 0; i < 12; i++) { move(alice, 0, -1); await sleep(50); }
    move(alice, 0, 0); await sleep(150);
    assert.ok(position(bob, alice.playerId)[2] < before - 1.0);
    assert.deepEqual(position(alice), position(bob, alice.playerId));
    assert.ok(Math.abs(position(bob)[2] - 10) < 0.05);
    return { movedMetres: round(before - position(bob, alice.playerId)[2]) };
  });
  await check('different room codes are isolated', async () => {
    charlie = await connect(`${prefix}_isolated`, 'Charlie');
    await sleep(100); assert.equal(charlie.latest.players.length, 1); assert.equal(alice.latest.players.length, 2); assert.equal(charlie.latest.roomId, `${prefix}_isolated`);
    assert.ok(!charlie.latest.players.some(p => p.id === alice.playerId));
  });
  await check('ticket replay and simultaneous replay are rejected', async () => {
    assert.equal((await handshake(alice.admission)).status, 401);
    const admission = await ticket(`${prefix}_race`, 'Race');
    const responses = await Promise.all([handshake(admission), handshake(admission)]);
    assert.deepEqual(responses.map(r => r.status).sort(), [101, 401]);
    for (const r of responses) if (r.webSocket) { r.webSocket.accept(); r.webSocket.close(1000, 'QA cleanup'); }
  });
  await check('signed identity cannot be replaced with forged internal claims', async () => {
    const admission = await ticket(`${prefix}_forged`, 'Signed');
    const response = await handshake(admission, { 'x-kyoto-claims': JSON.stringify({ ...admission.claims, name: 'Forged', roomId: `${prefix}_shared` }) });
    assert.equal(response.status, 101); const socket = response.webSocket; socket.accept();
    const messages = []; socket.addEventListener('message', e => { if (e.data !== 'pong') messages.push(JSON.parse(e.data)); });
    socket.send(JSON.stringify({ type: 'join', protocol: PROTOCOL_VERSION, roomId: `${prefix}_shared`, name: 'Forged' }));
    await until(() => messages.some(m => m.type === 'error'), 'forged identity rejection');
    assert.ok(!messages.some(m => m.type === 'welcome')); socket.close(1000, 'QA cleanup');
  });
  await check('NPC turn ownership and disconnect cleanup propagate', async () => {
    const environment = alice.welcomes[0].snapshot.environment;
    const tutor = alice.latest.npcs.find(npc => npc.id === 'cafe_owner');
    const venue = venueForNpc(environment, tutor.id);
    const map = await createWalkingMap(environment);
    await Promise.all([alice, bob].map(async client => {
      const route = map.route(position(client), tutor, point => !venue || isInsideVenue(venue, point));
      assert.ok(route?.length, 'The encounter route must enter the current cafe through its doorway');
      await follow(client, route.map(point => [point[0], point[2]]));
      assert.ok(canTalkToNpc(environment, tutor, position(client)), 'The learner is inside and within tutor range');
    }));
    command(alice, { type: 'interact', npcId: 'cafe_owner' });
    const encounter = await until(() => bob.latest.encounters.find(e => e.npcId === 'cafe_owner'), 'cafe encounter');
    command(bob, { type: 'join-encounter', encounterId: encounter.id });
    await until(() => alice.latest.encounters.find(e => e.id === encounter.id)?.participantIds.length === 2, 'two encounter participants');
    command(alice, { type: 'claim-turn', encounterId: encounter.id });
    await until(() => bob.latest.encounters.find(e => e.id === encounter.id)?.speakerId === alice.playerId, 'Alice turn');
    command(bob, { type: 'claim-turn', encounterId: encounter.id });
    await until(() => bob.errors.some(e => e.includes('Another learner')), 'exclusive speaker');
    close(alice);
    await until(() => bob.latest.players.length === 1 && bob.latest.encounters.find(e => e.id === encounter.id)?.speakerId === null, 'disconnect cleanup');
    assert.equal(bob.latest.encounters[0].ownerId, bob.playerId); assert.deepEqual(bob.latest.encounters[0].participantIds, [bob.playerId]);
    command(bob, { type: 'leave-encounter' }); await until(() => bob.latest.encounters.length === 0, 'empty encounter cleanup');
    assert.equal((await handshake(alice.admission)).status, 401, 'closed-ticket replay');
  });
  await check('32 clients exchange movement at 20 Hz and reject a 33rd admission', async () => {
    const room = `${prefix}_load`;
    const load = await Promise.all(Array.from({ length: 32 }, (_, i) => connect(room, `Learner ${i + 1}`)));
    await until(() => load.every(c => c.latest.players.length === 32), 'all 32 player schemas accepted', 8000);
    assert.equal((await handshake(await ticket(room, 'Overflow'))).status, 429);
    const probe = load[0], pending = new Map(), latencies = [];
    const startBytes = load.reduce((n, c) => n + c.bytes, 0), startStates = load.map(c => c.stateCount);
    let acknowledged = 0, sent = 0;
    probe.onState = (state, now) => {
      for (const p of state.players) {
        const key = `${p.id}:${p.yaw}`, start = pending.get(key);
        if (start !== undefined) { latencies.push(now - start); pending.delete(key); acknowledged++; }
      }
    };
    const started = performance.now(), frames = 120;
    for (let frame = 0; frame < frames; frame++) {
      const target = started + frame * 50; if (performance.now() < target) await sleep(target - performance.now());
      const direction = frame % 40 < 20 ? -1 : 1;
      for (let i = 0; i < load.length; i++) {
        const yaw = -3 + frame * 0.001 + i * 0.000001;
        pending.set(`${load[i].playerId}:${yaw}`, performance.now()); move(load[i], 0, direction, yaw); sent++;
      }
    }
    await sleep(250);
    const elapsed = performance.now() - started;
    for (const client of load) { move(client, 0, 0); assert.equal(client.closed, undefined); assert.deepEqual(client.errors, []); assert.deepEqual(client.parseErrors, []); assert.equal(client.latest.players.length, 32); }
    const sorted = [...latencies].sort((a, b) => a - b);
    const percentile = p => round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0);
    const stateCounts = load.map((c, i) => c.stateCount - startStates[i]);
    const detail = { players: 32, targetInputHzPerPlayer: 20, elapsedMs: round(elapsed), inputFramesPerPlayer: frames, inputMessages: sent, aggregateInputsPerSecond: round(sent / (elapsed / 1000)), observedInputYawSamples: acknowledged, coalescedOrUnobservedSamples: pending.size, stateFramesPerClient: { min: Math.min(...stateCounts), max: Math.max(...stateCounts) }, probeObservedInputToStateMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99), max: round(sorted.at(-1) ?? 0) }, totalOutboundBytes: load.reduce((n, c) => n + c.bytes, 0) - startBytes, errors: 0, schemaErrors: 0, note: 'Local Miniflare/workerd; includes Node-side parsing for all 32 clients. Does not measure WAN latency or Cloudflare production CPU limits.' };
    report.load = detail;
    assert.ok(stateCounts.every(n => n >= 90), `Too few state updates: ${JSON.stringify(stateCounts)}`);
    assert.ok(acknowledged >= sent * 0.7, `Too many movement rounds coalesced: ${acknowledged}/${sent}`);
    close(load[31]); await until(() => probe.latest.players.length === 31, 'capacity cleanup');
    const replacement = await connect(room, 'Replacement'); await until(() => probe.latest.players.length === 32, 'replacement admission');
    assert.equal(replacement.latest.players.length, 32);
    for (const client of load) close(client); close(replacement);
    return detail;
  });
  await check('action floods are disconnected without amplifying room broadcasts', async () => {
    const room = `${prefix}_flood`, observer = await connect(room, 'Observer'), sender = await connect(room, 'Rapid actions');
    await until(() => observer.latest.players.length === 2, 'flood room members');
    const before = observer.stateCount;
    for (let i = 0; i < 30; i++) command(sender, { type: 'interact', npcId: 'cafe_owner' });
    await until(() => sender.closed, 'action rate limit');
    assert.equal(sender.closed.code, 1008);
    await until(() => observer.latest.players.length === 1, 'flood disconnect cleanup');
    assert.ok(observer.stateCount - before < 10, `Action burst caused ${observer.stateCount - before} broadcasts`);
    close(observer);
  });
  await check('anonymous admission bursts are rate limited before room allocation', async () => {
    const admission = await ticket(`${prefix}_admission_limit`, 'Admission limit');
    let limited = false;
    for (let i = 0; i < 130; i++) {
      const response = await handshake(admission, { 'CF-Connecting-IP': '198.51.100.224' });
      if (response.webSocket) { response.webSocket.accept(); response.webSocket.close(1000, 'QA cleanup'); }
      if (response.status === 429) { limited = true; break; }
    }
    assert.equal(limited, true);
  });
  await check('all inspected protocol messages remain valid', async () => {
    const errors = clients.flatMap(c => c.parseErrors.map(error => ({ client: c.name, error })));
    assert.deepEqual(errors, []); return { inspectedConnections: clients.length };
  });
  for (const client of clients) close(client);
  await sleep(100);
  await check('single-use ticket protection survives a Worker restart', async () => {
    const admission = await ticket(`${prefix}_restart`, 'Restart');
    const first = await connect(admission.claims.roomId, admission.claims.name, admission); close(first); await sleep(100);
    assert.equal((await handshake(admission)).status, 401);
    await mf.dispose(); mf = new Miniflare(options);
    const response = await handshake(admission);
    if (response.webSocket) { response.webSocket.accept(); response.webSocket.close(1000, 'QA cleanup'); }
    if (response.status === 101) findings.push({ severity: 'medium', issue: 'A consumed ticket can be reused after the Worker/DO restarts while its 60-second lifetime remains valid. usedTickets is only an in-memory Map.', recommendation: 'Persist consumed nonce and expiry atomically in Durable Object storage; expire rows on admission or alarm.' });
    assert.equal(response.status, 401, 'Consumed ticket accepted after runtime restart');
  });
} finally {
  for (const client of clients) close(client);
  await mf.dispose();
  report.completedAt = new Date().toISOString(); report.passCount = results.filter(r => r.pass).length; report.failCount = results.filter(r => !r.pass).length;
  await writeFile(join(out, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('Report:', join(out, 'results.json'));
  console.log(JSON.stringify({ passCount: report.passCount, failCount: report.failCount, load: report.load, findings }, null, 2));
}
process.exitCode = report.failCount ? 1 : 0;
