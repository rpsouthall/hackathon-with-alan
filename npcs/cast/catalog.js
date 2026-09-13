import * as THREE from 'three';
import { loadNPCAsset, VoxelNPC, CITY_PRESETS } from '../src/npc.js';

const status=document.querySelector('#status'), grid=document.querySelector('#cast-grid');
const canvas=document.querySelector('#cast-canvas');
let renderer, frame, previous=0;
const actors=[];
try {
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setClearColor(0x000000,0);
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
  const template=await loadNPCAsset('../exports/komorebi_npc.glb');
  for(const [index,appearance] of Object.values(CITY_PRESETS).entries()){
    const card=document.createElement('article');card.className='resident';
    const portrait=document.createElement('div');portrait.className='portrait';portrait.setAttribute('role','img');portrait.setAttribute('aria-label',`${appearance.name}, ${appearance.role}, animated voxel character`);
    const number=document.createElement('span');number.className='number';number.textContent=String(index+1).padStart(2,'0');
    const caption=document.createElement('div');caption.className='caption';
    const text=document.createElement('div'),name=document.createElement('h2'),role=document.createElement('p');
    name.textContent=appearance.name;role.textContent=appearance.role;text.append(name,role);
    const swatches=document.createElement('div');swatches.className='swatches';swatches.setAttribute('aria-hidden','true');
    for(const color of [appearance.top,appearance.accent,appearance.trousers]){const dot=document.createElement('i');dot.style.background=color;swatches.append(dot);}
    caption.append(text,swatches);card.append(portrait,number,caption);grid.append(card);
    const scene=new THREE.Scene(), npc=new VoxelNPC(template,appearance);
    npc.object.rotation.y=-.15;scene.add(npc.object);
    scene.add(new THREE.HemisphereLight(0xfff8ea,0x83957d,2.7));
    const light=new THREE.DirectionalLight(0xfff1d6,2.7);light.position.set(-3,6,5);scene.add(light);
    const rim=new THREE.DirectionalLight(0xd8e7e2,1.2);rim.position.set(4,3,-3);scene.add(rim);
    const floor=new THREE.Mesh(new THREE.CylinderGeometry(.7,.76,.08,32),new THREE.MeshStandardMaterial({color:0xd1d8c8,roughness:1}));floor.position.y=-.052;scene.add(floor);
    const camera=new THREE.OrthographicCamera(-1.1,1.1,1.1,-1.1,.1,30);camera.position.set(3,2.35,5);camera.lookAt(0,.88,0);
    actors.push({npc,scene,camera,portrait});
  }
  status.textContent='15 residents · Ready for Kyoto';
  document.querySelectorAll('[data-animation]').forEach(button=>button.addEventListener('click',()=>{
    const name=button.dataset.animation;
    actors.forEach(({npc})=>npc.play(name));
    document.querySelectorAll('[data-animation]').forEach(other=>other.setAttribute('aria-pressed',String(other===button)));
    status.textContent=`15 residents · ${name} preview`;
  }));
  const resize=()=>renderer.setSize(innerWidth,innerHeight,false);
  addEventListener('resize',resize);resize();
  function render(now){
    frame=requestAnimationFrame(render);
    const dt=Math.min((now-previous)/1000,.05);previous=now;
    if(document.hidden)return;
    renderer.setScissorTest(false);renderer.clear();renderer.setScissorTest(true);
    for(const {npc,scene,camera,portrait} of actors){
      const rect=portrait.getBoundingClientRect();
      if(rect.bottom<0||rect.top>innerHeight)continue;
      npc.update(dt);
      const aspect=rect.width/rect.height;camera.left=-1.12*aspect;camera.right=1.12*aspect;camera.updateProjectionMatrix();
      renderer.setViewport(rect.left,innerHeight-rect.bottom,rect.width,rect.height);
      renderer.setScissor(rect.left,innerHeight-rect.bottom,rect.width,rect.height);
      renderer.render(scene,camera);
    }
  }
  frame=requestAnimationFrame(render);
  addEventListener('pagehide',event=>{
    if(event.persisted)return;
    cancelAnimationFrame(frame);removeEventListener('resize',resize);
    actors.forEach(({npc,scene})=>{npc.dispose();scene.traverse(node=>{if(node.isMesh){node.geometry.dispose();node.material.dispose();}});});
    const geometry=new Set(),materials=new Set();template.scene.traverse(node=>{if(node.isMesh){geometry.add(node.geometry);(Array.isArray(node.material)?node.material:[node.material]).forEach(m=>materials.add(m));}});
    geometry.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());renderer.dispose();
  });
} catch(error){status.textContent=`Unable to load the cast: ${error.message}`;status.setAttribute('role','alert');console.error(error);renderer?.dispose();}
