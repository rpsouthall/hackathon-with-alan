import * as THREE from "three";
import { loadEnvironment } from "./load-environment";
import { GameCameraRig, type CameraView } from "./camera-rig";
import { PlayerInput } from "./player-input";
import { LocalMovementPredictor } from "./movement-prediction";
import { initWorldPhysics } from "./physics";
import { MovementSendThrottle, type MovementInput } from "./movement-input";
import { WorldVehicles } from "./vehicle-visuals";
import { VEHICLE_MOUNT_DISTANCE } from "./vehicle-contract";
import { EMOTES } from "./player-actions";
import { createAvatar, loadAvatarTemplate, disposeAvatarTemplate } from "../characters/avatar";
import { updateSpeakingAnimation } from "../characters/speaking-animation";
import { SceneryCutaway, setOcclusionRay, isOccludingScenery } from "./occlusion";
import { createWorldAtmosphere } from "./atmosphere";
import type { WorldTime } from "./day-cycle";
import type { WorldClockAnchor } from "./world-clock";
import { CHARACTER_PRESETS } from "../characters/presets";
import type { EnvironmentManifest, NpcSnapshot, PlayerSnapshot, EncounterSnapshot, VehicleSnapshot, Vec3 } from "./schema";

export interface SceneEntities { worldClock?: WorldClockAnchor | null; speakingPlayerIds?: readonly string[]; speakingNpcIds?: readonly string[]; vehicles?: VehicleSnapshot[]; players: PlayerSnapshot[]; npcs: NpcSnapshot[]; localPlayerId: string | null; encounters?: EncounterSnapshot[]; selectedNpcId?: string; encounterNpcId?: string }
export interface SceneCallbacks { onMountVehicle?: (id: string) => void; onDismountVehicle?: () => void; onMove: (direction: [number, number], yaw: number, sprint?: boolean) => number | void; onInteract: (id: string) => void; onStatus: (status: string, error?: string) => void; onToggleView?: () => void; onOpenEmotes?: () => void; onTime?: (time: WorldTime) => void; onWalking?: (walking: boolean, message: string) => void }
import type { createWalkingMap } from "./navigation";
function disposeObject(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>(), materials = new Set<THREE.Material>(), geometries = new Set<THREE.BufferGeometry>();
  root.traverse((object) => { if (object instanceof THREE.Mesh) {
    if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  } });
  geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose());
  textures.forEach((texture) => { texture.dispose(); if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) texture.image.close(); });
}

