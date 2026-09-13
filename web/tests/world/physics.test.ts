import test, { before } from "node:test";
import assert from "node:assert/strict";
import { WorldRoom } from "../../lib/world/room";
import { initWorldPhysics } from "../../lib/world/physics";
import v1Gameplay from "../../lib/world/data/kyoto-gameplay.json";
import cityGameplay from "../../lib/world/data/kyoto-city-gameplay.json";
import { appearanceSchema, environmentSchema, npcSchema, type EnvironmentManifest, type Vec3 } from "../../lib/world/schema";
import { createLocalTransport } from "../../lib/world/transport";

before(async () => { await initWorldPhysics(); });

function fixture(gameplay: {
  colliders: unknown[];
  markers: Array<{ position: number[]; properties: { kind: string; npc_id?: string; interaction_radius?: number } }>;
}, bounds: { min: Vec3; max: Vec3 }) {
  const residents = gameplay.markers.filter((marker) => marker.properties.npc_id);
  return {
    environment: environmentSchema.parse({
      id: "kyoto-physics-fixture", revision: "fixture-v1", name: "Exported Kyoto fixture", assetUrl: null,
      spawn: gameplay.markers.find((marker) => marker.properties.kind === "player_spawn")!.position,
      bounds, colliders: [], physics: { colliders: gameplay.colliders },
      npcSpawns: Object.fromEntries(residents.map((marker) => [marker.properties.npc_id, marker.position])),
    }),
    npcs: residents.map((marker) => npcSchema.parse({
      id: marker.properties.npc_id, name: marker.properties.npc_id, role: "Resident", scenarioId: "conversation",
      position: marker.position, interactionRadius: marker.properties.interaction_radius ?? 2.8,
    })),
  };
}
const v1 = fixture(v1Gameplay, { min: [-19, -4, -17], max: [19, 20, 16] });
const city = fixture(cityGameplay, { min: [-34, -4, -27], max: [34, 20, 27] });

function routeRoom(spawn = v1.environment.spawn) {
  return new WorldRoom("route", { ...v1.environment, spawn }, v1.npcs);
}
function follower(room: WorldRoom, playerId = "learner") {
  let frame = 0;
  const trace: Vec3[] = [];
  const tick = (direction: [number, number] = [0, 0]) => {
    const now = frame * 50;
    assert.equal(room.command(playerId, { type: "move", direction, yaw: Math.atan2(direction[0], direction[1]), sequence: frame++ }, now), null);
    room.tick(0.05, now);
    const position = room.snapshot().players.find((player) => player.id === playerId)!.position;
    trace.push(position);
    return position;
  };
  return {
    trace, tick,
    follow(points: Array<[number, number]>) {
      for (const [x, z] of points) {
        let reached = false;
        for (let i = 0; i < 900; i++) {
          const [px, , pz] = room.snapshot().players.find((player) => player.id === playerId)!.position;
          const dx = x - px, dz = z - pz, distance = Math.hypot(dx, dz);
          if (distance < 0.08) { reached = true; break; }
          const divisor = Math.max(0.15, distance);
          tick([dx / divisor, dz / divisor]);
        }
        assert.ok(reached, `Failed waypoint ${x},${z}; player at ${room.snapshot().players[0].position}`);
      }
    },
  };
}

