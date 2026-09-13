import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalkingMap } from '../../lib/world/navigation';
import { KYOTO_ENVIRONMENT, KYOTO_NPCS } from '../../lib/world/kyoto';
import { WorldRoom, distance } from '../../lib/world/room';

test('Walk closer routes each featured neighbour through real city physics', async () => {
  const map = await createWalkingMap(KYOTO_ENVIRONMENT);
  for (const npc of KYOTO_NPCS.slice(0, 5)) {
    const room = new WorldRoom(`walk-${npc.id}`, KYOTO_ENVIRONMENT, KYOTO_NPCS);
    try {
      room.join('walker', 'Walker');
      const route = map.route(room.snapshot().players[0].position, npc);
      assert.ok(route?.length, `${npc.name}: a walking route is available`);
      for (let frame = 0; frame < 2000; frame++) {
        const position = room.snapshot().players[0].position;
        if (distance(position, npc.position) <= npc.interactionRadius - 0.2) break;
        while (route.length && Math.hypot(position[0] - route[0][0], position[2] - route[0][2]) < 0.22) route.shift();
        const next = route[0];
        assert.ok(next, `${npc.name}: route should end within talking distance`);
        const dx = next[0] - position[0], dz = next[2] - position[2], length = Math.hypot(dx, dz);
        room.command('walker', { type: 'move', direction: [dx / length, dz / length], yaw: Math.atan2(dx, dz), sequence: frame }, frame * 50);
        room.tick(0.05, frame * 50);
      }
      assert.ok(distance(room.snapshot().players[0].position, npc.position) <= npc.interactionRadius, `${npc.name}: actual physics reaches the NPC; ended at ${room.snapshot().players[0].position}`);
      assert.equal(room.command('walker', { type: 'interact', npcId: npc.id }), null, `${npc.name}: authority accepts conversation`);
    } finally { room.dispose(); }
  }
});
