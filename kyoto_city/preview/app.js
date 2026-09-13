import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import RAPIER from '@dimforge/rapier3d-compat';

const $=id=>document.getElementById(id);
const scene=new THREE.Scene();scene.background=new THREE.Color('#8298a0');
const renderer=new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.AgXToneMapping;renderer.toneMappingExposure=1.25;
document.body.prepend(renderer.domElement);
const camera=new THREE.PerspectiveCamera(45,innerWidth/innerHeight,.05,600);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
controls.maxDistance=350;controls.minDistance=1;controls.maxPolarAngle=Math.PI*.49;
scene.add(new THREE.HemisphereLight(0xc3e1ff,0x657144,2.0));
const sun=new THREE.DirectionalLight(0xffdcad,3);sun.position.set(-22,40,20);sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-47,right:47,top:47,bottom:-47,near:.5,far:120});
sun.shadow.bias=-.0003;sun.shadow.normalBias=.04;scene.add(sun);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(500,500),new THREE.MeshStandardMaterial({color:0x748e94,roughness:1}));
floor.rotation.x=-Math.PI/2;floor.position.y=-2;floor.receiveShadow=true;scene.add(floor);

const cache={},keys=new Set();let current,lod=false,walking=false,yaw=0,pitch=0,vy=0,activeView='overview';
let world,body,collider,controller,gameplay,loadVersion=0,accumulator=0,previous=performance.now();
const venues=new Map();
function setStatus(){if(!current)return;$('status').textContent=walking?'Explore the streets and open doorways':'Eight places to enter · A city by the canal';}
function leaveWalk(){walking=false;camera.fov=45;camera.updateProjectionMatrix();controls.enabled=true;$('crosshair').hidden=true;$('walk').setAttribute('aria-pressed','false');keys.clear();}
function cityView(){leaveWalk();activeView='overview';const target=new THREE.Vector3(0,2,-1);camera.position.copy(target).add(new THREE.Vector3(55,46,68).multiplyScalar(Math.max(1,1.25/camera.aspect)));controls.target.copy(target);controls.update();$('overview').setAttribute('aria-pressed','true');$('help').textContent='Drag to orbit · Scroll to zoom';setStatus();}
function startWalk(marker,target){if(!body||!marker||!current)return;const p=marker.position;
  document.activeElement?.blur();
  body.setTranslation({x:p[0],y:p[1]+.85+.02,z:p[2]},true);body.setNextKinematicTranslation(body.translation());world.step();
  vy=0;walking=true;activeView='walk';controls.enabled=false;pitch=0;camera.fov=60;camera.updateProjectionMatrix();
  const t=target?.position??[p[0],p[1],p[2]-2];yaw=Math.atan2(-(t[0]-p[0]),-(t[2]-p[2]));
  $('crosshair').hidden=false;$('overview').setAttribute('aria-pressed','false');$('walk').setAttribute('aria-pressed','true');
  $('help').textContent='WASD move · Shift run · Drag to look · Q/E turn · Esc city view';setStatus();updateCamera();
}
function updateCamera(){const p=body.translation();camera.position.set(p.x,p.y+.80,p.z);camera.rotation.order='YXZ';camera.rotation.set(pitch,yaw,0);}
function marker(name){return gameplay?.markers.find(m=>m.name===name);}
async function loadModel(){const version=++loadVersion;const key=lod?'light':'full';$('detail').disabled=true;
  try{if(!cache[key])cache[key]=(await new GLTFLoader().loadAsync('../exports/kyoto_city'+(lod?'_lod1':'')+'.glb')).scene;
    if(version!==loadVersion)return;if(current)scene.remove(current);current=cache[key];scene.add(current);
    let tris=0,meshes=0;current.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;meshes++;tris+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;}});
    $('detail').textContent='Detail: '+(lod?'lighter':'full');$('status').dataset.loaded='true';
    $('status').dataset.triangles=String(tris);$('status').dataset.meshes=String(meshes);for(const id of ['walk','market','venue'])$(id).disabled=false;setStatus();
  }catch(e){$('error').textContent='The city could not load: '+e.message;console.error(e);}finally{$('detail').disabled=false;}}
