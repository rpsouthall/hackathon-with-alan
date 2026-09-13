import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { readFile } from "node:fs/promises";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SceneryCutaway, setOcclusionRay, isOccludingScenery } from "../../lib/world/occlusion";
import { fitSunShadow } from "../../lib/world/lighting";

test("orthographic occlusion ray passes through an off-center player parallel to view", () => {
  const camera = new THREE.OrthographicCamera(-12,12,12,-12,.1,250);
  camera.position.set(18,18,18); camera.lookAt(0,0,0); camera.updateMatrixWorld(true);
  const target = new THREE.Vector3(6,1.2,-4), ray = new THREE.Raycaster();
  setOcclusionRay(ray,camera,target);
  assert.ok(ray.ray.distanceToPoint(target)<1e-10);
  assert.ok(ray.ray.direction.distanceTo(camera.getWorldDirection(new THREE.Vector3()))<1e-10);
  assert.ok(ray.far>0);
  const cameraRay = new THREE.Ray(camera.position,target.clone().sub(camera.position).normalize());
  assert.ok(cameraRay.direction.distanceTo(ray.ray.direction)>.1);
});

test("cutaway holds brief ray misses without alpha sorting or shader churn", () => {
  const material = new THREE.MeshStandardMaterial(), mesh = new THREE.Mesh(new THREE.BoxGeometry(),material);
  const cutaway=new SceneryCutaway(), camera=new THREE.OrthographicCamera();
  const target=new THREE.Vector3(0,1.2,0), hit=new Set([mesh]), clear=new Set<THREE.Mesh>();
  cutaway.register(mesh);
  const shader={uniforms:THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
  material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], {} as THREE.WebGLRenderer);
  assert.ok(shader.fragmentShader.includes("cutWorldPosition.y > cutFocus.y - 1.08"));
  const amount=shader.uniforms.cutAmount;
  const version=material.version;
  cutaway.update(hit,0,1/60,target,camera);
  assert.ok(amount.value>0 && amount.value<1);
  for(let now=16;now<600;now+=16)cutaway.update(now%64<32?hit:clear,now,1/60,target,camera);
  assert.ok(amount.value>.95);
  assert.equal(material.version,version);
  assert.equal(material.opacity,1);assert.equal(material.transparent,false);assert.equal(material.depthWrite,true);
  for(let now=600;now<2600;now+=16)cutaway.update(clear,now,1/60,target,camera);
  assert.ok(amount.value<.001);
  mesh.geometry.dispose();material.dispose();
});

test("town ground cannot be selected for a local cutaway", () => {
  const mesh=new THREE.Mesh();
  for(const name of ["SM_City_Ground_water.001","SM_City_Street_paving.001","MARK_player_spawn"]) {
    mesh.name=name;assert.equal(isOccludingScenery(mesh),false);
  }
  mesh.name="SM_Venue_ramen_akari_roof.001";assert.equal(isOccludingScenery(mesh),true);
  mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();
});

test("perspective camera sight rays keep their camera origin", () => {
  const camera=new THREE.PerspectiveCamera(), target=new THREE.Vector3(4,1,0), ray=new THREE.Raycaster();
  camera.position.set(3,4,8);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
  setOcclusionRay(ray,camera,target);
  assert.ok(ray.ray.origin.equals(camera.position));
  assert.ok(ray.ray.distanceToPoint(target)<1e-10);
});

test("actual city roof and trim share cutaway despite GLTFLoader name sanitization", async () => {
  const bytes=await readFile(new URL("../../public/models/kyoto/kyoto_city_lod1.glb",import.meta.url));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),"");
  const meshes:THREE.Mesh[]=[];
  gltf.scene.traverse(node=>{if(node instanceof THREE.Mesh)meshes.push(node);});
  const roof=meshes.find(mesh=>/^SM_Venue_sakura_bakery_roof\d*$/.test(mesh.name))!;
  const trim=meshes.find(mesh=>/^SM_Venue_sakura_bakery_roof_edge\d*$/.test(mesh.name))!;
  const neighbor=meshes.find(mesh=>/^SM_Venue_izakaya_tomo_roof\d*$/.test(mesh.name))!;
  assert.ok(roof&&trim&&neighbor);
  const cutaway=new SceneryCutaway(),camera=new THREE.OrthographicCamera(),focus=new THREE.Vector3(0,1.2,0);
  camera.position.set(18,18,18);camera.lookAt(focus);camera.updateMatrixWorld(true);
  for(const mesh of [roof,trim,neighbor])cutaway.register(mesh);
  for(let now=0;now<1000;now+=16)cutaway.update(new Set([roof]),now,.016,focus,camera);
  const inFront=focus.clone().addScaledVector(camera.getWorldDirection(new THREE.Vector3()),-1);
  assert.ok(cutaway.isCutAway(roof,inFront));
  assert.ok(cutaway.isCutAway(trim,inFront),"matching trim should open without its own ray hit");
  assert.equal(cutaway.isCutAway(neighbor,inFront),false,"unrelated venue remains intact");
  assert.equal(cutaway.isCutAway(roof,new THREE.Vector3(0,.05,0)),false,"floor is preserved");
  for(const mesh of meshes){mesh.geometry.dispose();for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])material.dispose();}
});

test("shadow frustum contains all city corners and remains fixed when camera moves", () => {
  const sun=new THREE.DirectionalLight(), bounds=new THREE.Box3(new THREE.Vector3(-34,-4,-27),new THREE.Vector3(34,24,27));
  sun.position.set(-38,70,30);sun.target.position.set(0,10,0);
  fitSunShadow(sun,bounds);
  for(const x of [-34,34])for(const y of [-4,24])for(const z of [-27,27]) {
    const p=new THREE.Vector3(x,y,z).project(sun.shadow.camera);
    assert.ok(Math.abs(p.x)<=1 && Math.abs(p.y)<=1 && Math.abs(p.z)<=1,`corner ${x},${y},${z} outside shadow`);
  }
  sun.dispose();
});
