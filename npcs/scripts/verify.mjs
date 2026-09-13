import { readFile, writeFile, stat } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { validateBytes } from 'gltf-validator';
import { VoxelNPC, PRESETS } from '../src/npc.js';
import { CITY_PRESETS } from '../src/city-cast.js';
import { readGLB, bounds, sampleFoot } from '../qa/helpers.mjs';

// GLTFExporter uses the browser FileReader interface, even for a texture-free GLB.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob){blob.arrayBuffer().then(result=>{this.result=result;this.onloadend?.();});}
  readAsDataURL(blob){blob.arrayBuffer().then(result=>{this.result=`data:${blob.type};base64,${Buffer.from(result).toString('base64')}`;this.onloadend?.();});}
};
const root=new URL('../',import.meta.url);
const asset=await readGLB();
const report={verdict:'PASS',three:THREE.REVISION,files:[],presets:[],locomotion:[],notes:[]};
await writeFile(new URL('exports/kyoto_city_cast.json',root),JSON.stringify({schemaVersion:1,asset:'komorebi_npc.glb',characters:CITY_PRESETS},null,2)+'\n');

async function validateFile(name){
  const path=new URL(`exports/${name}`,root),bytes=await readFile(path);
  const result=await validateBytes(new Uint8Array(bytes),{uri:name,maxIssues:100});
  const details={file:name,bytes:bytes.length,errors:result.issues.numErrors,warnings:result.issues.numWarnings,issues:result.issues.messages};
  report.files.push(details);
  if(details.errors)report.verdict='FAIL';
}
await validateFile('komorebi_npc.glb');
for(const preset of Object.values(PRESETS)){
  const npc=new VoxelNPC(asset,preset);
  npc.mixer.stopAllAction();npc.blinkEnabled=false;npc.update(0);
  npc.model.userData.appearance=npc.toJSON();
  let triangles=0,primitives=0;
  npc.model.traverseVisible(node=>{if(node.isMesh){triangles+=(node.geometry.index?.count??node.geometry.attributes.position.count)/3;primitives++;}});
  const box=bounds(npc.object);
  const data=await new GLTFExporter().parseAsync(npc.model,{binary:true,onlyVisible:true,animations:asset.animations});
  await writeFile(new URL(`exports/${preset.id}.glb`,root),Buffer.from(data));
  await writeFile(new URL(`presets/${preset.id}.json`,root),JSON.stringify({schemaVersion:1,appearance:preset},null,2)+'\n');
  await validateFile(`${preset.id}.glb`);
  const roundtrip=await readGLB(new URL(`exports/${preset.id}.glb`,root));
  const roundtripBounds=bounds(roundtrip.scene);
  if(roundtrip.animations.length!==7 || Math.abs(roundtripBounds.max.y-preset.height)>.02) report.verdict='FAIL';
  const importedMixer=new THREE.AnimationMixer(roundtrip.scene);
  let maxAnimatedSocketDifference=0;
  for(const clip of roundtrip.animations){
    npc.mixer.stopAllAction();npc.current=undefined;npc.play(clip.name.replace('AN_NPC_',''),{fade:0});
    importedMixer.stopAllAction();importedMixer.clipAction(clip).reset().play();
    for(const phase of [0,.25,.7]){
      const time=clip.duration*phase;npc.mixer.setTime(time);importedMixer.setTime(time);
      npc.object.updateMatrixWorld(true);roundtrip.scene.updateMatrixWorld(true);
      for(const name of ['socket_voice','L_shin','socket_hand_R']){
        const expected=npc.model.getObjectByName(name).getWorldPosition(new THREE.Vector3());
        const actual=roundtrip.scene.getObjectByName(name).getWorldPosition(new THREE.Vector3());
        maxAnimatedSocketDifference=Math.max(maxAnimatedSocketDifference,expected.distanceTo(actual));
      }
    }
  }
  importedMixer.stopAllAction();importedMixer.uncacheRoot(roundtrip.scene);
  if(maxAnimatedSocketDifference>.001)report.verdict='FAIL';
  report.presets.push({id:preset.id,triangles,primitives,bounds:{min:box.min.toArray(),max:box.max.toArray()},roundtripHeight:roundtripBounds.max.y,animations:roundtrip.animations.length,maxAnimatedSocketDifference});
  npc.dispose();
}
for(const name of ['Walk','Run']){
  const npc=new VoxelNPC(asset);npc.play(name,{fade:0});npc.blinkEnabled=false;
  const duration=npc.actions[name].getClip().duration;
  let minY=Infinity,maxStanceGap=0,maxLift=0;
  for(let i=0;i<120;i++){
    npc.mixer.setTime(duration*i/120);
    const a=sampleFoot(npc,'L').min.y,b=sampleFoot(npc,'R').min.y;
    minY=Math.min(minY,a,b);maxStanceGap=Math.max(maxStanceGap,Math.min(a,b));maxLift=Math.max(maxLift,a,b);
  }
  report.locomotion.push({clip:name,duration,samples:120,minFootY:minY,maxStanceGap,maxFootLift:maxLift});
  if(minY<-.012||maxStanceGap>.018)report.verdict='FAIL';npc.dispose();
}
report.notes.push('Animations are in place; actual resolved velocity sets gait speed. Walk authored speed 0.72 m/s, run 1.32 m/s at base scale.');
report.notes.push('Rigid segment surfaces intentionally meet at hinges; this voxel rig is not a smooth deformation / retargeting rig.');
report.notes.push('Validator NODE_SKINNED_MESH_NON_ROOT warnings are expected for the armature/part hierarchy. Bones and meshes share the character parent. Animated socket coordinates, scale and ground contact are verified after export/reload in Three.js.');
await writeFile(new URL('qa/runtime.json',root),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({verdict:report.verdict,files:report.files.map(({issues,...rest})=>rest),presets:report.presets,locomotion:report.locomotion},null,2));
process.exitCode=report.verdict==='PASS'?0:1;