test("authoritative Kyoto controller crosses the arched bridge in both directions and reaches residents", (t) => {
  const room = routeRoom(); t.after(() => room.dispose()); room.join("learner", "Learner");
  const walker = follower(room);
  for (let i = 0; i < 15; i++) walker.tick();
  walker.follow([[5, 4], [0, 4], [-5, 4], [-5, -1], [-7.2, -1]]);
  assert.equal(room.command("learner", { type: "interact", npcId: "local_guide" }), null);
  room.command("learner", { type: "leave-encounter" });
  walker.follow([[-5, -1], [-5, 4], [0, 4], [5, 4], [5, 10]]);
  walker.follow([[5, 4], [5, 1.85], [8.2, 1.85]]);
  assert.equal(room.command("learner", { type: "interact", npcId: "cafe_owner" }), null);
  room.command("learner", { type: "leave-encounter" });
  walker.follow([[5, 1.85], [5, -7.1], [8.8, -7.1]]);
  assert.equal(room.command("learner", { type: "interact", npcId: "inn_host" }), null);
  assert.ok(Math.max(...walker.trace.map((position) => position[1])) > 1.2, "Feet climb the exported bridge arch");
  assert.ok(Math.min(...walker.trace.map((position) => position[1])) > 0.15, "The route never drops through its colliders");
});

test("authoritative Kyoto controller climbs the exported shrine steps", (t) => {
  const room = routeRoom([-11, 0.30, -2.7]); t.after(() => room.dispose()); room.join("learner", "Learner");
  const walker = follower(room);
  for (let i = 0; i < 15; i++) walker.tick();
  walker.follow([[-11, -4.4]]);
  assert.ok(room.snapshot().players[0].position[1] > 0.70, "Capsule climbs the stair collision boxes");
  walker.follow([[-11, -2.7]]);
  for (let i = 0; i < 15; i++) walker.tick();
  assert.ok(room.snapshot().players[0].position[1] < 0.40, "Capsule descends to the ground again");
});

function simpleEnvironment(): EnvironmentManifest {
  return environmentSchema.parse({
    id: "physics-test", revision: "v1", name: "Physics test", assetUrl: null,
    spawn: [0, 0.05, 0], bounds: { min: [-3, -2, -3], max: [3, 8, 3] }, colliders: [], npcSpawns: {},
    physics: { colliders: [{ position: [0, -0.25, 0], halfExtents: [3, 0.25, 3], quaternion: [0, 0, 0, 1] }] },
  });
}

test("physics authority enforces bounds, expires movement input, and respawns after a fall", (t) => {
  const room = new WorldRoom("limits", simpleEnvironment(), []); t.after(() => room.dispose()); room.join("learner", "Learner");
  const walker = follower(room);
  for (let i = 0; i < 80; i++) walker.tick([1, 0]);
  assert.ok(room.snapshot().players[0].position[0] <= 2.72);
  const before = room.snapshot().players[0].position;
  room.tick(60, 999999);
  assert.ok(Math.abs(room.snapshot().players[0].position[0] - before[0]) < 0.001);
  const environment = simpleEnvironment();
  environment.physics!.colliders[0].halfExtents = [0.6, 0.25, 0.6];
  const falling = new WorldRoom("falling", environment, []); t.after(() => falling.dispose()); falling.join("learner", "Learner");
  const faller = follower(falling);
  let fell = false, respawned = false;
  for (let i = 0; i < 100; i++) {
    const position = faller.tick([1, 0]);
    if (position[1] < -0.3) fell = true;
    if (fell && Math.hypot(position[0], position[2]) < 0.2 && position[1] >= 0) { respawned = true; break; }
  }
  assert.ok(fell && respawned, "Falling below the room floor returns the player to its configured spawn");
});