$('overview').onclick=cityView;
$('walk').onclick=()=>startWalk(marker('MARK_player_spawn'));
$('market').onclick=()=>{leaveWalk();activeView='market';camera.position.set(20,10,31);controls.target.set(11,1,21);controls.update();$('overview').setAttribute('aria-pressed','false');$('help').textContent='Drag to orbit · Scroll to zoom';setStatus();};
$('detail').onclick=()=>{lod=!lod;loadModel();};
$('venue').onchange=()=>{const id=$('venue').value;$('inside').disabled=!id;if(id)startWalk(marker('MARK_entry_'+id),marker('MARK_interaction_'+id));};
$('inside').onclick=()=>{const id=$('venue').value;if(id)startWalk(marker('MARK_inside_'+id),marker('MARK_interaction_'+id));};
addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;
  if(e.code==='Escape'){cityView();return;}if(walking&&['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)){e.preventDefault();keys.add(e.code);}});
addEventListener('keyup',e=>keys.delete(e.code));addEventListener('blur',()=>keys.clear());
let dragging=false,lastX=0,lastY=0;
renderer.domElement.addEventListener('pointerdown',e=>{if(!walking)return;dragging=true;lastX=e.clientX;lastY=e.clientY;renderer.domElement.setPointerCapture(e.pointerId);document.activeElement?.blur();});
renderer.domElement.addEventListener('pointermove',e=>{if(!walking||!dragging)return;yaw-=(e.clientX-lastX)*.004;pitch=Math.max(-1.35,Math.min(1.35,pitch-(e.clientY-lastY)*.004));lastX=e.clientX;lastY=e.clientY;});
renderer.domElement.addEventListener('pointerup',()=>dragging=false);
renderer.domElement.addEventListener('pointercancel',()=>dragging=false);
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);if(activeView==='overview')cityView();});
function physicsStep(dt){
  if(!walking)return;const f=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'));
  const r=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));
  yaw+=(Number(keys.has('KeyQ'))-Number(keys.has('KeyE')))*1.6*dt;
  const length=Math.hypot(f,r)||1,speed=(keys.has('ShiftLeft')||keys.has('ShiftRight'))?4.2:2.4;
  vy=Math.max(-16,vy-9.81*dt);
  const desired={x:(-Math.sin(yaw)*f+Math.cos(yaw)*r)/length*speed*dt,y:vy*dt,z:(-Math.cos(yaw)*f-Math.sin(yaw)*r)/length*speed*dt};
  controller.computeColliderMovement(collider,desired);const d=controller.computedMovement(),p=body.translation();
  body.setNextKinematicTranslation({x:p.x+d.x,y:p.y+d.y,z:p.z+d.z});world.step();
  if(controller.computedGrounded())vy=0;
}
cityView();
try{
  [gameplay]=await Promise.all([fetch('../exports/kyoto_city_gameplay.json').then(r=>{if(!r.ok)throw new Error('Missing gameplay data');return r.json();}),RAPIER.init()]);
  world=new RAPIER.World({x:0,y:-9.81,z:0});world.timestep=1/60;
  for(const c of gameplay.colliders){const h=c.halfExtents,p=c.position,q=c.quaternion;world.createCollider(RAPIER.ColliderDesc.cuboid(...h).setTranslation(...p).setRotation({x:q[0],y:q[1],z:q[2],w:q[3]}));}
  body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(5,1.2,10));
  collider=world.createCollider(RAPIER.ColliderDesc.capsule(.57,.28),body);controller=world.createCharacterController(.015);
  controller.enableAutostep(.22,.12,true);controller.enableSnapToGround(.3);controller.setMaxSlopeClimbAngle(35*Math.PI/180);controller.setMinSlopeSlideAngle(36*Math.PI/180);world.step();
  for(const m of gameplay.markers){if(m.name.startsWith('MARK_entry_')){const id=m.name.slice(11);venues.set(id,m);const option=document.createElement('option');option.value=id;option.textContent=m.properties.display_name??id.replaceAll('_',' ');$('venue').append(option);}}
  for(const l of gameplay.lights??[]){const light=new THREE.PointLight(new THREE.Color(...l.color),l.runtime_intensity??12,l.range??12,2);light.position.fromArray(l.position);scene.add(light);}
  await loadModel();
}catch(e){$('error').textContent=e.message;console.error(e);}
renderer.setAnimationLoop(now=>{const dt=Math.min((now-previous)/1000,.08);previous=now;accumulator+=dt;while(accumulator>=1/60){if(world)physicsStep(1/60);accumulator-=1/60;}if(walking&&body)updateCamera();else controls.update();renderer.render(scene,camera);});
