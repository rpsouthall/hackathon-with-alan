/** Headless GLTFLoader + Rapier verification. Run: node verify_three.mjs
 * Dependencies are installed by the project owner. No DOM or renderer is created.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import RAPIER from '@dimforge/rapier3d-compat';

const root = new URL('../', import.meta.url);
const output = new URL('qa_runtime.json', root);
const report = {
  schemaVersion: 2, generatedAt: new Date().toISOString(), verdict: 'FAIL',
  runtime: { node: process.version, three: THREE.REVISION },
  limitations: [
    'GLTFLoader and actual Rapier movement are exercised headlessly; rendered appearance, WebGL frame rate and controls are not assessed.',
    'Routes use a deterministic waypoint follower, not pathfinding. A failed route can reflect an unsuitable waypoint or follower tolerance; inspect the recorded stuck position before attributing failure to geometry.',
    'Visual clearance uses downward rays on ground/bridge meshes beneath the center and four offsets of 6 cm; the highest local support prevents narrow plank seams being mistaken for missing decks. Raw center-ray gaps are also retained. This is a support-height comparison, not a complete visual capsule penetration test.',
  ], models: [], routes: [], issues: [],
};
function issue(severity, code, message, context) {
  report.issues.push({ severity, code, message, ...(context === undefined ? {} : { context }) });
}
const round = value => Number(value.toFixed(6));
const vec = p => [round(p.x), round(p.y), round(p.z)];
const coordinate = ([x, y]) => ({ x, z: -y });
const clone = value => JSON.parse(JSON.stringify(value));
const VENUE_IDS = ['kissa_aoi', 'ramen_akari', 'bookshop_tsuki', 'sakura_bakery', 'izakaya_tomo', 'tea_hanami', 'market_provisions', 'restaurant_momiji'];
const xy = marker => [marker.position[0], -marker.position[2]];

function venueMarkers(gameplay) {
  const byName = new Map(gameplay.markers.map(marker => [marker.name, marker]));
  const result = [];
  for (const id of VENUE_IDS) {
    const group = { id };
    for (const kind of ['entry', 'inside', 'interaction', 'npc']) {
      group[kind] = byName.get(`MARK_${kind}_${id}`);
      if (!group[kind]) issue('error', 'venue_marker_missing', 'Each of the eight venues needs entry, inside, interaction and NPC metadata.', { id, kind });
    }
    if (group.entry && group.inside && group.interaction && group.npc) result.push(group);
  }
  return result;
}

function cityRoute(venue) {
  const entry = xy(venue.entry), inside = xy(venue.inside), interaction = xy(venue.interaction);
  const forward = new THREE.Vector2(inside[0] - entry[0], inside[1] - entry[1]).normalize();
  const right = new THREE.Vector2(forward.y, -forward.x);
  const npc = xy(venue.npc);
  const side = Math.sign((npc[0] - interaction[0]) * right.x + (npc[1] - interaction[1]) * right.y) || 1;
  const turn = [interaction[0] + right.x * 0.65 * side, interaction[1] + right.y * 0.65 * side];
  let approach;
  if (Math.abs(entry[0]) > 19) {
    const west = entry[0] < 0, street = west ? -20 : 20;
    approach = west ? [[5, -10], [5, -4], [-5, -4], [-5, -18.4], [street, -18.4], [street, entry[1]]]
      : [[5, -10], [5, -18.4], [street, -18.4], [street, entry[1]]];
  } else {
    approach = [[5, -10], [5, 18.2]];
    if (entry[0] < 0) approach.push([-5, 18.2]);
    approach.push([entry[0], 18.2]);
  }
  const route = [...approach, entry, inside, interaction, turn, interaction, inside, entry, approach.at(-1)];
  return { route, turn, approach, insideWaypoints: [entry, inside, interaction, turn] };
}

function glbDocument(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'glTF' || buffer.readUInt32LE(8) !== buffer.length) throw new Error('Invalid GLB header');
  return JSON.parse(buffer.toString('utf8', 20, 20 + buffer.readUInt32LE(12)));
}
function sourceCounts(document) {
  const counts = (document.meshes ?? []).map(mesh => {
    let triangles = 0;
    for (const primitive of mesh.primitives) {
      const count = document.accessors[primitive.indices ?? primitive.attributes.POSITION].count;
      const mode = primitive.mode ?? 4;
      triangles += mode === 4 ? count / 3 : (mode === 5 || mode === 6) ? Math.max(0, count - 2) : 0;
    }
    return { meshes: mesh.primitives.length, triangles };
  });
  const result = { meshes: 0, triangles: 0 };
  const visited = new Set();
  function visit(index) {
    if (visited.has(index)) return;
    visited.add(index);
    const node = document.nodes[index];
    if (node.mesh !== undefined) {
      result.meshes += counts[node.mesh].meshes;
      result.triangles += counts[node.mesh].triangles;
    }
    for (const child of node.children ?? []) visit(child);
  }
  for (const node of document.scenes[document.scene ?? 0].nodes ?? []) visit(node);
  return result;
}

async function loadModel(filename, gameplay) {
  const bytes = await readFile(new URL(`exports/${filename}`, root));
  const document = glbDocument(bytes);
  const expected = sourceCounts(document);
  const array = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new GLTFLoader().parseAsync(array, '');
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const stats = { filename, fileBytes: bytes.length, expectedFromGLB: expected, meshCount: 0, triangleCount: 0, markers: [], blossomMeshes: [], canopyVertexColorMeshes: [] };
  const materials = new Set();
  const allMeshes = [];
  scene.traverse(object => {
    if (object.isCamera || object.isLight || /(^SM_COL_|HumanScale|Backdrop|ScaleReference|CAM_|LGT_)/i.test(object.name)) {
      issue('error', 'scene_helper_leak', 'Camera, light, collision or presentation helper leaked into the environment GLB.', { filename, object: object.name });
    }
    if (!object.isMesh) return;
    allMeshes.push(object);
    stats.meshCount++;
    const geometry = object.geometry;
    stats.triangleCount += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.forEach(m => materials.add(m.uuid));
    const isCanopy = object.name.toLowerCase().includes('sakura_canopy') || objectMaterials.some(m => m.name.toLowerCase().includes('sakura_canopy'));
    const isBlossom = isCanopy || object.name.toLowerCase().includes('blossom') || objectMaterials.some(m => m.name.toLowerCase().includes('blossom'));
    if (isBlossom) {
      const attribute = geometry.getAttribute('color');
      let minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
      if (attribute) {
        for (let i = 0; i < attribute.count; i++) {
          for (let c = 0; c < 3; c++) {
            const value = attribute.getComponent(i, c);
            minimum[c] = Math.min(minimum[c], value);
            maximum[c] = Math.max(maximum[c], value);
          }
        }
      }
      const entry = {
        name: object.name, materials: objectMaterials.map(m => ({ name: m.name, color: m.color?.toArray(), vertexColors: m.vertexColors })),
        hasColor0: Boolean(attribute), colorCount: attribute?.count ?? 0,
        colorRange: attribute ? { min: minimum.map(round), max: maximum.map(round) } : null,
      };
      stats.blossomMeshes.push(entry);
      if (isCanopy) {
        stats.canopyVertexColorMeshes.push(entry);
        if (!attribute || attribute.count !== geometry.attributes.position.count || !objectMaterials.every(m => m.vertexColors)) {
          issue('error', 'canopy_vertex_color_missing', 'Sakura canopy must load COLOR_0 into a matching Three.js color attribute and enable material.vertexColors.', { filename, object: object.name });
        }
      }
    }
  });
  if (!stats.canopyVertexColorMeshes.length) issue('error', 'canopy_mesh_missing', 'Expected the sakura canopy vertex-color mesh in the exported scene.', filename);
  stats.materialCount = materials.size;
  const box = new THREE.Box3().setFromObject(scene, true);
  stats.bounds = { min: box.min.toArray().map(round), max: box.max.toArray().map(round), dimensions: box.getSize(new THREE.Vector3()).toArray().map(round) };
  stats.footprintAreaRatioToV1 = round(stats.bounds.dimensions[0] * stats.bounds.dimensions[2] / (38 * 32));
  if (stats.footprintAreaRatioToV1 < 2.6) issue('error', 'expanded_area_missing', 'Loaded environment footprint is smaller than the approximately threefold city expansion.', { filename, ratio: stats.footprintAreaRatioToV1 });
  if (stats.meshCount !== expected.meshes || stats.triangleCount !== expected.triangles) issue('error', 'loader_counts_mismatch', 'GLTFLoader scene mesh/triangle totals differ from GLB source graph.', { filename, expected, actual: { meshes: stats.meshCount, triangles: stats.triangleCount } });
  if (stats.triangleCount > 650000) issue('error', 'triangle_budget', 'Loaded scene exceeds 650,000 triangles.', filename);
  for (const marker of gameplay.markers) {
    const object = scene.getObjectByName(marker.name);
    if (!object) {
      issue('error', 'marker_missing', 'Gameplay marker missing from GLTFLoader scene.', { filename, name: marker.name });
      continue;
    }
    const position = object.getWorldPosition(new THREE.Vector3());
    const mismatchedProperties = Object.entries(marker.properties).filter(([key, value]) => JSON.stringify(object.userData[key]) !== JSON.stringify(value)).map(([key]) => key);
    const positionError = position.distanceTo(new THREE.Vector3(...marker.position));
    if (mismatchedProperties.length || positionError > 1e-4) issue('error', 'marker_metadata_mismatch', 'GLB marker extras or world position differ from gameplay metadata.', { filename, name: marker.name, mismatchedProperties, positionError });
    stats.markers.push({ name: marker.name, position: vec(position), properties: clone(object.userData), positionError: round(positionError) });
  }
  report.models.push(stats);
  return { scene, allMeshes, stats };
}

function createWorld(gameplay, startXY, footHeight = 0.30) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  const colliderNames = new Map();
  for (const box of gameplay.colliders) {
    if (box.shape !== 'box' || box.halfExtents.some(v => !Number.isFinite(v) || v <= 0)) throw new Error(`Invalid collider box: ${box.name}`);
    const [x, y, z, w] = box.quaternion;
    const desc = RAPIER.ColliderDesc.cuboid(...box.halfExtents)
      .setTranslation(...box.position).setRotation({ x, y, z, w });
    const collider = world.createCollider(desc);
    colliderNames.set(collider.handle, box.name);
  }
  const radius = 0.28, height = 1.7, halfHeight = (height - 2 * radius) / 2;
  const start = coordinate(startXY);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, footHeight + height / 2 + 0.05, start.z));
  const player = world.createCollider(RAPIER.ColliderDesc.capsule(halfHeight, radius), body);
  const controller = world.createCharacterController(0.015);
  controller.setUp({ x: 0, y: 1, z: 0 });
  controller.setMaxSlopeClimbAngle(35 * Math.PI / 180);
  controller.setMinSlopeSlideAngle(36 * Math.PI / 180);
  controller.enableSnapToGround(0.30);
  if (typeof controller.enableAutostep === 'function') controller.enableAutostep(0.22, 0.12, true);
  controller.setSlideEnabled(true);
  world.step();
  return { world, body, player, controller, colliderNames, radius, height, halfHeight };
}

function checkNpcOccupancy(venue, gameplay) {
  const state = createWorld(gameplay, xy(venue.npc), venue.npc.position[1]);
  const { world, body, player, controller, colliderNames, height } = state;
  const contacts = [];
  let maximumPenetration = 0;
  function inspectContacts(stage) {
    world.forEachCollider(other => {
      if (other.handle === player.handle) return;
      const contact = player.contactCollider(other, 0.01);
      if (contact?.distance < -0.005) {
        maximumPenetration = Math.max(maximumPenetration, -contact.distance);
        contacts.push({ stage, collider: colliderNames.get(other.handle), penetration: round(-contact.distance) });
      }
    });
  }
  inspectContacts('spawn');
  for (let frame = 0; frame < 60; frame++) {
    controller.computeColliderMovement(player, { x: 0, y: -0.03, z: 0 });
    const position = body.translation(), move = controller.computedMovement();
    body.setNextKinematicTranslation({ x: position.x + move.x, y: position.y + move.y, z: position.z + move.z });
    world.step();
  }
  inspectContacts('settled');
  const position = body.translation(), grounded = controller.computedGrounded();
  const result = { venue: venue.id, marker: venue.npc.name, markerPosition: venue.npc.position, capsuleCenter: vec(position), settledFootHeight: round(position.y - height / 2), grounded, maximumPenetration: round(maximumPenetration), contacts };
  if (!grounded || maximumPenetration > 0.015 || position.y < 0.7) issue('error', 'npc_occupancy_blocked', 'NPC capsule does not occupy a supported, unobstructed position.', result);
  world.free();
  return result;
}

// Spatially index exported triangles. Exact capsule/triangle distance tests use
// a vertical center segment plus radius, independently of authored box colliders.
function visualTriangleIndex(meshes) {
  const total = meshes.reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3, 0);
  const vertices = new Float64Array(total * 9), bounds = new Float32Array(total * 6), meshIds = new Uint32Array(total);
  const buckets = new Map(), cellSize = 4;
  let triangleCount = 0;
  const p = new THREE.Vector3();
  meshes.forEach((mesh, meshIndex) => {
    const geometry = mesh.geometry, attribute = geometry.attributes.position, indices = geometry.index;
    const count = indices?.count ?? attribute.count;
    for (let i = 0; i < count; i += 3) {
      const ti = triangleCount++, offset = ti * 9;
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let j = 0; j < 3; j++) {
        const index = indices ? indices.getX(i + j) : i + j;
        p.fromBufferAttribute(attribute, index).applyMatrix4(mesh.matrixWorld);
        vertices[offset + j * 3] = p.x; vertices[offset + j * 3 + 1] = p.y; vertices[offset + j * 3 + 2] = p.z;
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); minZ = Math.min(minZ, p.z);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); maxZ = Math.max(maxZ, p.z);
      }
      bounds.set([minX, minY, minZ, maxX, maxY, maxZ], ti * 6); meshIds[ti] = meshIndex;
      for (let x = Math.floor(minX / cellSize); x <= Math.floor(maxX / cellSize); x++) {
        for (let z = Math.floor(minZ / cellSize); z <= Math.floor(maxZ / cellSize); z++) {
          const key = `${x},${z}`;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(ti);
        }
      }
    }
  });
  return { vertices, bounds, meshIds, meshes, buckets, cellSize, triangleCount };
}

function segmentDistanceSquared(a, b, c, d) {
  // Closest points between finite segments, including parallel/degenerate cases.
  const u = b.clone().sub(a), v = d.clone().sub(c), w = a.clone().sub(c);
  const aa = u.dot(u), bb = u.dot(v), cc = v.dot(v), dd = u.dot(w), ee = v.dot(w);
  const denominator = aa * cc - bb * bb;
  let sN, sD = denominator, tN, tD = denominator;
  if (denominator < 1e-12) { sN = 0; sD = 1; tN = ee; tD = cc; }
  else {
    sN = bb * ee - cc * dd; tN = aa * ee - bb * dd;
    if (sN < 0) { sN = 0; tN = ee; tD = cc; }
    else if (sN > sD) { sN = sD; tN = ee + bb; tD = cc; }
  }
  if (tN < 0) {
    tN = 0;
    if (-dd < 0) sN = 0; else if (-dd > aa) sN = sD; else { sN = -dd; sD = aa; }
  } else if (tN > tD) {
    tN = tD;
    if (-dd + bb < 0) sN = 0; else if (-dd + bb > aa) sN = sD; else { sN = -dd + bb; sD = aa; }
  }
  const sc = Math.abs(sN) < 1e-12 ? 0 : sN / sD;
  const tc = Math.abs(tN) < 1e-12 ? 0 : tN / tD;
  return w.addScaledVector(u, sc).addScaledVector(v, -tc).lengthSq();
}

function visualCapsule(index, center, radius = 0.28, height = 1.7) {
  const { vertices, bounds, buckets, cellSize, meshes, meshIds } = index;
  const bottom = center.y - height / 2;
  const a = new THREE.Vector3(center.x, bottom + radius, center.z), b = new THREE.Vector3(center.x, bottom + height - radius, center.z);
  const candidates = new Set();
  for (let x = Math.floor((center.x - radius) / cellSize); x <= Math.floor((center.x + radius) / cellSize); x++) {
    for (let z = Math.floor((center.z - radius) / cellSize); z <= Math.floor((center.z + radius) / cellSize); z++) {
      for (const ti of buckets.get(`${x},${z}`) ?? []) candidates.add(ti);
    }
  }
  const triangle = new THREE.Triangle(), closest = new THREE.Vector3(), normal = new THREE.Vector3();
  let maximumPenetration = 0, groundOverlap = 0;
  const collisionMeshes = new Set();
  for (const ti of candidates) {
    const bi = ti * 6;
    if (bounds[bi] > center.x + radius || bounds[bi + 3] < center.x - radius || bounds[bi + 1] > bottom + height || bounds[bi + 4] < bottom || bounds[bi + 2] > center.z + radius || bounds[bi + 5] < center.z - radius) continue;
    const vi = ti * 9;
    triangle.a.fromArray(vertices, vi); triangle.b.fromArray(vertices, vi + 3); triangle.c.fromArray(vertices, vi + 6);
    triangle.getNormal(normal);
    let distanceSquared = Math.min(triangle.closestPointToPoint(a, closest).distanceToSquared(a), triangle.closestPointToPoint(b, closest).distanceToSquared(b));
    for (const [c, d] of [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]]) distanceSquared = Math.min(distanceSquared, segmentDistanceSquared(a, b, c, d));
    const denominator = normal.dot(b.clone().sub(a));
    if (Math.abs(denominator) > 1e-12) {
      const t = normal.dot(triangle.a.clone().sub(a)) / denominator;
      if (t >= 0 && t <= 1 && triangle.containsPoint(a.clone().lerp(b, t))) distanceSquared = 0;
    }
    const penetration = radius - Math.sqrt(Math.max(0, distanceSquared));
    if (penetration > 0.005) {
      // Deliberate paving overlays should be visible in the report without
      // classifying a few centimeters at the capsule foot as blocked furniture.
      if (bounds[bi + 4] < bottom + 0.08) groundOverlap = Math.max(groundOverlap, penetration);
      else { maximumPenetration = Math.max(maximumPenetration, penetration); collisionMeshes.add(meshes[meshIds[ti]].name); }
    }
  }
  return { maximumPenetration: round(maximumPenetration), pavingOverlap: round(groundOverlap), collisionMeshes: [...collisionMeshes].sort() };
}

function checkVenueVisualClearance(venue, routePlan, gameplay, visualIndex) {
  const samples = [];
  // Test the full central route through the door, into the venue and sideways
  // toward the NPC. Physics support height is measured at every sample.
  for (let segment = 0; segment < routePlan.insideWaypoints.length - 1; segment++) {
    const start = routePlan.insideWaypoints[segment], end = routePlan.insideWaypoints[segment + 1];
    const count = Math.max(1, Math.ceil(Math.hypot(end[0] - start[0], end[1] - start[1]) / 0.30));
    for (let i = 0; i <= count; i++) samples.push([start[0] + (end[0] - start[0]) * i / count, start[1] + (end[1] - start[1]) * i / count]);
  }
  const state = createWorld(gameplay, xy(venue.entry));
  const { world, body, player, controller, height } = state;
  const results = [];
  for (const point of samples) {
    const p = coordinate(point);
    body.setTranslation({ x: p.x, y: venue.entry.position[1] + height / 2 + 0.06, z: p.z }, true);
    body.setNextKinematicTranslation(body.translation());
    world.step();
    for (let frame = 0; frame < 12; frame++) {
      controller.computeColliderMovement(player, { x: 0, y: -0.04, z: 0 });
      const current = body.translation(), move = controller.computedMovement();
      body.setNextKinematicTranslation({ x: current.x + move.x, y: current.y + move.y, z: current.z + move.z });
      world.step();
    }
    results.push({ sourceXY: point.map(round), capsuleCenter: vec(body.translation()), ...visualCapsule(visualIndex, body.translation()) });
  }
  world.free();
  const blocked = results.filter(r => r.maximumPenetration > 0.025);
  if (blocked.length) issue('error', 'venue_visible_geometry_blocks_capsule', 'Exported visible geometry overlaps the sampled door/interior capsule path beyond 2.5 cm.', { venue: venue.id, samples: blocked });
  return { venue: venue.id, samples: results.length, blockedSamples: blocked, maxPenetration: Math.max(0, ...results.map(r => r.maximumPenetration)), maxPavingOverlap: Math.max(0, ...results.map(r => r.pavingOverlap)) };
}

function traverseRoute(name, route, gameplay, model) {
  const state = createWorld(gameplay, route[0]);
  const { world, body, player, controller, colliderNames, height } = state;
  const dt = 1 / 60, speed = 2.4, tolerance = 0.06;
  const supportMeshes = model.allMeshes.filter(mesh => (/ground|bridge|floor|paving|city_street/i.test(mesh.name)));
  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const normalMatrix = new THREE.Matrix3();
  const sample = {
    name, centerlineBlenderXY: route, reached: false, waypointsReached: [],
    frames: 0, horizontalDistance: 0, maxVisualFootGap: 0, maxVisualFootPenetration: 0,
    maxCollisionPenetration: 0, maxVerticalStep: 0, groundedFrames: 0,
    rawMaxCenterRayFootGap: 0, centerRaySeamMisses: 0,
    missingVisualSupportSamples: 0, collisionNames: [], trace: [],
  };
  const collisions = new Set();
  let vy = 0, fallen = false;
  function tick(dx = 0, dz = 0, record = true) {
    const before = body.translation();
    vy = Math.max(-8, vy - 9.81 * dt);
    controller.computeColliderMovement(player, { x: dx, y: vy * dt, z: dz });
    const move = controller.computedMovement();
    const grounded = controller.computedGrounded();
    body.setNextKinematicTranslation({ x: before.x + move.x, y: before.y + move.y, z: before.z + move.z });
    world.step();
    if (grounded) vy = 0;
    const after = body.translation();
    sample.frames++;
    if (after.y < 0.5 || after.y > 4) fallen = true;
    if (!record) return;
    sample.horizontalDistance += Math.hypot(after.x - before.x, after.z - before.z);
    sample.maxVerticalStep = Math.max(sample.maxVerticalStep, Math.abs(after.y - before.y));
    if (grounded) sample.groundedFrames++;
    for (let i = 0; i < controller.numComputedCollisions(); i++) {
      const hit = controller.computedCollision(i);
      if (hit?.collider) collisions.add(colliderNames.get(hit.collider.handle) ?? `handle:${hit.collider.handle}`);
    }
    // Rapier contact distances are negative for penetration. Prediction keeps
    // nearby contacts in scope but never changes the world or the movement.
    if (sample.frames % 6 === 0) {
      world.forEachCollider(other => {
        if (other.handle === player.handle) return;
        const contact = player.contactCollider(other, 0.02);
        if (contact?.distance < 0) sample.maxCollisionPenetration = Math.max(sample.maxCollisionPenetration, -contact.distance);
      });
      const footY = after.y - height / 2;
      const supports = [];
      for (const [ox, oz] of [[0, 0], [-0.06, 0], [0.06, 0], [0, -0.06], [0, 0.06]]) {
        raycaster.set(new THREE.Vector3(after.x + ox, footY + 0.8, after.z + oz), down);
        raycaster.near = 0; raycaster.far = 3;
        const hits = raycaster.intersectObjects(supportMeshes, false);
        supports.push(hits.find(hit => {
          if (!hit.face) return false;
          normalMatrix.getNormalMatrix(hit.object.matrixWorld);
          return hit.face.normal.clone().applyNormalMatrix(normalMatrix).y > 0.5;
        }));
      }
      const support = supports.filter(Boolean).sort((a, b) => b.point.y - a.point.y)[0];
      if (supports[0]) sample.rawMaxCenterRayFootGap = Math.max(sample.rawMaxCenterRayFootGap, footY - supports[0].point.y);
      if (support && (!supports[0] || support.point.y - supports[0].point.y > 0.10)) sample.centerRaySeamMisses++;
      if (support) {
        const gap = footY - support.point.y;
        sample.maxVisualFootGap = Math.max(sample.maxVisualFootGap, gap);
        sample.maxVisualFootPenetration = Math.max(sample.maxVisualFootPenetration, -gap);
        if (sample.frames % 30 === 0) sample.trace.push({ frame: sample.frames, position: vec(after), footY: round(footY), visualSupportY: round(support.point.y), supportMesh: support.object.name, gap: round(gap), grounded });
      } else {
        sample.missingVisualSupportSamples++;
        if (sample.frames % 30 === 0) sample.trace.push({ frame: sample.frames, position: vec(after), grounded, visualSupport: null });
      }
    }
  }
  // Settle from a slightly elevated spawn; this is not part of route metrics.
  for (let i = 0; i < 45; i++) tick(0, 0, false);
  for (let waypoint = 1; waypoint < route.length; waypoint++) {
    const target = coordinate(route[waypoint]);
    let reached = false, bestDistance = Infinity, staleFrames = 0;
    for (let frame = 0; frame < 2400 && !fallen; frame++) {
      const position = body.translation();
      const dx = target.x - position.x, dz = target.z - position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < tolerance) { reached = true; break; }
      if (distance < bestDistance - 0.02) { bestDistance = distance; staleFrames = 0; } else staleFrames++;
      if (staleFrames > 180) break;
      const step = Math.min(speed * dt, distance);
      tick(dx / distance * step, dz / distance * step);
    }
    sample.waypointsReached.push({ index: waypoint, targetBlenderXY: route[waypoint], reached, position: vec(body.translation()) });
    if (!reached) { sample.stuckAtWaypoint = waypoint; break; }
  }
  for (let i = 0; i < 15; i++) tick(0, 0);
  const end = coordinate(route.at(-1)), position = body.translation();
  sample.endpointDistance = Math.hypot(end.x - position.x, end.z - position.z);
  sample.finalPosition = vec(position);
  sample.reached = !fallen && sample.waypointsReached.length === route.length - 1 && sample.waypointsReached.every(w => w.reached) && sample.endpointDistance < tolerance;
  sample.collisionNames = [...collisions].sort();
  sample.fallen = fallen;
  sample.parameters = { radius: state.radius, standingHeight: state.height, capsuleHalfHeight: state.halfHeight, stepHeight: 0.22, stepMinWidth: 0.12, maxSlopeDegrees: 35, slideSlopeDegrees: 36, groundSnap: 0.30, controllerOffset: 0.015, autostep: controller.autostepEnabled(), speed, timestep: dt, waypointTolerance: tolerance };
  for (const key of ['horizontalDistance', 'maxVisualFootGap', 'maxVisualFootPenetration', 'maxCollisionPenetration', 'maxVerticalStep', 'endpointDistance', 'rawMaxCenterRayFootGap']) sample[key] = round(sample[key]);
  if (!sample.reached) issue('error', 'route_not_reached', 'Character controller did not reach every waypoint; inspect target and stuck position before attributing the failure to geometry.', { name, stuckAtWaypoint: sample.stuckAtWaypoint, finalPosition: sample.finalPosition, endpointDistance: sample.endpointDistance, fallen });
  if (sample.maxCollisionPenetration > 0.015) issue('error', 'capsule_collider_penetration', 'Character penetrated a physics collider by more than 1.5 cm.', { name, depth: sample.maxCollisionPenetration });
  if (sample.maxVisualFootPenetration > 0.10 || sample.maxVisualFootGap > 0.16) issue('note', 'visual_support_difference', 'Measured centerline feet/visual-floor difference merits inspection; capsule shape on slopes and intentional paving offsets can contribute.', { name, penetration: sample.maxVisualFootPenetration, gap: sample.maxVisualFootGap });
  report.routes.push(sample);
  world.free();
  return sample;
}

try {
  const gameplay = JSON.parse(await readFile(new URL('exports/kyoto_city_gameplay.json', root), 'utf8'));
  const names = new Set(gameplay.markers.map(m => m.name));
  if (gameplay.markers.length < 41 || names.size !== gameplay.markers.length) issue('error', 'gameplay_marker_inventory', 'Expected at least 41 unique markers: 32 venue, 5 original and 4 market markers.', { count: gameplay.markers.length, unique: names.size });
  for (const name of ['MARK_player_spawn', 'MARK_bridge_midpoint', 'MARK_npc_cafe', 'MARK_npc_guide', 'MARK_npc_inn', 'MARK_City_Market_Produce', 'MARK_City_Market_Tea', 'MARK_City_Market_Fish', 'MARK_City_Market_Dango']) {
    if (!names.has(name)) issue('error', 'required_base_or_market_marker_missing', 'Required central-district or market marker is absent.', name);
  }
  const lod0 = await loadModel('kyoto_city.glb', gameplay);
  await loadModel('kyoto_city_lod1.glb', gameplay);
  await RAPIER.init();
  report.runtime.rapier = RAPIER.version();
  report.colliderCount = gameplay.colliders.length;
  const guide = [[5, -10], [5, -4], [0, -4], [-5, -4], [-5, 1], [-7.2, 1]];
  const innMarker = gameplay.markers.find(m => m.name === 'MARK_npc_inn');
  const cafeMarker = gameplay.markers.find(m => m.name === 'MARK_npc_cafe');
  const innApproach = innMarker ? [innMarker.position[0] - 0.8, -innMarker.position[2]] : [8, 7.1];
  const cafeApproach = cafeMarker ? [cafeMarker.position[0] - 0.8, -cafeMarker.position[2]] : [8.2, -1.85];
  const routes = {
    spawn_to_guide: guide,
    guide_to_spawn: [...guide].reverse(),
    spawn_to_cafe: [[5, -10], [5, -4], [5, cafeApproach[1]], cafeApproach],
    spawn_to_inn: [[5, -10], [5, innApproach[1]], innApproach],
    north_bridge_east_to_west: [[5, 18.2], [-5, 18.2]],
    north_bridge_west_to_east: [[-5, 18.2], [5, 18.2]],
  };
  for (const [name, route] of Object.entries(routes)) traverseRoute(name, route, gameplay, lod0);
  const venues = venueMarkers(gameplay);
  report.venueCount = venues.length;
  report.npcOccupancy = [];
  report.venueVisualClearance = [];
  const visualIndex = visualTriangleIndex(lod0.allMeshes);
  report.visualCollisionMethod = {
    triangles: visualIndex.triangleCount,
    method: 'Exact distance between vertical capsule center segment and exported triangles; broad phase uses a 4 m spatial grid. Door/interior paths sampled every 30 cm. Paving overlaps under 8 cm above the foot are reported separately.',
    maximumAllowedFurniturePenetration: 0.025,
  };
  for (const venue of venues) {
    const plan = cityRoute(venue);
    const routeResult = traverseRoute(`venue_${venue.id}_enter_turn_exit`, plan.route, gameplay, lod0);
    const turnIndex = plan.approach.length + 3;
    const actualTurn = routeResult.waypointsReached.find(w => w.index === turnIndex);
    const turnPosition = actualTurn?.position;
    const interactionDistance = turnPosition ? Math.hypot(turnPosition[0] - venue.npc.position[0], turnPosition[2] - venue.npc.position[2]) : null;
    const radius = venue.npc.properties?.interaction_radius ?? 2.8;
    routeResult.venueInteraction = { npc: venue.npc.name, interactionRadius: radius, reachedTurn: Boolean(actualTurn?.reached), measuredDistance: interactionDistance === null ? null : round(interactionDistance) };
    if (!actualTurn?.reached || interactionDistance > radius) issue('error', 'venue_npc_out_of_interaction_range', 'Interior turn must bring the player within the NPC interaction radius.', { venue: venue.id, ...routeResult.venueInteraction });
    const npc = checkNpcOccupancy(venue, gameplay);
    npc.visualCapsule = visualCapsule(visualIndex, new THREE.Vector3(...npc.capsuleCenter));
    if (npc.visualCapsule.maximumPenetration > 0.025) issue('error', 'npc_visible_geometry_overlap', 'NPC capsule intersects exported visible furniture or architecture.', { venue: venue.id, ...npc.visualCapsule });
    report.npcOccupancy.push(npc);
    report.venueVisualClearance.push(checkVenueVisualClearance(venue, plan, gameplay, visualIndex));
  }
  const checkedNpcMarkers = new Set(report.npcOccupancy.map(npc => npc.marker));
  for (const marker of gameplay.markers) {
    if (checkedNpcMarkers.has(marker.name) || !(marker.properties?.npc_id || String(marker.properties?.kind ?? '').startsWith('npc'))) continue;
    const legacyNpc = { id: marker.properties.npc_id ?? marker.name, npc: marker };
    const occupancy = checkNpcOccupancy(legacyNpc, gameplay);
    occupancy.visualCapsule = visualCapsule(visualIndex, new THREE.Vector3(...occupancy.capsuleCenter));
    if (occupancy.visualCapsule.maximumPenetration > 0.025) issue('error', 'npc_visible_geometry_overlap', 'NPC capsule intersects exported visible furniture or architecture.', { npc: marker.name, ...occupancy.visualCapsule });
    report.npcOccupancy.push(occupancy);
  }
  const maximumPavingOverlap = Math.max(0, ...report.venueVisualClearance.map(v => v.maxPavingOverlap), ...report.npcOccupancy.map(n => n.visualCapsule.pavingOverlap));
  if (maximumPavingOverlap > 0.025) issue('note', 'paving_overlay_offset', 'Thin visible paving lies slightly above the simplified physics ground; measured foot overlap is classified separately from furniture or doorway obstruction.', { maximumOverlap: round(maximumPavingOverlap) });
  report.verdict = report.issues.some(i => i.severity === 'error') ? 'FAIL' : report.issues.length ? 'PASS WITH NOTES' : 'PASS';
} catch (error) {
  issue('error', 'runtime_exception', String(error?.stack ?? error));
  report.verdict = 'FAIL';
}
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ verdict: report.verdict, report: fileURLToPath(output), models: report.models.map(m => ({ file: m.filename, meshes: m.meshCount, triangles: m.triangleCount })), routes: report.routes.map(r => ({ name: r.name, reached: r.reached, maxCollisionPenetration: r.maxCollisionPenetration, maxVisualFootGap: r.maxVisualFootGap, maxVisualFootPenetration: r.maxVisualFootPenetration })), issues: report.issues }, null, 2));
process.exitCode = report.verdict === 'FAIL' ? 1 : 0;