test("appearance commands are validated, shared, and never change the authoritative collision size", (t) => {
  const room = new WorldRoom("appearance", simpleEnvironment(), []); t.after(() => room.dispose());
  room.join("a", "Alice"); room.join("b", "Bob");
  const tall = appearanceSchema.parse({ height: 2.1, hair: "topknot", top: "#AABBCC" });
  const short = appearanceSchema.parse({ height: 1.4, outfit: "haori" });
  assert.equal(room.command("a", { type: "set-appearance", appearance: tall }), null);
  assert.equal(room.command("b", { type: "set-appearance", appearance: short }), null);
  assert.equal(room.snapshot().players[0].appearance.top, "#aabbcc");
  assert.equal(room.snapshot().players[1].appearance.height, 1.4);
  assert.match(room.command("a", { type: "set-appearance", appearance: { ...tall, height: 9 } })!, /Invalid/);
  assert.match(room.command("a", { type: "set-appearance", appearance: { ...tall, skin: "red" } })!, /Invalid/);
  assert.match(room.command("a", { type: "set-appearance", playerId: "b", appearance: tall })!, /Invalid/);
  for (let i = 0; i < 40; i++) {
    for (const id of ["a", "b"]) room.command(id, { type: "move", direction: [1, 0], yaw: 0, sequence: i }, i * 50);
    room.tick(0.05, i * 50);
  }
  assert.deepEqual(room.snapshot().players[0].position, room.snapshot().players[1].position);
  room.dispose(); room.dispose();
  assert.match(room.command("a", { type: "leave-encounter" })!, /closed/);
  assert.throws(() => room.join("c", "Closed"), /closed/);
});

test("local physics connection can be cancelled during async initialization", async () => {
  const messages: unknown[] = [];
  const transport = createLocalTransport({ environment: v1.environment, npcs: v1.npcs });
  const stop = transport.connect({ roomId: "cancel", name: "Learner", onMessage: (message) => messages.push(message), onConnection: () => {} });
  stop();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(messages, []);
});

// These authored routes come from the environment producer's verify_three.mjs.
// Run them through the actual multiplayer room controller rather than a duplicate controller.
type Point = [number, number];
const guide: Point[] = [[5, -10], [5, -4], [0, -4], [-5, -4], [-5, 1], [-7.2, 1]];
const markerPoint = (name: string): Point => {
  const marker = cityGameplay.markers.find((item) => item.name === name);
  assert.ok(marker, `Missing marker ${name}`);
  return [marker.position[0], -marker.position[2]];
};
const cafe = markerPoint("MARK_npc_cafe"), inn = markerPoint("MARK_npc_inn");
const cityRoutes: Record<string, Point[]> = {
  spawn_to_guide: guide, guide_to_spawn: [...guide].reverse(),
  spawn_to_cafe: [[5, -10], [5, -4], [5, cafe[1]], [cafe[0] - 0.8, cafe[1]]],
  spawn_to_inn: [[5, -10], [5, inn[1]], [inn[0] - 0.8, inn[1]]],
  north_bridge_east_to_west: [[5, 18.2], [-5, 18.2]],
  north_bridge_west_to_east: [[-5, 18.2], [5, 18.2]],
};
for (const [name, points] of Object.entries(cityRoutes)) {
  test(`expanded city authority traverses ${name}`, (t) => {
    // The producer's verifier starts the capsule 5 cm above its 30 cm marker.
    const start: Vec3 = [points[0][0], 0.35, -points[0][1]];
    const room = new WorldRoom("city-route", { ...city.environment, spawn: start }, city.npcs);
    t.after(() => room.dispose()); room.join("learner", "Learner");
    const walker = follower(room);
    for (let i = 0; i < 15; i++) walker.tick();
    walker.follow(points.slice(1).map(([x, y]) => [x, -y]));
    const resident = ({ spawn_to_guide: "local_guide", spawn_to_cafe: "cafe_owner", spawn_to_inn: "inn_host" } as Record<string, string>)[name];
    if (resident) assert.equal(room.command("learner", { type: "interact", npcId: resident }), null);
    assert.ok(Math.min(...walker.trace.map((position) => position[1])) > 0.15, "Route remains above ground");
  });
}

for (const marker of cityGameplay.markers.filter((item) => item.properties.kind === "npc_spawn")) {
  test(`expanded city authority reaches market resident ${marker.properties.npc_id}`, (t) => {
    const room = new WorldRoom("market-route", city.environment, city.npcs);
    t.after(() => room.dispose()); room.join("learner", "Learner");
    const walker = follower(room), x = marker.position[0];
    if (x < 0) walker.follow([[5, 4], [-5, 4], [-5, 18.4]]);
    else walker.follow([[5, 18.4]]);
    walker.follow([[x, 18.4], [x, 19]]);
    assert.equal(room.command("learner", { type: "interact", npcId: marker.properties.npc_id }), null);
  });
}