/** Authority snapshots reconcile local prediction; remote actors are interpolated. */
export function mountWorldScene(host: HTMLElement, environment: EnvironmentManifest, callbacks: SceneCallbacks) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.domElement.style.cssText = "display:block;width:100%;height:100%";
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const vehicles = new WorldVehicles(scene);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const atmosphere = createWorldAtmosphere(scene, renderer, environment, reducedMotion, callbacks.onTime);
  const spawn = new THREE.Vector3(...environment.spawn);
  const center = new THREE.Vector3((environment.bounds.min[0]+environment.bounds.max[0])/2,0,(environment.bounds.min[2]+environment.bounds.max[2])/2);
  const cameraRig = new GameCameraRig(spawn, center, renderer.domElement, reducedMotion);
  let camera = cameraRig.camera;
  const fallback = new THREE.Group();
  const debugMaterial = new THREE.MeshStandardMaterial({ color: "#9bab86" });
  if (environment.physics) {
    for (const box of environment.physics.colliders) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...box.halfExtents.map((v) => 2 * v) as [number, number, number]), debugMaterial);
      mesh.position.fromArray(box.position); mesh.quaternion.fromArray(box.quaternion); fallback.add(mesh);
    }
  } else {
    const {min,max} = environment.bounds;
    const ground = new THREE.Mesh(new THREE.BoxGeometry(max[0]-min[0], .15, max[2]-min[2]), debugMaterial);
    ground.position.set((min[0]+max[0])/2, environment.spawn[1]-.075, (min[2]+max[2])/2); fallback.add(ground);
    for (const box of environment.colliders) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...box.max.map((v,i)=>v-box.min[i]) as [number,number,number]),debugMaterial);
      mesh.position.fromArray(box.max.map((v,i)=>(v+box.min[i])/2)); fallback.add(mesh);
    }
  }
  scene.add(fallback);
  let stopped = false, paused = false, loaded: THREE.Object3D | null = null;
  const surfaces: THREE.Mesh[] = [];
  const cutaway = new SceneryCutaway();
  let occlusionHits = new Set<THREE.Mesh>();
  let lastOcclusionCheck = -Infinity;
  let environmentRequest = new AbortController();
  const loadWorld = () => {
    if (!environment.assetUrl || loaded || stopped) return;
    environmentRequest.abort();
    const request = new AbortController();
    environmentRequest = request;
    callbacks.onStatus("loading", "Downloading Kyoto…");
    let lastProgress = "";
    loadEnvironment(environment.assetUrl, { signal: request.signal, onProgress: ({stage, loaded: bytes, total}) => {
      if (stopped || request.signal.aborted) return;
      const message = stage === "prepare" ? "Preparing Kyoto…" : total > 0 ? `Downloading Kyoto… ${Math.min(99, Math.floor(bytes / total * 100))}%` : `Downloading Kyoto… ${(bytes / 1_000_000).toFixed(1)} MB`;
      if (message !== lastProgress) { lastProgress = message; callbacks.onStatus("loading", message); }
    } }).then((gltf) => {
      if (stopped || request.signal.aborted) { disposeObject(gltf.scene); return; }
      loaded = gltf.scene;
      const sourceMaterials = new Set<THREE.Material>();
      loaded.traverse((object) => {
        if (/^(COLLIDER_|SPAWN_|MARK_|SM_COL_)/.test(object.name)) object.visible = false;
        if (object instanceof THREE.Mesh) {
          object.castShadow = true; object.receiveShadow = true;
          object.geometry.computeBoundingBox();
          // Each mesh owns its cutaway uniforms; unrelated venues keep their materials.
          const copy = (material: THREE.Material) => { sourceMaterials.add(material); const clone = material.clone(); clone.dithering = true; return clone; };
          object.material = Array.isArray(object.material) ? object.material.map(copy) : copy(object.material);
          if(object.visible && isOccludingScenery(object)) { surfaces.push(object); cutaway.register(object); }
        }
      });
      sourceMaterials.forEach((material)=>material.dispose());
      scene.add(loaded); fallback.visible = false; callbacks.onStatus("ready");
    }).catch((error) => { if (!stopped && !request.signal.aborted) { console.error("City asset loading failed", error); callbacks.onStatus("fallback", "Kyoto couldn’t load. Please try again."); } });
  };
  if (environment.assetUrl) loadWorld(); else callbacks.onStatus("placeholder");
  let template: Awaited<ReturnType<typeof loadAvatarTemplate>> | null = null;
  const templateReady = loadAvatarTemplate().then((asset) => { if(stopped) { disposeAvatarTemplate(asset); return null; } template=asset; return asset; }).catch(()=>null);
  type Actor = { root: THREE.Group; capsule: THREE.Mesh; target: THREE.Vector3; yaw: number; label: HTMLButtonElement; labelText: HTMLSpanElement; speechMark: HTMLSpanElement; speaking?: boolean; avatar?: ReturnType<typeof createAvatar>; appearanceKey?:string; npcId:string|null; previous:THREE.Vector3; labelBlocked?:boolean; animation?:PlayerSnapshot["animation"]; emote?:PlayerSnapshot["emote"]; lastEmoteId?:number; vehicleId?:string|null };
  const actors = new Map<string, Actor>();
  let entities: SceneEntities = {players:[],npcs:[],localPlayerId:null};
  let enabled = true, overview = false, walkingYaw = 0;
  let predictor: LocalMovementPredictor | undefined;
  const syncPrediction = () => {
    const player = entities.players.find((candidate) => candidate.id === entities.localPlayerId);
    if (!player) return;
    predictor?.setBlocked(!enabled, performance.now());
    predictor?.reconcile(player, entities.vehicles?.find((vehicle) => vehicle.id === player.vehicleId), performance.now());
  };
  (environment.physics ? initWorldPhysics() : Promise.resolve()).then(() => {
    if (stopped) return;
    predictor = new LocalMovementPredictor(environment); syncPrediction();
  }).catch((error) => console.error("Local movement prediction could not initialize", error));
  const movementThrottle = new MovementSendThrottle();
  let pendingMovement: MovementInput | undefined;
  let movementTimer: ReturnType<typeof setTimeout> | undefined;
  function flushMovement(now = performance.now()) {
    if (!pendingMovement) return;
    const movement = pendingMovement;
    if (movementThrottle.take(movement, now)) {
      pendingMovement = undefined;
      const sequence = callbacks.onMove(movement.direction, movement.yaw, movement.sprint);
      if (typeof sequence === "number") predictor?.recordInput(sequence, movement.direction, movement.yaw, movement.sprint, now);
    } else if (movementTimer === undefined) {
      movementTimer = setTimeout(() => { movementTimer = undefined; flushMovement(); }, Math.max(1, movementThrottle.retryAfter(movement, now)));
    }
  }
  function sendMovement(direction: [number, number], yaw: number, sprint: boolean, now = performance.now()) {
    predictor?.recordLocalInput(direction, yaw, sprint, now);
    pendingMovement = { direction, yaw, sprint };
    flushMovement(now);
  }
  const input = new PlayerInput(); let step: {direction:[number,number];until:number;sprint:boolean}|null=null;
  let walkingMap: Promise<Awaited<ReturnType<typeof createWalkingMap>>> | undefined;
  let walkGeneration = 0;
  let walk: { npcId: string; route: Vec3[]; lastPosition: Vec3; progressed: number } | null = null;
  function stopWalking(message = '') { walkGeneration++; walk = null; callbacks.onWalking?.(false, message); }
  async function walkTo(npcId: string) {
    if (!enabled || stopped) return;
    resetInput();
    const generation = ++walkGeneration;
    const npc = entities.npcs.find(n => n.id === npcId), player = entities.players.find(p => p.id === entities.localPlayerId);
    if (!npc || !player || player.vehicleId) return;
    callbacks.onWalking?.(true, `Finding a path to ${npc.name}…`);
    try {
      walkingMap ??= import('./navigation').then(module => module.createWalkingMap(environment));
      const map = await walkingMap;
      if (generation !== walkGeneration || stopped || !enabled) return;
      const route = map.route(player.position, npc);
      if (!route?.length) { stopWalking('No clear walking route. Use WASD to move around the obstacle, then try again.'); return; }
      walk = { npcId, route, lastPosition: [...player.position], progressed: performance.now() };
      callbacks.onWalking?.(true, `Walking to ${npc.name} · WASD or Stop walking to cancel`);
    } catch { walkingMap = undefined; if (generation === walkGeneration && !stopped) stopWalking('Walking guidance is unavailable. Use WASD to approach the character.'); }
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(.48,.55,32),new THREE.MeshBasicMaterial({color:"#bd624c",transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
  ring.rotation.x=-Math.PI/2; ring.visible=false; scene.add(ring);
  function resetInput() {input.clear();step=null;stopWalking();sendMovement([0,0],walkingYaw,false);}
  function visibility() {if(document.hidden)resetInput();}
  function keyDown(event:KeyboardEvent) {
    if(!enabled)return;
    const action=input.keyDown(event);
    if (["w","a","s","d","arrowup","arrowleft","arrowdown","arrowright"].includes(event.key.toLowerCase())) stopWalking();
    if(action==="view") { resetInput(); callbacks.onToggleView?.(); }
    if(action==="emotes"&&!entities.players.find(p=>p.id===entities.localPlayerId)?.vehicleId) { resetInput(); callbacks.onOpenEmotes?.(); }
    if(action==="vehicle"&&!cameraRig.isTransitioning) {
      const player=entities.players.find(p=>p.id===entities.localPlayerId);
      if(player?.vehicleId){resetInput();callbacks.onDismountVehicle?.();}
      else if(player){const nearby=(entities.vehicles??[]).filter(v=>!v.riderId&&new THREE.Vector3(...v.position).distanceTo(new THREE.Vector3(...player.position))<=VEHICLE_MOUNT_DISTANCE).sort((a,b)=>new THREE.Vector3(...a.position).distanceToSquared(new THREE.Vector3(...player.position))-new THREE.Vector3(...b.position).distanceToSquared(new THREE.Vector3(...player.position)))[0];if(nearby){resetInput();callbacks.onMountVehicle?.(nearby.id);}}
    }
    if(action==="interact"&&!cameraRig.isTransitioning) {
      const player=entities.players.find(p=>p.id===entities.localPlayerId);
      const nearby=player&&!player.vehicleId&&entities.npcs.filter(n=>new THREE.Vector3(...n.position).distanceTo(new THREE.Vector3(...player.position))<=n.interactionRadius).sort((a,b)=>new THREE.Vector3(...a.position).distanceToSquared(new THREE.Vector3(...player.position))-new THREE.Vector3(...b.position).distanceToSquared(new THREE.Vector3(...player.position)))[0];
      if(nearby)callbacks.onInteract(nearby.id);
    }
  }
  function keyUp(event:KeyboardEvent){input.keyUp(event);}
  const raycaster=new THREE.Raycaster(); let pointerStart=[0,0];
  function pointerDown(event:PointerEvent){pointerStart=[event.clientX,event.clientY];}
  function click(event:MouseEvent) {
    host.focus(); if(!enabled||entities.players.find(p=>p.id===entities.localPlayerId)?.vehicleId||cameraRig.isTransitioning||Math.hypot(event.clientX-pointerStart[0],event.clientY-pointerStart[1])>5)return;
    const rect=renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);
    const hit=raycaster.intersectObjects([...actors.values()].filter(a=>a.npcId).map(a=>a.root),true).find(hit=>hit.object.visible);
    let node=hit?.object; while(node&&!node.userData.npcId)node=node.parent??undefined;
    if(node?.userData.npcId)callbacks.onInteract(node.userData.npcId);
  }
  host.addEventListener("keydown",keyDown);host.addEventListener("keyup",keyUp);host.addEventListener("blur",resetInput);window.addEventListener("blur",resetInput);
  document.addEventListener("visibilitychange",visibility);
  renderer.domElement.addEventListener("pointerdown",pointerDown);renderer.domElement.addEventListener("click",click);
  // Resize the drawing buffer on the next render frame. Writing layout inside
  // ResizeObserver can feed back into its delivery loop when the game opens.
  let resizePending = true;
  const resize = new ResizeObserver(() => { resizePending = true; });
  resize.observe(host);
  let frame=0,previous=performance.now(),lastLabelCheck=0;
  const forward=new THREE.Vector3(),right=new THREE.Vector3(),velocity=new THREE.Vector3(), projected=new THREE.Vector3();
  const render=(now:number)=>{
    if(stopped||paused)return; const dt=Math.min((now-previous)/1000,.1);previous=now;
    if (resizePending) {
      resizePending = false;
      const width = Math.max(host.clientWidth, 1), height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      cameraRig.resize(width, height);
    }
    atmosphere.update(dt);
    const simulationNow=performance.now();
    // Sample controls every rendered frame. Changes go out immediately; held
    // controls refresh at 20Hz. Drawing never waits for an authority reply.
    if(enabled&&!cameraRig.isTransitioning){
      const [keyX,keyZ]=input.direction;
      const x=keyX||(step&&now<step.until?step.direction[0]:0);
      const z=keyZ||(step&&now<step.until?step.direction[1]:0);
      camera.getWorldDirection(forward);forward.y=0;forward.normalize();right.crossVectors(forward,THREE.Object3D.DEFAULT_UP).normalize();
      velocity.copy(right).multiplyScalar(x).addScaledVector(forward,-z);if(velocity.length()>1)velocity.normalize();
      if (walk) {
        const player = entities.players.find(p => p.id === entities.localPlayerId), npc = entities.npcs.find(n => n.id === walk!.npcId);
        if (!player || !npc) stopWalking();
        else if (Math.hypot(...player.position.map((v, i) => v - npc.position[i])) <= npc.interactionRadius - 0.2) {
          stopWalking(`You are close to ${npc.name}. Start the conversation when you are ready.`);
        } else {
          if (Math.hypot(player.position[0] - walk.lastPosition[0], player.position[2] - walk.lastPosition[2]) > 0.12) { walk.lastPosition = [...player.position]; walk.progressed = now; }
          while (walk.route.length && Math.hypot(player.position[0] - walk.route[0][0], player.position[2] - walk.route[0][2]) < 0.22) walk.route.shift();
          const next = walk.route[0];
          if (!next || now - walk.progressed > 3000) stopWalking('Path blocked. Use WASD to move around the obstacle, then try again.');
          else { velocity.set(next[0] - player.position[0], 0, next[2] - player.position[2]); if (velocity.length() > 0) velocity.normalize(); }
        }
      }
      if(velocity.lengthSq())walkingYaw=Math.atan2(velocity.x,velocity.z);
      const direction:[number,number]=[velocity.x,velocity.z];
      const sprint=Boolean(!walk&&(x||z)&&(input.sprinting||(step&&now<step.until&&step.sprint)));
      sendMovement(direction,walkingYaw,sprint,simulationNow);
    }
    const predicted=predictor?.advance(simulationNow,dt);
    vehicles.update(dt);
    const riding=entities.players.find(player=>player.id===entities.localPlayerId)?.vehicleId;
    const predictedVehicle=riding?vehicles.items.get(riding):undefined;
    if(predicted&&predictedVehicle){predictedVehicle.root.position.fromArray(predicted.position);predictedVehicle.root.rotation.y=predicted.yaw;}
    for(const [key,actor] of actors) {
      actor.previous.copy(actor.root.position);
      const localPrediction=key===`player:${entities.localPlayerId}`?predicted:null;
      if(localPrediction){actor.root.position.fromArray(localPrediction.position);actor.yaw=localPrediction.yaw;actor.animation=localPrediction.animation;if(localPrediction.animation!=="idle")actor.emote=null;}
      else actor.root.position.lerp(actor.target,1-Math.exp(-18*dt));
      const turn=Math.atan2(Math.sin(actor.yaw-actor.root.rotation.y),Math.cos(actor.yaw-actor.root.rotation.y));actor.root.rotation.y+=turn*(1-Math.exp(-12*dt));
      const ride=actor.vehicleId?vehicles.items.get(actor.vehicleId):undefined;
      if(ride){actor.root.position.copy(ride.root.position);actor.root.rotation.y=ride.root.rotation.y;}
      if(actor.avatar){
        actor.avatar.setRiding(ride?{kind:ride.snapshot.kind,speed:ride.snapshot.speed,lean:ride.lean}:null);
        velocity.subVectors(actor.root.position,actor.previous).divideScalar(Math.max(dt,.001));
        if(actor.emote){
          if(actor.lastEmoteId!==actor.emote.id){actor.avatar.playEmote(actor.emote.name,actor.emote.elapsed);actor.lastEmoteId=actor.emote.id;}
        }else{
          if(actor.lastEmoteId!==undefined){actor.avatar.play("Idle");actor.lastEmoteId=undefined;}
          actor.avatar.setVelocity(velocity,actor.npcId?undefined:actor.animation==="run"?"run":"walk");
        }
        updateSpeakingAnimation(actor.avatar, !!actor.speaking, { moving: Math.hypot(velocity.x, velocity.z) >= .025, emoting: !!actor.emote, listening: !!actor.npcId && !!entities.encounters?.some(e => e.npcId === actor.npcId) });
        actor.avatar.update(dt);
      }

    }
    const local=actors.get(`player:${entities.localPlayerId}`);
    const encounterActor = entities.encounterNpcId ? actors.get(`npc:${entities.encounterNpcId}`) : undefined;
    cameraRig.setEncounter(encounterActor?.root.position ?? null, encounterActor?.root.rotation.y ?? 0);
    cameraRig.update(dt, local?.root.position ?? spawn);
    camera = cameraRig.camera;
    host.dataset.cameraView = overview ? "overview" : cameraRig.view;
    host.dataset.cameraTransition = String(cameraRig.isTransitioning);
    // Ray tests are throttled; smoothing still runs every rendered frame.
    if(now-lastOcclusionCheck>=50) {
      occlusionHits = new Set<THREE.Mesh>();
      if(local&&!overview&&surfaces.length) {
        const target=local.root.position.clone().add(new THREE.Vector3(0,1.2,0));
        const shoulder=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0).multiplyScalar(.22);
        scene.updateMatrixWorld(true);
        for(const offset of [-1,0,1]) {
          setOcclusionRay(raycaster,camera,target.clone().addScaledVector(shoulder,offset));
          for(const hit of raycaster.intersectObjects(surfaces,false)) {
            let visible=true;
            for(let node:THREE.Object3D|null=hit.object;node;node=node.parent) if(!node.visible) visible=false;
            if(visible&&hit.object instanceof THREE.Mesh) occlusionHits.add(hit.object);
          }
        }
        raycaster.near=0; raycaster.far=Infinity;
      }
      lastOcclusionCheck=now;
    }
    cutaway.update(occlusionHits,now,dt,(local?.root.position??spawn).clone().add(new THREE.Vector3(0,1.2,0)),camera);
    const checkLabels=now-lastLabelCheck>=120;
    for (const actor of actors.values()) {
      const head=actor.root.position.clone().add(new THREE.Vector3(0,2.1,0));
      projected.copy(head).project(camera);
      const outside=projected.z>1||projected.z< -1||Math.abs(projected.x)>1.05||Math.abs(projected.y)>1.05;
      if(checkLabels&&!outside&&actor.npcId) {
        setOcclusionRay(raycaster,camera,head);
        actor.labelBlocked=raycaster.intersectObjects(surfaces,false).some(hit=>hit.object.visible&&hit.object instanceof THREE.Mesh&&!cutaway.isCutAway(hit.object,hit.point));
        raycaster.near=0;raycaster.far=Infinity;
      }
      actor.label.style.display=entities.encounterNpcId||outside||actor.labelBlocked?"none":"block";
      actor.label.style.left=`${(projected.x*.5+.5)*host.clientWidth}px`;
      actor.label.style.top=`${(-projected.y*.5+.5)*host.clientHeight}px`;
    }
    if(checkLabels)lastLabelCheck=now;
    const selected=entities.npcs.find(n=>n.id===entities.selectedNpcId);ring.visible=Boolean(selected)&&!entities.encounterNpcId;if(selected)ring.position.set(selected.position[0],selected.position[1]+.04,selected.position[2]);
    renderer.render(scene,camera);frame=requestAnimationFrame(render);
  };frame=requestAnimationFrame(render);
  return {
    setPaused(value:boolean){
      if (stopped || paused === value) return;
      paused=value;
      if(paused){cancelAnimationFrame(frame);resetInput();}
      else {previous=performance.now();resizePending=true;frame=requestAnimationFrame(render);}
    },
    walkTo,
    cancelWalk: resetInput,
    retryEnvironment(){loadWorld();},
    setHour(hours:number,animate=true){atmosphere.setHour(hours,animate);},
    setTimePlaying(playing:boolean){atmosphere.setPlaying(playing);},
    returnToSharedTime(){atmosphere.returnToSharedTime();},
    step(direction:[number,number],sprint=false){if(enabled){stopWalking();step={direction,until:performance.now()+240,sprint};}},
    setView(value:CameraView){resetInput();overview=false;const local=actors.get(`player:${entities.localPlayerId}`);cameraRig.setView(value,local?.root.rotation.y??0);},
    setOverview(value:boolean){overview=value;resetInput();cameraRig.setOverview(value);},
    update(next:SceneEntities,inputEnabled:boolean){
      atmosphere.syncWorldClock(next.worldClock ?? null);
      entities=next;vehicles.sync(next.vehicles??[]);if(enabled&&!inputEnabled)resetInput();enabled=inputEnabled;cameraRig.setInputEnabled(inputEnabled);syncPrediction();const present=new Set<string>();
      const items=[...next.players.map(p=>({key:`player:${p.id}`,position:p.position,yaw:p.yaw,name:p.id===next.localPlayerId?`${p.name} · you`:p.name,npcId:null as string|null,appearance:p.appearance,animation:p.animation,emote:p.emote,vehicleId:p.vehicleId})),...next.npcs.map(n=>({key:`npc:${n.id}`,position:n.position,yaw:n.yaw??0,name:n.name,npcId:n.id,appearance:CHARACTER_PRESETS[n.id as keyof typeof CHARACTER_PRESETS]?.appearance??CHARACTER_PRESETS.local_guide.appearance,animation:"idle" as const,emote:null,vehicleId:null}))];
      for(const item of items){present.add(item.key);let actor=actors.get(item.key);
        if(!actor){const root=new THREE.Group();root.position.fromArray(item.position);root.userData.npcId=item.npcId;const capsule=new THREE.Mesh(new THREE.CapsuleGeometry(.28,1.14,4,8),new THREE.MeshStandardMaterial({color:item.npcId?"#bf7865":"#5c7f89"}));capsule.position.y=.85;root.add(capsule);scene.add(root);
          const label=document.createElement("button");label.type="button";label.textContent=item.name;label.className="world-actor-label";label.style.cssText="position:absolute;transform:translate(-50%,-100%);white-space:nowrap;border:1px solid #d9ccb2;border-radius:5px;background:#fff9e8e8;color:#35404a;font:600 11px system-ui;padding:3px 7px;pointer-events:auto;cursor:pointer;";label.addEventListener("click",()=>{if(item.npcId&&enabled&&!entities.players.find(p=>p.id===entities.localPlayerId)?.vehicleId)callbacks.onInteract(item.npcId);});host.appendChild(label);
          const labelText=document.createElement("span");labelText.textContent=item.name;
          const speechMark=document.createElement("span");speechMark.className="world-speaking-mark";speechMark.hidden=true;speechMark.setAttribute("aria-hidden","true");
          speechMark.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';
          label.replaceChildren(labelText,speechMark);
          actor={root,capsule,labelText,speechMark,target:new THREE.Vector3(...item.position),yaw:item.yaw,label,npcId:item.npcId,previous:new THREE.Vector3()};actors.set(item.key,actor);const owner=actor;
          templateReady.then(asset=>{if(!asset||stopped||actors.get(item.key)!==owner)return;owner.avatar=createAvatar(asset,item.appearance);owner.root.add(owner.avatar.object);owner.capsule.visible=false;owner.appearanceKey=JSON.stringify(item.appearance);});
        }
        actor.target.fromArray(item.position);actor.yaw=item.yaw;actor.animation=item.animation;actor.emote=item.emote;actor.vehicleId=item.vehicleId;
        actor.labelText.textContent=item.name+(item.emote?` · ${EMOTES[item.emote.name].label}`:item.animation==="run"?" · sprinting":"");
        if(actor.npcId){const local=next.players.find(p=>p.id===next.localPlayerId);if(local&&new THREE.Vector3(...local.position).distanceTo(actor.target)<4)actor.yaw=Math.atan2(local.position[0]-item.position[0],local.position[2]-item.position[2]);}
        const appearanceKey=JSON.stringify(item.appearance);if(actor.avatar&&appearanceKey!==actor.appearanceKey){actor.avatar.setAppearance(item.appearance);actor.appearanceKey=appearanceKey;}
        actor.speaking = actor.npcId ? !!next.speakingNpcIds?.includes(actor.npcId) : !!next.speakingPlayerIds?.includes(item.key.slice(7));
        actor.speechMark.hidden = !actor.speaking;
        actor.label.dataset.speaking = String(actor.speaking);
        actor.label.setAttribute("aria-label", `${actor.labelText.textContent}${actor.speaking ? " · speaking" : ""}`);
      }
      for(const [key,actor]of actors)if(!present.has(key)){actor.avatar?.dispose();scene.remove(actor.root);disposeObject(actor.root);actor.label.remove();actors.delete(key);}
    },
    dispose(){stopped=true;predictor?.dispose();environmentRequest.abort();cancelAnimationFrame(frame);resize.disconnect();resetInput();clearTimeout(movementTimer);pendingMovement=undefined;cameraRig.dispose();atmosphere.dispose();vehicles.dispose();host.removeEventListener("keydown",keyDown);host.removeEventListener("keyup",keyUp);host.removeEventListener("blur",resetInput);window.removeEventListener("blur",resetInput);document.removeEventListener("visibilitychange",visibility);renderer.domElement.removeEventListener("pointerdown",pointerDown);renderer.domElement.removeEventListener("click",click);for(const actor of actors.values()){actor.avatar?.dispose();actor.label.remove();}scene.traverse(object=>{if(object instanceof THREE.Light) object.dispose();});disposeObject(scene);if(template)disposeAvatarTemplate(template);renderer.dispose();renderer.domElement.remove();},
  };
}
