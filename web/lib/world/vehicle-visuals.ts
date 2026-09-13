import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { VehicleKind, VehicleSnapshot } from "./schema";

export const VEHICLE_ASSETS = { scooter: "/models/vehicles/scooter.glb", skateboard: "/models/vehicles/skateboard.glb" } as const;
export const WHEEL_RADII = { scooter: .22, skateboard: .045 } as const;
function dispose(root: THREE.Object3D) {
  const geometry = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  root.traverse(node => { if (node instanceof THREE.Mesh) { geometry.add(node.geometry); for (const m of Array.isArray(node.material) ? node.material : [node.material]) materials.add(m); } });
  geometry.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
}
function fallback(kind: VehicleKind) {
  const group = new THREE.Group();
  const mint = new THREE.MeshStandardMaterial({ color: "#5baf98", roughness: .6 });
  const rubber = new THREE.MeshStandardMaterial({ color: "#243a38", roughness: .8 });
  const part = (geometry: THREE.BufferGeometry, material: THREE.Material, p: number[]) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(p[0], p[1], p[2]); group.add(mesh); return mesh; };
  part(new THREE.BoxGeometry(kind === "scooter" ? .45 : .26, .07, kind === "scooter" ? 1.25 : .85), mint, [0, kind === "scooter" ? .28 : .12, 0]);
  if (kind === "scooter") { part(new THREE.BoxGeometry(.45, .12, .55), rubber, [0,.78,-.25]); part(new THREE.BoxGeometry(.3,.65,.12), mint, [0,.7,.5]); }
  for (const z of kind === "scooter" ? [-.62,.62] : [-.27,.27]) for (const x of kind === "scooter" ? [0] : [-.13,.13]) {
    const r=WHEEL_RADII[kind]; const wheel=part(new THREE.CylinderGeometry(r,r,kind === "scooter" ? .10 : .04,16),rubber,[x,r,z]);wheel.rotation.z=Math.PI/2;
  }
  return group;
}
export class VehicleVisual {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  snapshot: VehicleSnapshot;
  lean = 0;
  private model: THREE.Object3D;
  private placeholder = true;
  private wheels: THREE.Object3D[] = [];
  private stand?: THREE.Object3D;
  private spin = 0;
  constructor(snapshot: VehicleSnapshot) {
    this.snapshot = snapshot;
    this.root.name=`Vehicle_${snapshot.id}`;this.root.position.fromArray(snapshot.position);this.root.rotation.y=snapshot.yaw;
    this.root.add(this.body);this.model=fallback(snapshot.kind);this.body.add(this.model);
  }
  useTemplate(template: THREE.Object3D) {
    this.model.removeFromParent();if(this.placeholder)dispose(this.model);
    this.model=template.clone(true);this.placeholder=false;this.body.add(this.model);
    this.wheels=[];this.model.traverse(node=>{if(node.name.startsWith("Wheel_"))this.wheels.push(node);if(node instanceof THREE.Mesh){node.castShadow=true;node.receiveShadow=true;}});
    this.stand=this.model.getObjectByName("Stand");
  }
  update(dt:number) {
    const s=this.snapshot;const target=new THREE.Vector3(...s.position);
    // A mount can relocate the rider up to 2m; the vehicle itself stays at its parked origin.
    this.root.position.lerp(target,1-Math.exp(-18*dt));
    const turn=Math.atan2(Math.sin(s.yaw-this.root.rotation.y),Math.cos(s.yaw-this.root.rotation.y));
    this.root.rotation.y+=turn*(1-Math.exp(-12*dt));
    const desired=s.riderId ? THREE.MathUtils.clamp(-turn*s.speed*.055,-.12,.12) : 0;
    this.lean=THREE.MathUtils.lerp(this.lean,desired,1-Math.exp(-10*dt));this.body.rotation.z=this.lean;
    this.spin=(this.spin+s.speed*dt/WHEEL_RADII[s.kind])%(Math.PI*2);
    for(const wheel of this.wheels)wheel.rotation.x=this.spin;
    if(this.stand)this.stand.visible=!s.riderId;
  }
  dispose(){this.root.removeFromParent();if(this.placeholder)dispose(this.model);}
}
/** Own templates once per world and share immutable mesh data across the six vehicles. */
export class WorldVehicles {
  readonly items = new Map<string, VehicleVisual>();
  private templates = new Map<VehicleKind, THREE.Object3D>();
  private requested = new Set<VehicleKind>();
  private disposed = false;
  constructor(private scene: THREE.Scene){}
  sync(snapshots: readonly VehicleSnapshot[]) {
    const present=new Set(snapshots.map(s=>s.id));
    for(const [id,item] of this.items)if(!present.has(id)){item.dispose();this.items.delete(id);}
    for(const snapshot of snapshots){
      let item=this.items.get(snapshot.id);
      if(item&&item.snapshot.kind!==snapshot.kind){item.dispose();this.items.delete(snapshot.id);item=undefined;}
      if(!item){item=new VehicleVisual(snapshot);this.items.set(snapshot.id,item);this.scene.add(item.root);const template=this.templates.get(snapshot.kind);if(template)item.useTemplate(template);}
      item.snapshot=snapshot;
      if(!this.requested.has(snapshot.kind)){
        const kind=snapshot.kind;this.requested.add(kind);
        new GLTFLoader().loadAsync(VEHICLE_ASSETS[kind]).then(asset=>{
          if(this.disposed){dispose(asset.scene);return;}this.templates.set(kind,asset.scene);
          for(const v of this.items.values())if(v.snapshot.kind===kind)v.useTemplate(asset.scene);
        }).catch(error=>console.error(`Could not load ${kind}; using visible fallback`,error));
      }
    }
  }
  update(dt:number){for(const item of this.items.values())item.update(dt);}
  dispose(){this.disposed=true;for(const item of this.items.values())item.dispose();this.items.clear();for(const t of this.templates.values())dispose(t);this.templates.clear();}
}