for (const venue of cityGameplay.markers.filter((marker) => marker.properties.kind === "venue_entry")) {
  const id = venue.name.replace("MARK_entry_", "");
  test(`expanded city authority enters ${id}, reaches its host, turns and exits`, (t) => {
    const entry = markerPoint(venue.name), inside = markerPoint(`MARK_inside_${id}`), interaction = markerPoint(`MARK_interaction_${id}`), npc = markerPoint(`MARK_npc_${id}`);
    const length = Math.hypot(inside[0] - entry[0], inside[1] - entry[1]);
    const right: Point = [(inside[1] - entry[1]) / length, -(inside[0] - entry[0]) / length];
    const side = Math.sign((npc[0] - interaction[0]) * right[0] + (npc[1] - interaction[1]) * right[1]) || 1;
    const turn: Point = [interaction[0] + right[0] * 0.65 * side, interaction[1] + right[1] * 0.65 * side];
    let approach: Point[];
    if (Math.abs(entry[0]) > 19) {
      const west = entry[0] < 0, street = west ? -20 : 20;
      approach = west ? [[5, -10], [5, -4], [-5, -4], [-5, -18.4], [street, -18.4], [street, entry[1]]]
        : [[5, -10], [5, -18.4], [street, -18.4], [street, entry[1]]];
    } else {
      approach = [[5, -10], [5, 18.2]];
      if (entry[0] < 0) approach.push([-5, 18.2]);
      approach.push([entry[0], 18.2]);
    }
    const room = new WorldRoom("venue-route", city.environment, city.npcs);
    t.after(() => room.dispose()); room.join("learner", "Learner");
    const walker = follower(room);
    const coordinates = (points: Point[]) => points.map(([x, y]): Point => [x, -y]);
    walker.follow(coordinates([...approach.slice(1), entry, inside, interaction, turn]));
    assert.equal(room.command("learner", { type: "interact", npcId: `${id}_host` }), null, "Host is in interaction range after entering");
    room.command("learner", { type: "leave-encounter" });
    walker.follow(coordinates([interaction, inside, entry, approach.at(-1)!]));
    assert.ok(Math.min(...walker.trace.map((position) => position[1])) > 0.15, "Venue route stays on supported ground");
  });
}

test('grounded players jump, reject repeated airborne lift, and land safely', () => {
  const room = routeRoom();
  try {
    room.join('jumper', 'Jumper');
    for (let i = 0; i < 20; i++) room.tick(0.05, i * 50);
    const floor = room.snapshot().players[0].position[1];
    assert.equal(room.command('jumper', { type: 'jump' }, 1000), null);
    let peak = floor;
    for (let i = 0; i < 40; i++) {
      room.tick(0.025, 1000 + i * 25);
      peak = Math.max(peak, room.snapshot().players[0].position[1]);
      if (i < 8) room.command('jumper', { type: 'jump' }, 1000 + i * 25);
    }
    assert.ok(peak > floor + 0.5, `Expected an actual jump, rose ${peak - floor}`);
    assert.ok(peak < floor + 1.5, 'Repeated airborne jumps must not add lift');
    for (let i = 0; i < 20; i++) room.tick(0.05, 2000 + i * 50);
    assert.ok(Math.abs(room.snapshot().players[0].position[1] - floor) < 0.06, 'Must land on supported ground');
    assert.equal(room.command('jumper', { type: 'jump' }, 3000), null);
    room.tick(0.05, 3050);
    assert.ok(room.snapshot().players[0].position[1] > floor + 0.1, 'Can jump again after landing');
  } finally { room.dispose(); }
});
