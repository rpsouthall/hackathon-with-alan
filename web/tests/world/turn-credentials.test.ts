import test from "node:test";
import assert from "node:assert/strict";
import { TurnCredentialsSession, TURN_REFRESH_MS, TURN_RETRY_MS, TURN_TTL_SECONDS, type TurnUpdate } from "../../multiplayer/turn-credentials";

const secrets = { TURN_KEY_ID: "fake-key-id", TURN_KEY_API_TOKEN: "fake-server-only-token" };
const credentials = (suffix = "one") => ({ iceServers: [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
  { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"], username: `fake-user-${suffix}`, credential: `fake-credential-${suffix}` },
] });
const reply = (suffix?: string) => Response.json(credentials(suffix), { status: 201 });
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture(fetcher: typeof fetch, configured = secrets) {
  let now = 1000;
  const updates: TurnUpdate[] = [];
  const session = new TurnCredentialsSession(configured, { fetcher, now: () => now });
  return { session, updates, tick: () => session.tick((update) => updates.push(update)), at: (time: number) => { now = time; } };
}
test("TURN never calls provider before voice opt-in and missing configuration is an honest direct fallback", async () => {
  let calls = 0; const f = fixture(async () => { calls++; return reply(); }, { TURN_KEY_ID: "", TURN_KEY_API_TOKEN: "" });
  await f.tick(); assert.equal(calls, 0); assert.equal(f.updates.length, 0);
  f.session.enable(); await f.tick(); await f.tick();
  assert.equal(calls, 0); assert.equal(f.updates.length, 1); assert.equal(f.updates[0].status, "unavailable");
  assert.match(f.updates[0].message, /direct/); f.session.dispose();
});
test("TURN request uses server-only token, bounded TTL and no redirects; preserves UDP and TLS browser fallbacks", async () => {
  const f = fixture(async (url, init) => {
    assert.equal(url, "https://rtc.live.cloudflare.com/v1/turn/keys/fake-key-id/credentials/generate-ice-servers");
    assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "manual");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fake-server-only-token");
    assert.deepEqual(JSON.parse(init?.body as string), { ttl: 3600 }); return reply();
  });
  f.session.enable(); await f.tick();
  assert.deepEqual(f.updates.map((update) => update.status), ["pending", "ready"]);
  assert.equal(f.updates[1].iceServers.length, 2); assert.doesNotMatch(JSON.stringify(f.updates), /server-only-token|:53/);
  assert.match(JSON.stringify(f.updates[1]), /transport=udp/); assert.match(JSON.stringify(f.updates[1]), /turns:/); f.session.dispose();
});
test("repeated joins and ticks share one request and reuse credentials within an admitted socket", async () => {
  let calls = 0, resolve!: (response: Response) => void;
  const f = fixture(async () => { calls++; return new Promise((done) => { resolve = done; }); });
  f.session.enable(); const pending = f.tick();
  for (let i = 0; i < 100; i++) { f.session.enable(); assert.equal(f.tick(), undefined); }
  assert.equal(calls, 1); resolve(reply()); await pending;
  f.session.disable(); f.session.enable(); await f.tick();
  assert.equal(calls, 1); assert.equal(f.updates.at(-1)?.status, "ready"); f.session.dispose();
});
for (const action of ["disable", "dispose"] as const) test(`${action} aborts pending TURN and a late response cannot restore credentials`, async () => {
  let resolve!: (response: Response) => void, signal: AbortSignal | undefined;
  const f = fixture(async (_url, init) => { signal = init?.signal as AbortSignal; return new Promise((done) => { resolve = done; }); });
  f.session.enable(); const pending = f.tick(); f.session[action]();
  assert.equal(signal?.aborted, true); resolve(reply()); await pending;
  assert.deepEqual(f.updates.map((update) => update.status), ["pending"]); assert.equal(f.tick(), undefined);
});
test("a stale completion cannot overwrite a later opt-in request", async () => {
  const resolvers: ((response: Response) => void)[] = [];
  const f = fixture(async () => new Promise((done) => resolvers.push(done)));
  f.session.enable(); const old = f.tick(); f.session.disable(); f.at(1000 + TURN_RETRY_MS); f.session.enable(); const fresh = f.tick();
  resolvers[1](reply("new")); await fresh; resolvers[0](reply("old")); await old;
  assert.match(JSON.stringify(f.updates.at(-1)), /fake-credential-new/); assert.doesNotMatch(JSON.stringify(f.updates), /fake-credential-old/); f.session.dispose();
});
test("credentials refresh at 50 minutes and expired credentials are never redispatched after a provider failure", async () => {
  let calls = 0;
  const f = fixture(async () => ++calls === 1 ? reply() : new Response("fake-sensitive-provider-body", { status: 503 }));
  f.session.enable(); await f.tick(); f.at(1000 + TURN_REFRESH_MS - 1); await f.tick(); assert.equal(calls, 1);
  f.at(1000 + TURN_REFRESH_MS); await f.tick(); assert.equal(calls, 2); assert.equal(f.updates.at(-1)?.status, "ready");
  f.at(1000 + TURN_TTL_SECONDS * 1000); await f.tick(); assert.equal(f.updates.at(-1)?.status, "unavailable");
  assert.doesNotMatch(JSON.stringify(f.updates.at(-1)), /credential|sensitive/); f.session.dispose();
});
test("failure retries are bounded even across repeated opt-outs", async () => {
  let calls = 0; const f = fixture(async () => { calls++; throw new Error("fake-secret-provider-failure"); });
  f.session.enable(); await f.tick();
  for (let i = 0; i < 100; i++) { f.session.disable(); f.session.enable(); await f.tick(); }
  assert.equal(calls, 1); assert.doesNotMatch(JSON.stringify(f.updates), /secret-provider/);
  f.at(1000 + TURN_RETRY_MS); await f.tick(); assert.equal(calls, 2); f.session.dispose();
});
test("TURN provider timeout aborts at five seconds and falls back without rejecting the room task", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
  f.session.enable(); const pending = f.tick(); t.mock.timers.tick(5000); await pending;
  assert.deepEqual(f.updates.map((update) => update.status), ["pending", "unavailable"]); f.session.dispose();
});
test("oversized streamed provider responses are cancelled before parsing or disclosure", async () => {
  let cancelled = false;
  const f = fixture(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(16385)); }, cancel() { cancelled = true; } })));
  f.session.enable(); await f.tick(); assert.equal(cancelled, true); assert.equal(f.updates.at(-1)?.status, "unavailable"); f.session.dispose();
});
test("a response without authenticated TURN servers does not masquerade as a working relay", async () => {
  const f = fixture(async () => Response.json({ iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] }));
  f.session.enable(); await f.tick(); assert.equal(f.updates.at(-1)?.status, "unavailable"); f.session.dispose(); await flush();
});
