let root;
export function initialize(data) { root=data.root; }
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'three') return nextResolve(new URL('build/three.module.js',root).href,context);
  if (specifier.startsWith('three/addons/')) return nextResolve(new URL(`examples/jsm/${specifier.slice(13)}`,root).href,context);
  return nextResolve(specifier,context);
}
