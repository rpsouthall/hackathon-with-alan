import test from "node:test";
import assert from "node:assert/strict";
import { DayCycle } from "../../lib/world/day-cycle";
import { WorldRoom } from "../../lib/world/room";
import { createWorldStore } from "../../lib/world/store";
import { roomSchema, serverMessageSchema, worldClockSchema } from "../../lib/world/schema";
import type { WorldTransport } from "../../lib/world/transport";
import { DAY_LENGTH_SECONDS, INITIAL_HOUR, sampleWorldClock, sharedWorldHour, type WorldClockAnchor } from "../../lib/world/world-clock";

const epoch = 1_800_000_000_000;
const anchor = (serverTimeMs: number, receivedAtMs: number): WorldClockAnchor => ({ sample: sampleWorldClock(serverTimeMs), receivedAtMs });
const sameHour = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`);

test("late arrivals and separate browser performance origins show the same shared hour", () => {
  let firstNow = 10;
  let secondNow = 700_000;
  const first = new DayCycle(false, () => firstNow);
  first.syncWorldClock(anchor(epoch, firstNow));
  firstNow += 75_000;
  const second = new DayCycle(false, () => secondNow);
  second.syncWorldClock(anchor(epoch + 75_000, secondNow));
  first.update(.016); second.update(.016);
  sameHour(first.hours, second.hours);
  firstNow += 20_000; secondNow += 20_000;
  first.update(.1); second.update(.001);
  sameHour(first.hours, second.hours);
  assert.equal(first.source, "shared");
});

test("shared time catches up after renderer loading and background suspension", () => {
  let now = 90_000;
  const clock = new DayCycle(false, () => now);
  const sample = anchor(epoch, 0); // The store received this before Three.js loaded.
  clock.syncWorldClock(sample);
  sameHour(clock.hours, sharedWorldHour(anchor(epoch + 90_000, now), now));
  now += DAY_LENGTH_SECONDS * 3000 + 170_000;
  clock.update(.1); // Physics dt remains capped; time must include the whole gap.
  sameHour(clock.hours, sharedWorldHour(sample, now));
});

test("round-trip correction compensates delivery delay and bounds unhealthy samples", () => {
  const received = { ...anchor(epoch, 1000), latencyMs: 400 };
  sameHour(sharedWorldHour(received, 1000), sharedWorldHour(anchor(epoch + 200, 1000), 1000));
  sameHour(sharedWorldHour({ ...received, latencyMs: 20_000 }, 1000), sharedWorldHour(anchor(epoch + 1000, 1000), 1000));
  sameHour(sharedWorldHour({ ...received, latencyMs: -100 }, 1000), sharedWorldHour(anchor(epoch, 1000), 1000));
  sameHour(sharedWorldHour({ ...received, latencyMs: NaN }, 1000), sharedWorldHour(anchor(epoch, 1000), 1000));
});

test("reduced motion still follows the shared day but manual presets stay immediate", () => {
  let now = 0;
  const clock = new DayCycle(true, () => now);
  clock.syncWorldClock(anchor(epoch, now));
  const before = clock.hours;
  now += 30_000; clock.update(.1);
  sameHour(clock.hours, (before + 1) % 24);
  assert.equal(clock.source, "shared"); assert.equal(clock.playing, true);
  clock.setHour(22);
  assert.equal(clock.hours, 22); assert.equal(clock.source, "personal");
});

test("personal presets and pause never change shared time and can rejoin its current phase", () => {
  let now = 0;
  const shared = anchor(epoch, now);
  const clock = new DayCycle(false, () => now);
  clock.syncWorldClock(shared);
  clock.setHour(22, false);
  now += 60_000;
  clock.syncWorldClock(anchor(epoch + now, now)); clock.update(.1);
  assert.equal(clock.hours, 22); assert.equal(clock.source, "personal");
  clock.returnToSharedTime();
  assert.equal(clock.source, "shared");
  sameHour(clock.hours, sharedWorldHour(shared, now));
  clock.setPlaying(false);
  const paused = clock.hours;
  now += 60_000; clock.update(.1);
  assert.equal(clock.hours, paused); assert.equal(clock.source, "personal");
  clock.returnToSharedTime();
  sameHour(clock.hours, sharedWorldHour(shared, now));
});

test("authority samples progress without simulation ticks and survive room recreation", () => {
  const first = new WorldRoom("clock");
  const start = first.snapshot(epoch);
  const later = first.dynamicSnapshot(epoch + 60_000);
  assert.equal(later.revision, start.revision, "the clock does not make idle rooms tick or broadcast");
  assert.equal(later.worldClock?.serverTimeMs, epoch + 60_000);
  assert.equal(later.worldClock?.epochMs, start.worldClock?.epochMs);
  assert(serverMessageSchema.safeParse({ type: "state", ...later }).success);
  first.dispose();
  const recreated = new WorldRoom("clock");
  assert.deepEqual(recreated.snapshot(epoch + 60_000).worldClock, later.worldClock);
  start.worldClock!.initialHour = 1;
  assert.equal(recreated.snapshot(epoch).worldClock?.initialHour, INITIAL_HOUR);
  recreated.dispose();
});

test("clock schema validates samples and permits snapshots from an authority without a clock", () => {
  const room = new WorldRoom();
  const snapshot = room.snapshot(epoch);
  assert(roomSchema.safeParse({ ...snapshot, worldClock: undefined }).success);
  assert(!worldClockSchema.safeParse({ ...snapshot.worldClock, dayLengthSeconds: 0 }).success);
  assert(!worldClockSchema.safeParse({ ...snapshot.worldClock, serverTimeMs: NaN }).success);
  assert(!worldClockSchema.safeParse({ ...snapshot.worldClock, initialHour: 24 }).success);
  room.dispose();
});

test("store timestamps accepted welcome and compact samples before rendering, rejecting stale or foreign clocks", () => {
  let receiver: Parameters<WorldTransport["connect"]>[0] | undefined;
  const transport: WorldTransport = { mode: "multiplayer", connect(options) { receiver = options; return () => {}; }, send() {} };
  let now = 100;
  const store = createWorldStore(transport, () => now);
  store.connect("clock", "Aki");
  const room = new WorldRoom("clock"); room.join("aki", "Aki");
  receiver!.onConnection("connected");
  receiver!.onMessage({ type: "welcome", playerId: "aki", snapshot: room.snapshot(epoch) });
  assert.equal(store.getSnapshot().worldClock?.receivedAtMs, 100);
  receiver!.onLatency?.(400);
  assert.equal(store.getSnapshot().worldClock?.receivedAtMs, 100, "a ping must not reset the sample's receipt time");
  assert.equal(store.getSnapshot().worldClock?.latencyMs, 400);
  now = 500;
  const initial = store.getSnapshot().worldClock;
  receiver!.onMessage({ type: "state", ...room.dynamicSnapshot(epoch + 400) });
  assert.equal(store.getSnapshot().worldClock, initial, "equal revisions cannot replace clock anchors");
  room.join("kai", "Kai");
  receiver!.onMessage({ type: "state", ...room.dynamicSnapshot(epoch + 400), roomId: "foreign" });
  assert.equal(store.getSnapshot().worldClock, initial);
  receiver!.onMessage({ type: "state", ...room.dynamicSnapshot(epoch + 400) });
  assert.equal(store.getSnapshot().worldClock?.receivedAtMs, 500);
  assert.equal(store.getSnapshot().worldClock?.latencyMs, 400, "new state samples retain measured latency");
  assert.deepEqual(store.getSnapshot().snapshot?.worldClock, room.snapshot(epoch + 400).worldClock);
  receiver!.onConnection("disconnected");
  assert.equal(store.getSnapshot().worldClock, null);
  store.connect("clock", "Aki");
  now = 900;
  receiver!.onConnection("connected");
  receiver!.onMessage({ type: "welcome", playerId: "aki", snapshot: room.snapshot(epoch + 800) });
  assert.equal(store.getSnapshot().worldClock?.receivedAtMs, 900);
  assert.equal(store.getSnapshot().worldClock?.sample.serverTimeMs, epoch + 800);
  room.dispose();
});
