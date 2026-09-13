import test from "node:test";
import assert from "node:assert/strict";
import { createHostedTransport, createLocalTransport, createWebSocketTransport, type WorldTransport } from "../../lib/world/transport";
import { createWorldStore } from "../../lib/world/store";
import { WorldRoom } from "../../lib/world/room";
import type { PlayerVoiceClientMessage } from "../../lib/world/player-voice-contract";

test("only the hosted transport opts into nearby player voice", () => {
  assert.equal(createHostedTransport().supportsPlayerVoice, true);
  assert.notEqual(createLocalTransport().supportsPlayerVoice, true);
  assert.equal(createWebSocketTransport("ws://127.0.0.1:8788/world").supportsPlayerVoice, false);
});

test("local WebSocket gameplay remains usable when a caller attempts a voice message", (t) => {
  const original = globalThis.WebSocket;
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    sent: string[] = [];
    onopen?: () => void;
    onclose?: (event: CloseEvent) => void;
    constructor() { sockets.push(this); }
    send(data: string) { this.sent.push(data); }
    close() { this.readyState = 3; this.onclose?.({ code: 1000 } as CloseEvent); }
  }
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  t.after(() => { globalThis.WebSocket = original; });
  const transport = createWebSocketTransport("ws://127.0.0.1:8788/world");
  const stop = transport.connect({ roomId: "local", name: "Learner", onMessage() {}, onConnection() {} });
  const socket = sockets[0];
  try {
    socket.onopen?.();
    transport.sendVoice?.({ type: "voice-join" });
    transport.sendVoice?.({ type: "voice-leave" });
    transport.send({ type: "move", direction: [1, 0], yaw: 0, sequence: 0 });
    assert.deepEqual(socket.sent.map((message) => JSON.parse(message).type), ["join", "command"]);
    assert.equal(socket.readyState, FakeSocket.OPEN, "Unsupported voice must not close or corrupt the gameplay connection");
  } finally { stop(); }
});

for (const supported of [false, true]) test(`store forwards voice only for an opted-in connected room (capability ${supported})`, (t) => {
  let connection: Parameters<WorldTransport["connect"]>[0] | undefined;
  const sent: PlayerVoiceClientMessage[] = [];
  let subscriptions = 0;
  const transport: WorldTransport = {
    mode: "multiplayer", supportsPlayerVoice: supported,
    connect(options) { connection = options; return () => {}; }, send() {},
    sendVoice(message) { sent.push(message); },
    subscribeVoice() { subscriptions++; return () => {}; },
  };
  const store = createWorldStore(transport);
  assert.equal(store.getSnapshot().supportsPlayerVoice, supported);
  store.connect("local", "Learner");
  store.sendVoice({ type: "voice-join" });
  assert.equal(sent.length, 0);
  const room = new WorldRoom("local"); t.after(() => room.dispose()); room.join("learner", "Learner");
  connection!.onConnection("connected");
  connection!.onMessage({ type: "welcome", playerId: "learner", snapshot: room.snapshot() });
  store.subscribeVoice(() => {})();
  store.sendVoice({ type: "voice-join" });
  assert.equal(sent.length, supported ? 1 : 0);
  assert.equal(subscriptions, supported ? 1 : 0);
  connection!.onConnection("disconnected");
  store.sendVoice({ type: "voice-join" });
  assert.equal(sent.length, supported ? 1 : 0);
});
