import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VoxelNPC, NPCPatrol, PRESETS, ANIMATIONS, validateAppearance, spawnAtMarkers } from '../src/npc.js';
import { readGLB, bounds, sampleFoot } from './helpers.mjs';
import { CITY_PRESETS } from '../src/city-cast.js';
import { readFile } from 'node:fs/promises';
const asset=await readGLB();
console.log(`Character compatibility suite: Three.js r${THREE.REVISION}`);

test('GLB has seven usable clips, rigid skinning, sockets and facial targets',()=>{
  assert.deepEqual(asset.animations.map(c=>c.name.replace('AN_NPC_','')).sort(),[...ANIMATIONS].sort());
  const npc=new VoxelNPC(asset);npc.update(0);
  for(const clip of asset.animations){assert(clip.validate());assert(clip.duration>0);}
  for(const name of ['socket_voice','socket_head','socket_hand_L','socket_hand_R'])assert(npc.getSocket(name).toArray().every(Number.isFinite));
  const face=[];npc.model.traverse(o=>{if(o.morphTargetDictionary)face.push(...Object.keys(o.morphTargetDictionary));});
  assert(face.includes('Blink'));assert(face.includes('MouthOpen'));
  npc.model.traverse(o=>{if(o.isSkinnedMesh){const w=o.geometry.attributes.skinWeight;for(let i=0;i<w.count;i++){assert(Math.abs(w.getX(i)-1)<1e-5);assert.equal(w.getY(i)+w.getZ(i)+w.getW(i),0);}}});
  npc.dispose();
});

test('all presets have the requested standing height and feet at ground',()=>{
  for(const preset of Object.values(PRESETS)){
    const npc=new VoxelNPC(asset,preset);npc.blinkEnabled=false;npc.update(0);
    const box=bounds(npc.object);
    assert(Math.abs(box.max.y-preset.height)<.015,`${preset.id}: ${box.max.y}`);
    assert(Math.abs(box.min.y)<.005,`${preset.id}: feet ${box.min.y}`);
    let tri=0,draws=0;
    npc.model.traverseVisible(o=>{if(o.isMesh){tri+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;draws++;}});
    assert(tri<1200);assert(draws<=16);npc.dispose();
  }
});

test('customization selects exactly one hair and outfit, validates data and isolates clones',()=>{
  const a=new VoxelNPC(asset),b=new VoxelNPC(asset);
  a.setAppearance({...PRESETS.inn_host,top:'#ab3456'});b.setAppearance(PRESETS.cafe_owner);
  for(const npc of [a,b])for(const slot of ['hair','outfit']){
    const visible=[];npc.model.traverseVisible(n=>{if(n.userData.npc_part===slot)visible.push(n.userData.npc_option);});
    assert.deepEqual(visible,[npc.appearance[slot]]);
  }
  const am=[...a.materials].find(m=>m.name==='MAT_NPC_Top'),bm=[...b.materials].find(m=>m.name==='MAT_NPC_Top');
  assert.notEqual(am,bm);assert.equal(am.color.getHexString(),'ab3456');assert.equal(bm.color.getHexString(),'bf7865');
  assert.notEqual(a.model.getObjectByName('L_shin'),b.model.getObjectByName('L_shin'));
  a.play('Walk',{fade:0});a.update(.1);assert.notDeepEqual(a.model.getObjectByName('L_shin').quaternion.toArray(),b.model.getObjectByName('L_shin').quaternion.toArray());
  assert.throws(()=>validateAppearance({height:NaN}));assert.throws(()=>validateAppearance({outfit:'missing'}));assert.throws(()=>validateAppearance({top:'javascript:bad'}));
  assert.equal(validateAppearance({untrustedField:'dropped'}).untrustedField,undefined);
  a.dispose();a.dispose();b.update(.1);assert(b.getSocket().toArray().every(Number.isFinite));b.dispose();
});

test('looped clips match at endpoints and do not move the root',()=>{
  for(const name of ['Idle','Walk','Run','Talk','Listen']){
    const clip=asset.animations.find(c=>c.name===`AN_NPC_${name}`);
    for(const track of clip.tracks){
      const size=track.getValueSize(),first=Array.from(track.values.slice(0,size)),last=Array.from(track.values.slice(-size));
      const sign=track.name.endsWith('.quaternion')&&first.reduce((s,v,i)=>s+v*last[i],0)<0?-1:1;
      assert(first.every((v,i)=>Math.abs(v-sign*last[i])<1e-5),`${name} seam: ${track.name}`);
      if(track.name==='root.position')assert(Array.from(track.values).every(v=>Math.abs(v)<1e-6));
    }
  }
});

