import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
export async function readGLB(path=new URL('../exports/komorebi_npc.glb',import.meta.url)) {
  const data=await readFile(path);
  return new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),'');
}
export function updateSkeletons(model) {
  model.updateMatrixWorld(true);
  model.traverse(node=>{if(node.skeleton)node.skeleton.update();});
}
export function bounds(model) {
  updateSkeletons(model);
  const box=new THREE.Box3(),point=new THREE.Vector3();
  model.traverseVisible(node=>{if(node.isMesh){for(let i=0;i<node.geometry.attributes.position.count;i++){node.getVertexPosition(i,point);point.applyMatrix4(node.matrixWorld);box.expandByPoint(point);}}});
  return box;
}
export function sampleFoot(npc,side) {
  updateSkeletons(npc.object);
  const box=new THREE.Box3(),point=new THREE.Vector3();
  npc.model.getObjectByName('SM_NPC_Body').traverse(node=>{
    if(!node.isSkinnedMesh)return;
    const indices=node.geometry.attributes.skinIndex;
    for(let i=0;i<indices.count;i++){
      if(node.skeleton.bones[indices.getX(i)].name!==`${side}_foot`)continue;
      node.getVertexPosition(i,point);point.applyMatrix4(node.matrixWorld);box.expandByPoint(point);
    }
  });
  return box;
}
