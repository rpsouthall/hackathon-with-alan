import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createAvatar, loadAvatarTemplate, disposeAvatarTemplate } from "../characters/avatar";
import { SceneryCutaway, setOcclusionRay, isOccludingScenery } from "./occlusion";
import { addWorldLighting } from "./lighting";
import { CHARACTER_PRESETS } from "../characters/presets";
import type { EnvironmentManifest, NpcSnapshot, PlayerSnapshot, EncounterSnapshot } from "./schema";

export interface SceneEntities { players: PlayerSnapshot[]; npcs: NpcSnapshot[]; localPlayerId: string | null; encounters?: EncounterSnapshot[]; selectedNpcId?: string }
export interface SceneCallbacks { onMove: (direction: [number, number], yaw: number) => void; onInteract: (id: string) => void; onStatus: (status: string, error?: string) => void }
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

/** All positions are authority snapshots. This adapter renders and interpolates them. */
export function mountWorldScene(host: HTMLElement, environment: EnvironmentManifest, callbacks: SceneCallbacks) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  addWorldLighting(scene, renderer, environment);
  const camera = new THREE.OrthographicCamera(-12,12,12,-12,.1,250);
  let viewSpan = 24;
  const focus = new THREE.Vector3(...environment.spawn).add(new THREE.Vector3(0, 1, 0));
  camera.position.copy(focus).add(new THREE.Vector3(18,18,18));
  const controls = new OrbitControls(camera, renderer.domElement); controls.target.copy(focus); controls.enablePan = false;
  controls.minZoom=.6; controls.maxZoom=2.5; controls.minPolarAngle = Math.acos(1/Math.sqrt(3)); controls.maxPolarAngle = controls.minPolarAngle;
  controls.mouseButtons.LEFT = null; controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE; controls.update();
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
  let stopped = false, loaded: THREE.Object3D | null = null;
  const surfaces: THREE.Mesh[] = [];
  const cutaway = new SceneryCutaway();
  let occlusionHits = new Set<THREE.Mesh>();
  let lastOcclusionCheck = -Infinity;
  if (environment.assetUrl) {
    callbacks.onStatus("loading");
    new GLTFLoader().load(environment.assetUrl, (gltf) => {
      if (stopped) { disposeObject(gltf.scene); return; }
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
    }, undefined, (error) => { if (!stopped) { console.error("City asset loading failed", error); callbacks.onStatus("fallback", "Environment could not load. Showing the walkable collision layout."); } });
  } else callbacks.onStatus("placeholder");
  let template: Awaited<ReturnType<typeof loadAvatarTemplate>> | null = null;
  const templateReady = loadAvatarTemplate().then((asset) => { if(stopped) { disposeAvatarTemplate(asset); return null; } template=asset; return asset; }).catch(()=>null);
  type Actor = { root: THREE.Group; capsule: THREE.Mesh; target: THREE.Vector3; yaw: number; label: HTMLButtonElement; avatar?: ReturnType<typeof createAvatar>; appearanceKey?:string; npcId:string|null; previous:THREE.Vector3; labelBlocked?:boolean };
  const actors = new Map<string, Actor>();
  let entities: SceneEntities = {players:[],npcs:[],localPlayerId:null};
  let enabled = true, overview = false, walkingYaw = 0;
  const keys = new Set<string>(); let step: {direction:[number,number];until:number}|null=null;
  const movementKeys = new Set(["w","a","s","d","arrowup","arrowleft","arrowdown","arrowright"]);
  const ring = new THREE.Mesh(new THREE.RingGeometry(.48,.55,32),new THREE.MeshBasicMaterial({color:"#bd624c",transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
  ring.rotation.x=-Math.PI/2; ring.visible=false; scene.add(ring);
  function resetInput() {keys.clear();step=null;callbacks.onMove([0,0],walkingYaw);}
  function keyDown(event:KeyboardEvent) {
    const key=event.key.toLowerCase();
    if(movementKeys.has(key)) {event.preventDefault();if(enabled)keys.add(key);}
    if(key==="e"&&!event.repeat&&enabled) {
      const player=entities.players.find(p=>p.id===entities.localPlayerId);
      const nearby=player&&entities.npcs.filter(n=>new THREE.Vector3(...n.position).distanceTo(new THREE.Vector3(...player.position))<=n.interactionRadius).sort((a,b)=>new THREE.Vector3(...a.position).distanceToSquared(new THREE.Vector3(...player.position))-new THREE.Vector3(...b.position).distanceToSquared(new THREE.Vector3(...player.position)))[0];
      if(nearby)callbacks.onInteract(nearby.id);
    }
  }
  function keyUp(event:KeyboardEvent){keys.delete(event.key.toLowerCase());}
  const raycaster=new THREE.Raycaster(); let pointerStart=[0,0];
  function pointerDown(event:PointerEvent){pointerStart=[event.clientX,event.clientY];}
  function click(event:MouseEvent) {
    host.focus(); if(!enabled||Math.hypot(event.clientX-pointerStart[0],event.clientY-pointerStart[1])>5)return;
    const rect=renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);
    const hit=raycaster.intersectObjects([...actors.values()].filter(a=>a.npcId).map(a=>a.root),true).find(hit=>hit.object.visible);
    let node=hit?.object; while(node&&!node.userData.npcId)node=node.parent??undefined;
    if(node?.userData.npcId)callbacks.onInteract(node.userData.npcId);
  }
  host.addEventListener("keydown",keyDown);host.addEventListener("keyup",keyUp);host.addEventListener("blur",resetInput);window.addEventListener("blur",resetInput);
  renderer.domElement.addEventListener("pointerdown",pointerDown);renderer.domElement.addEventListener("click",click);
  const resize=new ResizeObserver(()=>{const width=Math.max(host.clientWidth,1),height=Math.max(host.clientHeight,1);renderer.setSize(width,height);camera.left=-viewSpan*width/height/2;camera.right=-camera.left;camera.top=viewSpan/2;camera.bottom=-viewSpan/2;camera.updateProjectionMatrix();});resize.observe(host);
  let frame=0,previous=performance.now(),lastInput=0,lastLabelCheck=0;
  const desiredFocus=new THREE.Vector3(), forward=new THREE.Vector3(),right=new THREE.Vector3(),velocity=new THREE.Vector3(), projected=new THREE.Vector3();
  const render=(now:number)=>{
    if(stopped)return; const dt=Math.min((now-previous)/1000,.1);previous=now;
    for(const actor of actors.values()) {
      actor.previous.copy(actor.root.position);actor.root.position.lerp(actor.target,1-Math.exp(-18*dt));
      const turn=Math.atan2(Math.sin(actor.yaw-actor.root.rotation.y),Math.cos(actor.yaw-actor.root.rotation.y));actor.root.rotation.y+=turn*(1-Math.exp(-12*dt));
      if(actor.avatar){velocity.subVectors(actor.root.position,actor.previous).divideScalar(Math.max(dt,.001));actor.avatar.setVelocity(velocity);actor.avatar.update(dt);}

    }
    const local=actors.get(`player:${entities.localPlayerId}`);
    if(local&&!overview){desiredFocus.copy(local.root.position).add(new THREE.Vector3(0,1,0));const delta=desiredFocus.clone().sub(controls.target).multiplyScalar(1-Math.exp(-8*dt));camera.position.add(delta);controls.target.add(delta);}
    controls.update();
    camera.updateMatrixWorld(true);
    if(now-lastInput>=50&&enabled){
      const x=Number(keys.has("d")||keys.has("arrowright"))-Number(keys.has("a")||keys.has("arrowleft"))||(step&&now<step.until?step.direction[0]:0);
      const z=Number(keys.has("s")||keys.has("arrowdown"))-Number(keys.has("w")||keys.has("arrowup"))||(step&&now<step.until?step.direction[1]:0);
      camera.getWorldDirection(forward);forward.y=0;forward.normalize();right.crossVectors(forward,THREE.Object3D.DEFAULT_UP).normalize();
      velocity.copy(right).multiplyScalar(x).addScaledVector(forward,-z);if(velocity.length()>1)velocity.normalize();
      if(x||z)walkingYaw=Math.atan2(velocity.x,velocity.z);callbacks.onMove([velocity.x,velocity.z],walkingYaw);lastInput=now;
    }
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
    cutaway.update(occlusionHits,now,dt,(local?.root.position??focus).clone().add(new THREE.Vector3(0,1.2,0)),camera);
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
      actor.label.style.display=outside||actor.labelBlocked?"none":"block";
      actor.label.style.left=`${(projected.x*.5+.5)*host.clientWidth}px`;
      actor.label.style.top=`${(-projected.y*.5+.5)*host.clientHeight}px`;
    }
    if(checkLabels)lastLabelCheck=now;
    const selected=entities.npcs.find(n=>n.id===entities.selectedNpcId);ring.visible=Boolean(selected);if(selected)ring.position.set(selected.position[0],selected.position[1]+.04,selected.position[2]);
    renderer.render(scene,camera);frame=requestAnimationFrame(render);
  };frame=requestAnimationFrame(render);
  return {
    step(direction:[number,number]){if(enabled)step={direction,until:performance.now()+240};},
    setOverview(value:boolean){overview=value;resetInput();if(value){const center=new THREE.Vector3((environment.bounds.min[0]+environment.bounds.max[0])/2,0,(environment.bounds.min[2]+environment.bounds.max[2])/2);viewSpan=78;camera.zoom=1;controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(50,50,50));}else{viewSpan=24;camera.zoom=1;const p=actors.get(`player:${entities.localPlayerId}`)?.root.position??new THREE.Vector3(...environment.spawn);controls.target.copy(p).add(new THREE.Vector3(0,1,0));camera.position.copy(controls.target).add(new THREE.Vector3(18,18,18));}camera.left=-viewSpan*host.clientWidth/Math.max(1,host.clientHeight)/2;camera.right=-camera.left;camera.top=viewSpan/2;camera.bottom=-viewSpan/2;camera.updateProjectionMatrix();controls.update();},
    update(next:SceneEntities,inputEnabled:boolean){
      entities=next;if(enabled&&!inputEnabled)resetInput();enabled=inputEnabled;const present=new Set<string>();
      const items=[...next.players.map(p=>({key:`player:${p.id}`,position:p.position,yaw:p.yaw,name:p.id===next.localPlayerId?`${p.name} · you`:p.name,npcId:null as string|null,appearance:p.appearance})),...next.npcs.map(n=>({key:`npc:${n.id}`,position:n.position,yaw:n.yaw??0,name:n.name,npcId:n.id,appearance:CHARACTER_PRESETS[n.id as keyof typeof CHARACTER_PRESETS]?.appearance??CHARACTER_PRESETS.local_guide.appearance}))];
      for(const item of items){present.add(item.key);let actor=actors.get(item.key);
        if(!actor){const root=new THREE.Group();root.position.fromArray(item.position);root.userData.npcId=item.npcId;const capsule=new THREE.Mesh(new THREE.CapsuleGeometry(.28,1.14,4,8),new THREE.MeshStandardMaterial({color:item.npcId?"#bf7865":"#5c7f89"}));capsule.position.y=.85;root.add(capsule);scene.add(root);
          const label=document.createElement("button");label.type="button";label.textContent=item.name;label.className="world-actor-label";label.style.cssText="position:absolute;transform:translate(-50%,-100%);white-space:nowrap;border:1px solid #d9ccb2;border-radius:5px;background:#fff9e8e8;color:#35404a;font:600 11px system-ui;padding:3px 7px;pointer-events:auto;cursor:pointer;";label.addEventListener("click",()=>{if(item.npcId&&enabled)callbacks.onInteract(item.npcId);});host.appendChild(label);
          actor={root,capsule,target:new THREE.Vector3(...item.position),yaw:item.yaw,label,npcId:item.npcId,previous:new THREE.Vector3()};actors.set(item.key,actor);const owner=actor;
          templateReady.then(asset=>{if(!asset||stopped||actors.get(item.key)!==owner)return;owner.avatar=createAvatar(asset,item.appearance);owner.root.add(owner.avatar.object);owner.capsule.visible=false;owner.appearanceKey=JSON.stringify(item.appearance);});
        }
        actor.target.fromArray(item.position);actor.yaw=item.yaw;actor.label.textContent=item.name;
        if(actor.npcId){const local=next.players.find(p=>p.id===next.localPlayerId);if(local&&new THREE.Vector3(...local.position).distanceTo(actor.target)<4)actor.yaw=Math.atan2(local.position[0]-item.position[0],local.position[2]-item.position[2]);}
        const appearanceKey=JSON.stringify(item.appearance);if(actor.avatar&&appearanceKey!==actor.appearanceKey){actor.avatar.setAppearance(item.appearance);actor.appearanceKey=appearanceKey;}
        if(actor.npcId&&actor.avatar){const active=next.encounters?.some(e=>e.npcId===actor.npcId);actor.avatar.play(active?"Listen":"Idle");}
      }
      for(const [key,actor]of actors)if(!present.has(key)){actor.avatar?.dispose();scene.remove(actor.root);disposeObject(actor.root);actor.label.remove();actors.delete(key);}
    },
    dispose(){stopped=true;cancelAnimationFrame(frame);resize.disconnect();resetInput();controls.dispose();host.removeEventListener("keydown",keyDown);host.removeEventListener("keyup",keyUp);host.removeEventListener("blur",resetInput);window.removeEventListener("blur",resetInput);renderer.domElement.removeEventListener("pointerdown",pointerDown);renderer.domElement.removeEventListener("click",click);for(const actor of actors.values()){actor.avatar?.dispose();actor.label.remove();}scene.traverse(object=>{if(object instanceof THREE.Light) object.dispose();});disposeObject(scene);if(template)disposeAvatarTemplate(template);renderer.dispose();renderer.domElement.remove();},
  };
}