test('walk and run keep stance feet on the floor throughout the cycle',()=>{
  for(const animation of ['Walk','Run']){
    const npc=new VoxelNPC(asset);npc.play(animation,{fade:0});npc.blinkEnabled=false;
    const duration=npc.actions[animation].getClip().duration;
    for(let i=0;i<60;i++){
      const t=i/60;npc.mixer.setTime(t*duration);
      const feet=['L','R'].map(side=>sampleFoot(npc,side));
      const min=Math.min(...feet.map(box=>box.min.y));
      assert(min>-.012,`${animation} t=${t} foot penetrates ${min}`);
      assert(Math.abs(min)<.018,`${animation} t=${t} no stance foot ${min}`);
      for(const box of feet)assert(box.max.y-box.min.y<.16,`${animation}: foot rotates through the floor`);
    }
    npc.dispose();
  }
});

test('speech envelope and blink affect face separately from body animation',()=>{
  const npc=new VoxelNPC(asset);npc.blinkEnabled=false;npc.setSpeechLevel(2);npc.play('Talk',{fade:0});npc.update(.05);
  const mouth=npc.model.getObjectByName('SM_NPC_Mouth');assert.equal(mouth.morphTargetInfluences[0],1);
  npc.model.traverse(n=>{if(n.morphTargetDictionary?.Blink!==undefined)assert.equal(n.morphTargetInfluences[0],0);});
  npc.setSpeechLevel(NaN);npc.update(0);assert.equal(mouth.morphTargetInfluences[0],0);npc.dispose();
});

test('a one-shot bow returns to idle; velocity drives locomotion and stops',()=>{
  const npc=new VoxelNPC(asset);npc.play('Bow',{fade:0,once:true});
  for(let i=0;i<180;i++)npc.update(1/60);
  assert.equal(npc.current,'Idle');
  npc.setVelocity(new THREE.Vector3(1,0,0));assert.equal(npc.current,'Walk');
  npc.setVelocity(new THREE.Vector3(3,0,0));assert.equal(npc.current,'Run');
  npc.setVelocity(new THREE.Vector3());assert.equal(npc.current,'Idle');npc.dispose();
});

test('an interrupted gesture cannot cancel the new locomotion animation',()=>{
  const npc=new VoxelNPC(asset);npc.play('Bow',{fade:0,once:true});
  const duration=npc.actions.Bow.getClip().duration;
  npc.mixer.setTime(duration-.06);npc.play('Run',{fade:.18});
  npc.update(.09);assert.equal(npc.current,'Run');npc.dispose();
});

test('gesture replay can change looping mode and invalid timing cannot corrupt the skeleton',()=>{
  const npc=new VoxelNPC(asset);
  npc.play('Wave',{once:true});npc.update(.1);npc.play('Wave',{once:false});
  assert.equal(npc.actions.Wave.loop,THREE.LoopRepeat);
  for(let i=0;i<160;i++)npc.update(1/60);
  assert.equal(npc.current,'Wave');
  assert.throws(()=>npc.play('Run',{speed:NaN}));assert.throws(()=>npc.play('Walk',{fade:-1}));
  npc.setVelocity({x:NaN,z:0});npc.update(.1);assert(npc.getSocket().toArray().every(Number.isFinite));
  npc.dispose();npc.play('Run');assert.equal(npc.current,'Wave');
});

