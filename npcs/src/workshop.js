import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { VoxelNPC, NPCPatrol, PRESETS, MATERIAL_CHANNELS, loadNPCAsset } from './npc.js';

const $=selector=>document.querySelector(selector);
const canvas=$('#viewport'), wrap=$('#canvas-wrap');
const scene=new THREE.Scene();
scene.background=new THREE.Color('#e6e9dd');
scene.fog=new THREE.Fog('#e6e9dd',12,36);
const camera=new THREE.PerspectiveCamera(32,1,.05,80);
let renderer;
try { renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false}); }
catch (error) { $('#loading').textContent='WebGL could not start. Open this workshop in a browser with hardware acceleration.'; throw error; }
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.22;
const controls=new OrbitControls(camera,canvas);
controls.enableDamping=true; controls.dampingFactor=.085;
controls.enablePan=false; controls.maxPolarAngle=Math.PI*.485; controls.minDistance=2.3; controls.maxDistance=8;
scene.add(new THREE.HemisphereLight('#fff7e7','#7c8d70',2.35));
const sun=new THREE.DirectionalLight('#fff1d8',3.1); sun.position.set(4,7,5); sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048); sun.shadow.camera.left=-8;sun.shadow.camera.right=8;sun.shadow.camera.top=8;sun.shadow.camera.bottom=-8;
sun.shadow.normalBias=.02; sun.shadow.bias=-.0001; sun.shadow.radius=4; scene.add(sun);
const fill=new THREE.DirectionalLight('#e9f5ff',1.1); fill.position.set(-4,3,-5); scene.add(fill);
const studio=new THREE.Group(), courtyard=new THREE.Group(); scene.add(studio,courtyard);
const groundMaterial=new THREE.MeshStandardMaterial({color:'#dce2d1',roughness:1});
const floor=new THREE.Mesh(new THREE.PlaneGeometry(120,120),groundMaterial);floor.rotation.x=-Math.PI/2;floor.position.y=-.075;floor.receiveShadow=true;scene.add(floor);
const plinth=new THREE.Mesh(new THREE.CylinderGeometry(1.15,1.2,.085,64),new THREE.MeshStandardMaterial({color:'#d3dbc6',roughness:.95}));
plinth.position.y=-.0425;plinth.receiveShadow=true;studio.add(plinth);
const ring=new THREE.Mesh(new THREE.RingGeometry(1.31,1.316,96),new THREE.MeshBasicMaterial({color:'#bfcbb2',side:THREE.DoubleSide}));
ring.rotation.x=-Math.PI/2;ring.position.y=-.07;studio.add(ring);

const obstacles=[];
function block(size,position,color,parent=courtyard){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshStandardMaterial({color,roughness:.95}));
  mesh.position.set(...position);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
