import * as THREE from "three";

/** Follow the rendered projection, including the rig's blended projection. */
export function setOcclusionRay(ray: THREE.Raycaster, camera: THREE.Camera, target: THREE.Vector3) {
  ray.camera = camera;
  // The transition rig uses PerspectiveCamera with an intermediate matrix.
  // Only a true perspective projection has its ray origin at the camera.
  if(camera instanceof THREE.PerspectiveCamera && camera.projectionMatrix.elements[15] === 0) {
    const direction=target.clone().sub(camera.position);
    ray.set(camera.position,direction.clone().normalize());
    ray.near=camera.near;
    ray.far=Math.max(ray.near,direction.length()-.2);
    return;
  }
  const ndc = target.clone().project(camera);
  const near = new THREE.Vector3(ndc.x, ndc.y, -1).unproject(camera);
  const far = new THREE.Vector3(ndc.x, ndc.y, 1).unproject(camera);
  const direction = far.sub(near).normalize();
  ray.set(near, direction);
  ray.near = 0;
  ray.far = Math.max(0, target.clone().sub(near).dot(direction) - .2);
}

export function isOccludingScenery(mesh: THREE.Mesh) {
  // City meshes are batched by collection/material: fading a ground batch removes
  // paths across the entire town. Only above-ground scenery may be cut away.
  return !/(^COLLIDER_|^SPAWN_|^MARK_|^SM_COL_|Ground|Street|paving|water|sand)/i.test(mesh.name);
}

/** Local, MSAA-smoothed opening through batched walls/trees. No alpha sorting,
 * temporal noise, or whole-building disappearance; floors and shadows survive. */
export class SceneryCutaway {
  readonly focus = { value: new THREE.Vector3() };
  readonly right = { value: new THREE.Vector3(1,0,0) };
  readonly up = { value: new THREE.Vector3(0,1,0) };
  readonly forward = { value: new THREE.Vector3(0,0,-1) };
  readonly radius = { value: new THREE.Vector2(.95,1.28) };
  private lastArchitectureHit = -Infinity;
  private readonly entries = new Map<THREE.Mesh, { amount: { value: number }; lastHit: number; group: string }>();

  isCutAway(mesh: THREE.Mesh, point: THREE.Vector3) {
    const amount = this.entries.get(mesh)?.amount.value ?? 0;
    const delta = point.clone().sub(this.focus.value);
    return amount > .07 && delta.dot(this.forward.value) < -.15 && point.y > this.focus.value.y - 1.08
      && Math.hypot(delta.dot(this.right.value)/this.radius.value.x,delta.dot(this.up.value)/this.radius.value.y) < amount-.07;
  }

  register(mesh: THREE.Mesh) {
    const materials = Array.isArray(mesh.material)?mesh.material:[mesh.material];
    const name=mesh.name.replace(/\.\d+$/, "");
    const suffix=`_${materials[0].name.replace(/^MAT_/, "")}`;
    const suffixIndex=name.lastIndexOf(suffix);
    // GLTFLoader removes dots from Blender's .001 suffix (roof001).
    const matchesSuffix=suffixIndex>=0&&/^\d*$/.test(name.slice(suffixIndex+suffix.length));
    const group=/^SM_(Venue|Architecture)_/.test(name)&&matchesSuffix ? name.slice(0,suffixIndex) : mesh.uuid;
    const entry = { amount: { value: 0 }, lastHit: -Infinity, group };
    this.entries.set(mesh, entry);
    for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]) {
      material.alphaToCoverage = true;
      material.customProgramCacheKey = () => "kyoto-local-cutaway-v1";
      material.onBeforeCompile = shader => {
        Object.assign(shader.uniforms, { cutFocus: this.focus, cutRight: this.right, cutUp: this.up, cutForward: this.forward, cutAmount: entry.amount, cutRadius: this.radius });
        shader.vertexShader = "varying vec3 cutWorldPosition;\n" + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\ncutWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;");
        shader.fragmentShader = "varying vec3 cutWorldPosition;\nuniform vec3 cutFocus, cutRight, cutUp, cutForward;\nuniform float cutAmount;\nuniform vec2 cutRadius;\n" + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", `#include <opaque_fragment>
          vec3 cutDelta = cutWorldPosition - cutFocus;
          if (cutAmount > 0.001 && dot(cutDelta, cutForward) < -0.15 && cutWorldPosition.y > cutFocus.y - 1.08) {
            float cutDistance = length(vec2(dot(cutDelta, cutRight), dot(cutDelta, cutUp)) / cutRadius);
            float cutCoverage = smoothstep(max(0.0, cutAmount - 0.07), cutAmount, cutDistance);
            if (cutCoverage < 0.01) discard;
            gl_FragColor.a *= cutCoverage;
          }
        `);
      };
    }
  }

  update(hits: ReadonlySet<THREE.Mesh>, now: number, dt: number, target: THREE.Vector3, camera: THREE.Camera) {
    this.focus.value.copy(target);
    this.right.value.setFromMatrixColumn(camera.matrixWorld,0);
    this.up.value.setFromMatrixColumn(camera.matrixWorld,1);
    camera.getWorldDirection(this.forward.value);
    if([...hits].some(mesh=>/SM_(Venue|Architecture)_/i.test(mesh.name))) this.lastArchitectureHit=now;
    const interior=now-this.lastArchitectureHit<400;
    this.radius.value.lerp(new THREE.Vector2(interior?3:.95,interior?2.3:1.28),1-Math.exp(-Math.min(dt,.1)*5));
    const groups = new Set([...hits].map(mesh=>this.entries.get(mesh)?.group));
    for(const [mesh, entry] of this.entries) {
      // Roofs, roof trim and walls share one opening rather than popping by material.
      if(hits.has(mesh)||groups.has(entry.group)) entry.lastHit = now;
      const desired = now-entry.lastHit<240 ? 1 : 0;
      entry.amount.value = THREE.MathUtils.lerp(entry.amount.value,desired,1-Math.exp(-Math.min(dt,.1)*(desired?14:7)));
    }
  }
}