test('patrol reaches waypoints, pauses, respects resolver and rejects invalid routes',()=>{
  const npc=new VoxelNPC(asset);const points=[new THREE.Vector3(1,0,0),new THREE.Vector3(-1,0,0)];
  const patrol=new NPCPatrol(npc,points,{speed:1,wait:.2});
  for(let i=0;i<70;i++)patrol.update(1/60);
  assert(npc.object.position.x>.95);assert.equal(patrol.index,1);
  let minX=Infinity,maxX=-Infinity;
  for(let i=0;i<170;i++){patrol.update(1/60);minX=Math.min(minX,npc.object.position.x);maxX=Math.max(maxX,npc.object.position.x);}
  assert(minX<-.95);assert(minX>=-1);assert(maxX<=1);
  const blocked=new NPCPatrol(npc,points,{resolveMovement:current=>current});
  const before=npc.object.position.clone();blocked.update(.1);assert(npc.object.position.equals(before));assert.equal(npc.current,'Idle');
  assert.throws(()=>new NPCPatrol(npc,[]));assert.throws(()=>new NPCPatrol(npc,points,{speed:0}));npc.dispose();
});

test('Kyoto markers spawn independent role presets at exported Y-up positions',()=>{
  const scene=new THREE.Scene(),position=[9,.315,1.85];
  const residents=spawnAtMarkers(asset,{markers:[{position,properties:{kind:'npc',npc_id:'cafe_owner',interaction_radius:2.2}},{position:[0,0,0],properties:{kind:'player_spawn'}}]},scene);
  assert.equal(residents.length,1);assert.deepEqual(residents[0].object.position.toArray(),position);assert.equal(residents[0].appearance.outfit,'apron');
  residents.forEach(n=>n.dispose());assert.equal(scene.children.length,0);
});

test('every authored Kyoto City NPC marker has a distinct, valid cast identity',async()=>{
  const gameplay=JSON.parse(await readFile(new URL('../../kyoto_city/exports/kyoto_city_gameplay.json',import.meta.url),'utf8'));
  const scene=new THREE.Scene(), residents=spawnAtMarkers(asset,gameplay,scene);
  const markers=gameplay.markers.filter(m=>['npc','npc_spawn'].includes(m.properties?.kind));
  assert.equal(residents.length,15);assert.equal(markers.length,residents.length);
  assert.equal(new Set(residents.map(n=>n.appearance.name)).size,15);
  for(let i=0;i<residents.length;i++){
    const npc=residents[i],marker=markers[i],preset=CITY_PRESETS[marker.properties.npc_id];
    assert(preset,`Missing cast member ${marker.properties.npc_id}`);
    assert.deepEqual(npc.toJSON(),preset);
    assert.deepEqual(npc.object.position.toArray(),marker.position);
    assert(Number.isFinite(npc.object.rotation.y));
    npc.update(0);const box=bounds(npc.object);
    assert(Math.abs(box.min.y-marker.position[1])<.005);
    assert(Math.abs(box.max.y-box.min.y-preset.height)<.015);
    if(marker.properties.venue_id){
      const target=gameplay.markers.find(m=>m.name===`MARK_interaction_${marker.properties.venue_id}`);
      assert(target);
      const facing=new THREE.Vector3(0,0,1).applyQuaternion(npc.object.quaternion);
      const expected=new THREE.Vector3().fromArray(target.position).sub(npc.object.position).setY(0).normalize();
      assert(facing.dot(expected)>.999,'Venue resident should face the visitor interaction position');
    }
    npc.dispose();
  }
  assert.equal(scene.children.length,0);
});

test('all player part combinations remain independent, grounded and within the kit budget',()=>{
  const anchor=new VoxelNPC(asset,PRESETS.local_guide);
  for(const hair of ['crop','bob','topknot'])for(const outfit of ['jacket','apron','haori'])for(const glasses of [false,true])for(const bag of [false,true])for(const height of [1.4,2.1]){
    const npc=new VoxelNPC(asset,{hair,outfit,glasses,bag,height});npc.update(0);
    const box=bounds(npc.object);
    assert(Math.abs(box.min.y)<.005);
    assert(Math.abs(box.max.y-height)<.016);
    for(const slot of ['hair','outfit']){
      const selected=[];npc.model.traverseVisible(n=>{if(n.userData.npc_part===slot)selected.push(n.userData.npc_option);});
      assert.deepEqual(selected,[npc.appearance[slot]]);
    }
    let triangles=0; npc.model.traverseVisible(n=>{if(n.isMesh)triangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3;});
    assert(triangles<=1200);
    npc.dispose();
  }
  assert.deepEqual(anchor.toJSON(),PRESETS.local_guide);
  anchor.update(.1);assert(anchor.getSocket().toArray().every(Number.isFinite));anchor.dispose();
});
