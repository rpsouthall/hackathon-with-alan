# Komorebi voxel NPCs

An original, editable character kit for the Kyoto Japanese conversation game. The muted slate, sage, coral and cream palette follows the supplied environment reference. Shared by NPC residents and customizable players, including the isometric game.

## Open the workshop

From this directory:

```sh
npm ci
npm start
```

Open **http://127.0.0.1:4174**. No API key, external fonts, textures or CDN requests are needed after dependencies are installed. The server binds to this computer only. Use `PORT=4175 npm start` if the default port is busy.

The **[Kyoto cast gallery](http://127.0.0.1:4174/cast/)** shows all 15 residents, with Idle, Walk, Run and Wave previews. These are the three original residents, four market vendors and eight venue hosts from the expanded city. The gallery shares one loaded GLB and one WebGL renderer.

- **Studio:** drag to orbit, scroll to zoom; choose a resident and edit their look.
- **Walk around:** focus the 3D view, then use WASD or arrows; hold Shift to run. Camera follows the character and can be orbited. The test courtyard has boundaries and simple obstacle collisions.
- **The cast:** three independently animated residents patrol authored routes.
- **Export character:** download the current visible appearance as an animated GLB.
- **Save / load look:** round-trip a small JSON settings file. The current look is also saved locally in the browser.
- **Talk:** previews a synthetic mouth envelope; it does not start a microphone or voice service.

## Files to use

| File | Purpose |
|---|---|
| `komorebi_npc.blend` | Editable master: named parts, all alternatives, rigid armature, seven actions, lighting and portrait camera |
| `komorebi_residents.blend` | Three exported residents re-imported into Blender, ready to inspect together |
| `exports/komorebi_npc.glb` | Complete customization kit; use with `VoxelNPC` to select mutually exclusive parts |
| `exports/local_guide.glb` | Haru, 1.75 m, jacket, cropped hair, day bag |
| `exports/cafe_owner.glb` | Aoi, 1.68 m, bob and café apron |
| `exports/inn_host.glb` | Ren, 1.80 m, topknot, haori and glasses |
| `presets/*.json` | Appearance configurations that can be loaded in the workshop |
| `src/npc.js` | Reusable Three.js asset loader, NPC, patrol and Kyoto marker adapter |
| `src/appearance.js` | Pure configuration and validation, with no Three.js dependency |
| `src/city-cast.js` | All 15 city identities and original appearance configurations |
| `exports/kyoto_city_cast.json` | Portable, versioned appearance catalog keyed by the authored marker IDs |
| `cast/` | Browser review gallery for the complete Kyoto City cast |
| `scripts/build_character.py` | Reproducible Blender source generator |
| `qa/` | Renders, automated tests, source and runtime validation reports |

The full kit intentionally contains every hair/outfit option. Loading that file with only `GLTFLoader` makes those alternatives overlap until visibility is configured. **Use `VoxelNPC` for customization, or a resident GLB for direct model loading.** Exported single-look GLBs contain only the selected parts; switching to parts that were omitted requires the full kit.

## Integrate with Three.js

Use the same Three.js installation throughout the application. This package pins `three@0.180.0`, matching the original Kyoto preview; the complete source/asset suite also passes on **Three.js 0.186.0**, used by the consolidated game. A bundler resolves the `three/addons/` imports; this workshop uses an import map. Copy all three modules in `src/` (`npc.js`, `appearance.js`, `city-cast.js`) together when integrating the runtime.

```js
import * as THREE from 'three';
import { loadNPCAsset, VoxelNPC, PRESETS, NPCPatrol } from './npcs/src/npc.js';

// Load once; geometry and animation clips can be shared by every NPC.
const template = await loadNPCAsset('/assets/komorebi_npc.glb');
const haru = new VoxelNPC(template, PRESETS.local_guide);
scene.add(haru.object);
haru.object.position.set(0, 0, 0); // world-space foot position

haru.setAppearance({ top: '#708779', hair: 'topknot', glasses: true });
haru.play('Wave', { once: true }); // returns to Idle after completion

const patrol = new NPCPatrol(haru, [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(2, 0, 0),
], { speed: 0.9, wait: 1.4 });

function tick(dt) {
  patrol.update(dt); // optional; movement first
  haru.update(dt);   // mixer, blink and mouth every frame
}

// Stop movement when a conversation starts.
patrol.enabled = false;
haru.play('Listen');
// When actual NPC speech plays: haru.play('Talk');
// haru.setSpeechLevel(normalizedOutputAudioRMS); // 0..1
// On speech end: haru.setSpeechLevel(0); haru.play('Listen');

// After conversation: haru.play('Idle'); patrol.enabled = true;
// On removal: haru.dispose(); // keeps shared template geometry available
```

`VoxelNPC` clones the skeleton using `SkeletonUtils.clone`, creates one `AnimationMixer` per resident, and copies materials per resident. Changing one NPC never changes another. When the whole template is no longer needed, dispose its shared geometries/materials separately.

### Place residents at the Kyoto markers

```js
import { spawnAtMarkers } from './npcs/src/npc.js';

const gameplay = await fetch('/assets/kyoto_gameplay.json').then(r => r.json());
const residents = spawnAtMarkers(template, gameplay, scene);
// In your frame loop:
residents.forEach(npc => npc.update(dt));
```

The adapter recognises both `npc` and `npc_spawn` markers and selects the matching entry from `CITY_PRESETS`. Marker positions already use metres and Y up. Venue hosts face their authored visitor interaction position; an explicit `facing_yaw` overrides this. Each NPC root exposes `userData.npcId`, `userData.venueId` and `userData.interactionRadius` for the interaction system. The room server should own placement and identity; use the catalog to populate its NPC descriptors.

`exports/kyoto_city_cast.json` contains `{ schemaVersion: 1, asset: "komorebi_npc.glb", characters: { [npcId]: appearance } }`. It supplies appearance and resident identity, not movement paths or dialogue. The GLB itself remains the same shared customization kit; there are no additional model downloads per resident.

For player creation, replicate only `hair`, `outfit`, `glasses`, `bag`, `height`, `skin`, `hairColor`, `top`, `accent`, `trousers` and `shoes`. Player identity and display name belong to the room's player record. Valid ranges are the same as `validateAppearance`: three hairstyles, three outfits, booleans for accessories, 1.4–2.1 m, six-digit hex colors. The server must validate submitted cosmetics before broadcasting them. A player's visible height is cosmetic; the game should use a consistent collision capsule for fair movement.

### Physics and navigation

The workshop is a flat movement sandbox. The patrol class follows caller-provided waypoints; it is **not a pathfinder or navmesh**. Integrate with the game's Rapier controller before using arbitrary routes through the Kyoto buildings, ramps or bridge.

`NPCPatrol` accepts `resolveMovement(currentFootPosition, proposedFootPosition, npc)`, which must return the resolved `THREE.Vector3` foot position after physics. The patrol measures actual movement to select/speed the gait. Alternatively control the root yourself and call `npc.setVelocity(actualVelocity)` after collision resolution.

For a vertical capsule, convert its centre to feet with `footY = centreY - halfHeight - radius`, where Rapier's capsule half-height is the half length of its straight middle section. The visible arms extend beyond the recommended 0.28 m body radius. Keep route clearance for the full shoulder width (~0.94 m), especially around narrow doors and other characters.

### Animation and sockets

| Clip name in GLB | Runtime name | Duration | Behaviour |
|---|---|---:|---|
| `AN_NPC_Idle` | `Idle` | 3.0 s | Gentle head/upper-body motion |
| `AN_NPC_Walk` | `Walk` | 1.0 s | Loop, in place |
| `AN_NPC_Run` | `Run` | 0.667 s | Loop, brisk stylized gait |
| `AN_NPC_Wave` | `Wave` | 2.0 s | Greeting; use `once: true` |
| `AN_NPC_Bow` | `Bow` | 2.2 s | Bow; use `once: true` |
| `AN_NPC_Talk` | `Talk` | 3.0 s | Gentle hand/head gestures |
| `AN_NPC_Listen` | `Listen` | 3.0 s | Attentive head tilt |

All clips are in place; the root never translates. Call `setVelocity()` with the actual world velocity to choose Idle/Walk/Run and adjust playback speed. The authored walk ground speed is 0.72 m/s, run 1.32 m/s; the runtime adjusts for size and speed. The gait is deliberately stylized, with flat stance feet and no ballistic jumping.

`getSocket(name, optionalTargetVector)` returns a world position. Names: `socket_voice`, `socket_head`, `socket_hand_L`, `socket_hand_R`. Attach objects to the corresponding bone if you also need orientation. `Blink` and `MouthOpen` are separate shape keys/morph targets; the runtime drives them independently of body clips. Mouth motion is a simple audio envelope, not phoneme lip sync.

## Edit in Blender

Open `komorebi_npc.blend`. The master rig is `ARM_Komorebi`; all export parts are in `COL_NPC_Export`. `COL_Presentation` contains only the floor, lights and camera. The source uses **Z up, -Y forward**, one unit per metre; GLB becomes **Y up, +Z forward**, with feet at the origin.

- Hair alternatives: `SM_NPC_Hair_crop`, `SM_NPC_Hair_bob`, `SM_NPC_Hair_topknot`.
- Outfit alternatives: `SM_NPC_Outfit_jacket`, `SM_NPC_Outfit_apron`, `SM_NPC_Outfit_haori`.
- Accessories: `SM_NPC_Glasses`, `SM_NPC_Bag`.
- Named material channels start `MAT_NPC_`: Skin, Hair, Top, Accent, Trousers, Shoes. Colours are simple Principled BSDF base colours.
- Select the armature and switch actions in the Action Editor; actions are also preserved in muted NLA tracks. Pose bones are a simple FK rig with no external dependencies.
- Hide/unhide alternative parts in the viewport and render settings when inspecting. The full-kit export includes all alternatives, with `npc_part` / `npc_option` metadata. These flags are interpreted by the runtime.
- Use shape keys on `SM_NPC_Eyes` and `SM_NPC_Mouth` to inspect Blink and MouthOpen.

The base grid is 2.5 cm. Surface meshing merges contiguous voxels, removes internal voxel faces and uses flat normals. Every vertex has one bone influence so blocks stay rigid. There are no textures/UV dependencies, smooth deformation or humanoid retargeting setup. Preserve names if you edit an asset that the runtime will load.

To regenerate from source (this overwrites the generated NPC master and exports in this folder):

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/build_character.py
npm run verify
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/render_showcase.py
```

Save manual edits under another filename before regeneration. These scripts run in a separate process and do not modify the Kyoto environment or the Blender window already open.

## Verified delivery

```sh
npm test
npm run verify
```

Thirteen tests cover loading, dimensions, independent clones/materials, customization validation, loop seams, floor contact, voice morphs, one-shot transitions, interrupted gestures, patrol arrival/resolver behaviour and Kyoto markers. They additionally cover all 15 authored city NPCs and every hairstyle/outfit/accessory combination at both height limits (72 combinations). Runtime validation exports and reloads all three presets, checks animated socket positions, and runs the Khronos glTF validator.

To check against another application's actual Three.js installation without changing this workshop's dependencies:

```sh
THREE_COMPAT_ROOT=/absolute/path/to/app/node_modules/three \
  node --import ./qa/register-compat.mjs --test qa/npc.test.mjs
```

| Asset | Triangles | Visible material primitives | GLB |
|---|---:|---:|---:|
| Entire customization kit | 1,606 | 25 total; mutually exclusive | ~266 KiB |
| Haru / local guide | 902 | 15 | ~367 KiB |
| Aoi / café owner | 696 | 12 | ~341 KiB |
| Ren / inn host | 900 | 14 | ~364 KiB |

Preset exports use Three.js's uncompressed exporter, so their animation data is larger than the Blender-optimized kit. For runtime spawning, load the compact kit once and clone it.

Every file validates with **zero glTF errors**. The validator reports `NODE_SKINNED_MESH_NON_ROOT` warnings for the standard nested armature/part structure; this hierarchy is tested in Three.js with scale, movement, animation and export/reload. This is documented rather than suppressed. Walk/run floor penetration measured below 0.7 mm at 120 samples per cycle. See `qa/runtime.json` for the precise figures.

Browser review verified the three presets, hairstyle/outfit selection, animation, third-person camera, keyboard movement, cast patrols and animated GLB export with no browser console warnings/errors. Blender re-import renders provide another check on geometry, materials and silhouette. The larger game's collision/navigation, camera obstruction and voice sessions remain integration work, as requested.

References: [Three.js GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html), [Three.js AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html). All character geometry is original; no external character models or texture licences are required.
