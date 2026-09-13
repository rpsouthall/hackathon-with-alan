import test from 'node:test';
import assert from 'node:assert/strict';
import { KYOTO_ENVIRONMENT, KYOTO_NPCS } from '../../lib/world/kyoto';
import { createWalkingMap } from '../../lib/world/navigation';
import { WorldRoom, distance } from '../../lib/world/room';
import { canTalkToNpc, isInsideVenue } from '../../lib/world/venues';
import { DEFAULT_ENVIRONMENT, DEFAULT_NPCS } from '../../lib/world/defaults';
import type { Vec3 } from '../../lib/world/schema';
import { lessonCharacterForWorldNpc, scenarioForCharacter } from '../../lib/lesson/characters';

const mapReady = createWalkingMap(KYOTO_ENVIRONMENT);
async function walk(room: WorldRoom, playerId: string, goal: { position: Vec3; interactionRadius: number }, canStop: (position: Vec3) => boolean = () => true) {
  const map = await mapReady;
  const route = map.route(room.snapshot().players.find(player => player.id === playerId)!.position, goal, canStop);
  assert.ok(route?.length, 'A route exists through the exported door and colliders');
  for (let frame = 0; frame < 3500; frame++) {
    const position = room.snapshot().players.find(player => player.id === playerId)!.position;
    if (distance(position, goal.position) <= goal.interactionRadius - .2 && canStop(position)) return;
    while (route.length && Math.hypot(position[0] - route[0][0], position[2] - route[0][2]) < .22) route.shift();
    const next = route[0]; assert.ok(next, `Route reaches goal; stopped at ${position}`);
    const dx = next[0] - position[0], dz = next[2] - position[2], length = Math.hypot(dx, dz);
    room.command(playerId, { type: 'move', direction: [dx / length, dz / length], yaw: Math.atan2(dx, dz), sequence: frame }, frame * 50);
    room.tick(.05, frame * 50);
  }
  assert.fail('Route failed to complete through real physics');
}

for (const venue of KYOTO_ENVIRONMENT.venues!) test(`${venue.name}: enter, meet correct indoor tutor, reject talking through wall, exit`, async t => {
  await mapReady;
  const npc = KYOTO_NPCS.find(npc => npc.id === venue.npcId)!;
  assert.ok(isInsideVenue(venue, npc.position), 'Tutor is inside their building');
  assert.equal(scenarioForCharacter(lessonCharacterForWorldNpc(npc.id)!).id, venue.id === 'kissa_aoi' ? 'coffee' : 'restaurant');
  assert.ok(!isInsideVenue(venue, venue.entry), 'Entrance marker is outside');
  const room = new WorldRoom('shop-walk', KYOTO_ENVIRONMENT, KYOTO_NPCS);
  t.after(() => room.dispose()); room.join('walker', 'Learner');
  await walk(room, 'walker', npc, position => isInsideVenue(venue, position));
  assert.ok(canTalkToNpc(KYOTO_ENVIRONMENT, npc, room.snapshot().players[0].position));
  assert.equal(room.command('walker', { type: 'interact', npcId: npc.id }), null);
  room.command('walker', { type: 'leave-encounter' });
  await walk(room, 'walker', { position: venue.entry, interactionRadius: 1 });
  assert.ok(!isInsideVenue(venue, room.snapshot().players[0].position));
  assert.match(room.command('walker', { type: 'interact', npcId: npc.id })!, /Enter/);

  // Start just outside a side wall, still within the tutor's interaction radius.
  const outside: Vec3 = venue.id === 'kissa_aoi' ? [npc.position[0], .3, 9] : [16.9, .3, npc.position[2]];
  assert.ok(distance(outside, npc.position) < npc.interactionRadius);
  const guarded = new WorldRoom('shop-gate', { ...KYOTO_ENVIRONMENT, spawn: outside }, KYOTO_NPCS);
  t.after(() => guarded.dispose()); guarded.join('inside', 'First learner');
  assert.equal(canTalkToNpc(KYOTO_ENVIRONMENT, npc, outside), false);
  assert.match(guarded.command('inside', { type: 'interact', npcId: npc.id })!, /Enter/);
  await walk(guarded, 'inside', npc, position => isInsideVenue(venue, position));
  assert.equal(guarded.command('inside', { type: 'interact', npcId: npc.id }), null);
  guarded.join('outside', 'Second learner');
  assert.match(guarded.command('outside', { type: 'join-encounter', encounterId: guarded.snapshot().encounters[0].id })!, /Enter/);
});

test('Distinct shop assignments preserve outdoor sample worlds', () => {
  const venues = KYOTO_ENVIRONMENT.venues!;
  assert.equal(new Set(venues.map(venue => venue.npcId)).size, 2);
  assert.ok(venues[0].bounds.max[0] < venues[1].bounds.min[0]);
  const npc = DEFAULT_NPCS.find(npc => npc.id === 'cafe_owner')!;
  assert.ok(canTalkToNpc(DEFAULT_ENVIRONMENT, npc, npc.position));
});