const paving=block([11.5,.07,11.5],[0,-.035,0],'#cdd6c1');
const grid=new THREE.GridHelper(11.5,23,'#bac6ae','#c1cbb5');grid.position.y=.002;courtyard.add(grid);
for(const [x,z] of [[-3,-2.5],[3,2.5],[-3,3.5],[3,-3.5]]) {
  block([1.35,.25,1.35],[x,.125,z],'#afbaa3');
  block([.17,1.3,.17],[x,.9,z],'#8b7155');
  block([1.05,.55,1],[x,1.8,z],'#a4b190');
  block([.8,.4,.8],[x+.15,2.15,z-.1],'#b7c39e');
  block([.6,.45,.85],[x-.38,1.7,z+.15],'#95a781');
  obstacles.push({minX:x-.72,maxX:x+.72,minZ:z-.72,maxZ:z+.72});
}
for(const x of [-1.9,1.9]){
  block([1.3,.13,.55],[x,.48,4.3],'#ac8961');
  for(const offset of [-.45,.45])block([.12,.42,.4],[x+offset,.23,4.3],'#827462');
  obstacles.push({minX:x-.7,maxX:x+.7,minZ:3.98,maxZ:4.65});
}
const clock=new THREE.Clock(); let asset,npc,cast=[],patrols=[],mode='studio';
const keys=new Set(); let previewAnimation='Idle';let lastUi=0;let toastTimer;
const velocity=new THREE.Vector3(), forward=new THREE.Vector3(), right=new THREE.Vector3();
const status=message=>{ $('#status').textContent=message; clearTimeout(toastTimer); toastTimer=setTimeout(()=>{$('#status').textContent='';},7000); };
const setPressed=(selector,key,value)=>document.querySelectorAll(selector).forEach(button=>{const selected=button.dataset[key]===value;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',selected);});

function updateForm(){
  const c=npc.appearance;
  for(const key of ['hair','outfit','height',...Object.keys(MATERIAL_CHANNELS)]) $(`#${key}`).value=c[key];
  for(const key of ['glasses','bag']) $(`#${key}`).checked=c[key];
  $('#height-value').textContent=`${c.height.toFixed(2)} m`;
  $('#resident-name').textContent=c.name;$('#resident-role').textContent=c.role;
  $('#resident-number').textContent=String(Object.keys(PRESETS).indexOf(c.id)+1).padStart(2,'0');
  setPressed('[data-preset]','preset',c.id);
  saveSession(); updateStats();
}
function saveSession(){ try { localStorage.setItem('komorebi-npc-look-v1',JSON.stringify(npc.toJSON())); } catch { /* Storage may be disabled. */ } }
function updateStats(){let triangles=0,primitives=0;npc.model.traverseVisible(o=>{if(o.isMesh){triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;primitives++;}});$('#asset-stats').textContent=`${triangles.toLocaleString()} triangles · ${primitives} material primitives · ${npc.appearance.height.toFixed(2)} m`;}
function resetCamera(){
  controls.reset();controls.target.set(0,.9,0);
  if(mode==='walk'){controls.target.copy(npc.object.position).add(new THREE.Vector3(0,1,0));camera.position.copy(npc.object.position).add(new THREE.Vector3(0,2.7,-4.2));controls.maxDistance=9;}
  else if(mode==='cast'){controls.target.set(0,.75,.5);camera.position.set(0,4.8,8);controls.maxDistance=14;}
  else {camera.position.set(2.7,1.95,4.15);controls.maxDistance=8;}
  controls.update();
}
function setMode(next){
  mode=next;keys.clear();setPressed('[data-mode]','mode',mode);
  studio.visible=mode==='studio';courtyard.visible=mode!=='studio';
  npc.object.visible=mode!=='cast';cast.forEach(c=>c.object.visible=mode==='cast');
  npc.object.position.set(0,0,0);npc.object.rotation.y=0;npc.play('Idle');
  previewAnimation='Idle';setPressed('[data-animation]','animation','Idle');
  $('.nameplate').style.display=mode==='cast'?'none':'';
  $('#stage-label').textContent=mode==='walk'?'W A S D TO MOVE · SHIFT TO RUN · DRAG TO ORBIT':mode==='cast'?'THREE RESIDENTS · INDEPENDENT PATROLS':'DRAG TO ORBIT · SCROLL TO ZOOM';
  $('#panel-note').textContent=mode==='cast'?'The cast shows the three original presets.':'A familiar face for a new place.';
  resetCamera();
  if(mode==='walk')canvas.focus({preventScroll:true});
}
function canStand(x,z,radius=.3){
  if(Math.abs(x)>5.35 || Math.abs(z)>5.35)return false;
  return !obstacles.some(b=>x>b.minX-radius && x<b.maxX+radius && z>b.minZ-radius && z<b.maxZ+radius);
}
function movePlayer(dt){
  camera.getWorldDirection(forward);forward.y=0;forward.normalize();right.crossVectors(forward,THREE.Object3D.DEFAULT_UP).normalize();
  const y=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'));
  const x=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'));
  velocity.copy(forward).multiplyScalar(y).addScaledVector(right,x);
  if(velocity.lengthSq()>0)velocity.normalize().multiplyScalar(keys.has('ShiftLeft')||keys.has('ShiftRight')?2.7:1.2);
  const p=npc.object.position,before=p.clone();
  const radius=.3*npc.model.scale.x;
  // Axis-separated, conservative circle-vs-box test in the flat workshop courtyard.
  if(canStand(p.x+velocity.x*dt,p.z,radius))p.x+=velocity.x*dt;
  if(canStand(p.x,p.z+velocity.z*dt,radius))p.z+=velocity.z*dt;
  const actual=p.clone().sub(before);npc.setVelocity(actual.clone().divideScalar(Math.max(dt,.00001)));
  if(actual.lengthSq()>.000001){
    const yaw=Math.atan2(actual.x,actual.z),diff=Math.atan2(Math.sin(yaw-npc.object.rotation.y),Math.cos(yaw-npc.object.rotation.y));
    npc.object.rotation.y+=diff*(1-Math.exp(-dt*14));
  }
  controls.target.add(actual);camera.position.add(actual);
}
function download(data,filename,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

async function init(){
  asset=await loadNPCAsset();
  let saved;
  try{saved=JSON.parse(localStorage.getItem('komorebi-npc-look-v1'));}catch{}
  try{npc=new VoxelNPC(asset,saved??PRESETS.local_guide);}catch{npc=new VoxelNPC(asset,PRESETS.local_guide);}
  scene.add(npc.object);
  cast=Object.values(PRESETS).map((preset,i)=>{const c=new VoxelNPC(asset,preset);c.object.position.set((i-1)*1.8,0,0);scene.add(c.object);return c;});
  const routes=[[[ -1.8,0,-1.3],[-1.8,0,1.4],[ -.5,0,1.4],[ -.5,0,-1.3]], [[.4,0,-1.4],[1.8,0,-1.4],[1.8,0,.7],[.4,0,.7]], [[-1,0,2.7],[1,0,2.7],[1,0,1.8],[-1,0,1.8]]];
  patrols=cast.map((c,i)=>new NPCPatrol(c,routes[i].map(p=>new THREE.Vector3(...p)),{speed:.65+i*.08,wait:1.5}));
  updateForm();setMode('studio');
  $('#loading').remove();$('#ready-label').textContent='Ready for your world';
  document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));
  document.querySelectorAll('[data-preset]').forEach(b=>b.addEventListener('click',()=>{npc.setAppearance(PRESETS[b.dataset.preset]);updateForm();if(mode==='cast')setMode('studio');}));
  document.querySelectorAll('[data-animation]').forEach(b=>b.addEventListener('click',()=>{
    if(mode!=='studio')setMode('studio');previewAnimation=b.dataset.animation;
    npc.play(previewAnimation,{once:['Wave','Bow'].includes(previewAnimation)});setPressed('[data-animation]','animation',previewAnimation);
  }));
  for(const key of ['hair','outfit',...Object.keys(MATERIAL_CHANNELS)]) $(`#${key}`).addEventListener('input',e=>{npc.setAppearance({[key]:e.target.value});updateForm();});
  $('#height').addEventListener('input',e=>{npc.setAppearance({height:Number(e.target.value)});updateForm();});
  for(const key of ['glasses','bag'])$(`#${key}`).addEventListener('change',e=>{npc.setAppearance({[key]:e.target.checked});updateForm();});
  $('#reset-camera').addEventListener('click',resetCamera);
  $('#reset-look').addEventListener('click',()=>{npc.setAppearance(PRESETS[npc.appearance.id]??PRESETS.local_guide);updateForm();status('Resident restored to the original look.');});
  $('#save-look').addEventListener('click',()=>{download(JSON.stringify({schemaVersion:1,appearance:npc.toJSON()},null,2)+'\n',`${npc.appearance.id}-look.json`,'application/json');status('Look saved. Load it here or pass the appearance to VoxelNPC.');});
  $('#load-look').addEventListener('click',()=>$('#look-file').click());
  $('#look-file').addEventListener('change',async e=>{
    const file=e.target.files[0];if(!file)return;
    try{if(file.size>20000)throw new Error('This does not look like a character settings file.');const json=JSON.parse(await file.text());if(json.schemaVersion!==1)throw new Error('Unsupported look format.');npc.setAppearance(json.appearance);updateForm();status('Look loaded.');}
    catch(error){status(`Could not load that look: ${error.message}`);}e.target.value='';
  });
  $('#export-glb').addEventListener('click',async()=>{
    const button=$('#export-glb');button.disabled=true;
    const clean=new VoxelNPC(asset,npc.toJSON());
    try{
      clean.mixer.stopAllAction();clean.setSpeechLevel(0);clean.blinkEnabled=false;clean.update(0);
      clean.model.userData.appearance=npc.toJSON();
      const result=await new GLTFExporter().parseAsync(clean.model,{binary:true,onlyVisible:true,animations:asset.animations});
      download(result,`${npc.appearance.id}.glb`,'model/gltf-binary');status('Animated GLB exported with this look. Save look keeps the editable settings too.');
    }catch(error){status(`Export failed: ${error.message}`);}finally{clean.dispose();button.disabled=false;}
  });
  window.addEventListener('keydown',event=>{
    if(mode!=='walk'||/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(event.target.tagName))return;
    if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight'].includes(event.code)){event.preventDefault();keys.add(event.code);}
  });
  window.addEventListener('keyup',e=>keys.delete(e.code));
  window.addEventListener('blur',()=>keys.clear());
  document.addEventListener('visibilitychange',()=>{keys.clear();clock.getDelta();});
  canvas.addEventListener('pointerdown',()=>canvas.focus({preventScroll:true}));
  // Explicit inspection surface for the workshop's automated WebGL checks.
  window.npcWorkshop={get npc(){return npc;},get mode(){return mode;},cast,scene,renderer,camera,setMode,
    diagnostics(){return {ready:true,mode,animation:npc.current,position:npc.object.position.toArray(),appearance:npc.toJSON(),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,castPositions:cast.map(c=>c.object.position.toArray())};}};
}
function resize(){const {width,height}=wrap.getBoundingClientRect();renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe(wrap);resize();
renderer.setAnimationLoop(()=>{
  const dt=Math.min(clock.getDelta(),.05);
  if(npc){
    if(mode==='walk')movePlayer(dt);
    if(mode==='cast')patrols.forEach(p=>p.update(dt));
    npc.setSpeechLevel(mode==='studio'&&npc.current==='Talk' ? (.5+.5*Math.sin(npc.time*17))*(.45+.35*Math.sin(npc.time*5)) : 0);
    npc.update(dt);cast.forEach(c=>c.update(dt));
    if(npc.time-lastUi>.15){lastUi=npc.time;setPressed('[data-animation]','animation',npc.current);}
  }
  controls.update();renderer.render(scene,camera);
});
init().catch(error=>{$('#loading').textContent=`Could not load the character: ${error.message}. Start this folder with npm start.`;$('#loading').classList.add('error');$('#ready-label').textContent='Character unavailable';console.error(error);});
