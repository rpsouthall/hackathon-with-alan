import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createWebSocketTransport, type WorldTransport } from "../../lib/world/transport";
import { createWorldStore } from "../../lib/world/store";

function fixture(t: TestContext) {
  let now = 0;
  let timerId = 0;
  const intervals = new Map<number, () => void>();
  const timeouts = new Map<number, { callback: () => void; delay: number }>();
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 0;
    sent: string[] = [];
    closed: { code: number; reason: string }[] = [];
    onopen?: () => void;
    onmessage?: (event: MessageEvent) => void;
    onclose?: (event: CloseEvent) => void;
    constructor() { sockets.push(this); }
    send(data: string) { this.sent.push(data); }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(data: string) { this.onmessage?.({ data } as MessageEvent); }
    close(code = 1000, reason = "") { this.readyState = 3; this.closed.push({ code, reason }); this.onclose?.({ code } as CloseEvent); }
  }
  const original = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  t.after(() => { globalThis.WebSocket = original; });
  t.mock.method(performance, "now", () => now);
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "setInterval", (callback: () => void) => { const id = ++timerId; intervals.set(id, callback); return id; });
  t.mock.method(globalThis, "clearInterval", (id: number) => { intervals.delete(id); });
  t.mock.method(globalThis, "setTimeout", (callback: () => void, delay: number) => { const id = ++timerId; timeouts.set(id, { callback, delay }); return id; });
  t.mock.method(globalThis, "clearTimeout", (id: number) => { timeouts.delete(id); });
  return { sockets, intervals, timeouts, setNow(value: number) { now = value; }, interval() { for (const callback of [...intervals.values()]) callback(); } };
}

test("heartbeat measures one outstanding ping and ignores unsolicited or duplicate pong frames", (t) => {
  const f = fixture(t), samples: number[] = [];
  const transport = createWebSocketTransport("wss://example.test/world", true);
  const stop = transport.connect({ roomId: "kyoto", name: "Aki", onMessage() {}, onConnection() {}, onLatency: (ms) => samples.push(ms) });
  t.after(stop);
  const socket = f.sockets[0];
  socket.receive("pong");
  assert.deepEqual(samples, []);
  socket.open();
  assert.equal(JSON.parse(socket.sent[0]).type, "join");
  assert.equal(socket.sent[1], "ping");
  f.setNow(237); socket.receive("pong"); socket.receive("pong");
  assert.deepEqual(samples, [237]);
  f.setNow(3_000); f.interval();
  f.setNow(3_040); socket.receive(JSON.stringify({ type: "error", message: "An ordinary game message" }));
  f.setNow(3_080); socket.receive("pong");
  assert.deepEqual(samples, [237, 80], "game packets do not replace the ping's monotonic start time");
});

test("a missing pong times out even if ordinary gameplay messages keep arriving", (t) => {
  const f = fixture(t);
  const stop = createWebSocketTransport("wss://example.test/world", true).connect({ roomId: "kyoto", name: "Aki", onMessage() {}, onConnection() {} });
  t.after(stop);
  const socket = f.sockets[0]; socket.open();
  for (const now of [3_000, 12_000, 30_000, 45_000]) {
    f.setNow(now); socket.receive(JSON.stringify({ type: "error", message: "Server is still sending game packets" })); f.interval();
  }
  assert.equal(socket.sent.filter((value) => value === "ping").length, 1, "an unanswered ping is never overwritten");
  f.setNow(48_000); socket.receive(JSON.stringify({ type: "error", message: "Still receiving packets" })); f.interval();
  assert.equal(socket.closed[0].code, 4000);
  assert.equal(socket.closed[0].reason, "Connection timed out");
});

test("cleanup and socket replacement suppress stale latency samples and clear heartbeat timers", (t) => {
  const f = fixture(t), samples: number[] = [];
  const transport = createWebSocketTransport("wss://example.test/world", true);
  const callbacks = { roomId: "kyoto", name: "Aki", onMessage() {}, onConnection() {}, onLatency: (ms: number) => samples.push(ms) };
  const stop = transport.connect(callbacks);
  const old = f.sockets[0]; old.open();
  assert.equal(f.intervals.size, 1);
  stop();
  assert.equal(f.intervals.size, 0);
  assert.equal(f.timeouts.size, 0);
  f.setNow(300); old.receive("pong");
  assert.deepEqual(samples, []);
  const stopNew = transport.connect(callbacks); t.after(stopNew);
  const current = f.sockets[1]; current.open();
  f.setNow(450); old.receive("pong"); current.receive("pong");
  assert.deepEqual(samples, [150]);
});

test("store clears latency on disconnect and a fresh room connection", () => {
  let receiver: Parameters<WorldTransport["connect"]>[0] | undefined;
  const transport: WorldTransport = { mode: "multiplayer", send() {}, connect(options) { receiver = options; return () => {}; } };
  const store = createWorldStore(transport);
  store.connect("kyoto", "Aki");
  receiver!.onConnection("connected"); receiver!.onLatency?.(456);
  assert.equal(store.getSnapshot().latencyMs, 456);
  receiver!.onConnection("disconnected");
  assert.equal(store.getSnapshot().latencyMs, null);
  receiver!.onLatency?.(99);
  store.connect("another", "Aki");
  assert.equal(store.getSnapshot().latencyMs, null);
});
