import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = join(web, 'multiplayer');
const require = createRequire(join(web, 'package.json'));
const { build } = require('esbuild');
const pkg = dirname(require.resolve('@dimforge/rapier3d-compat'));
const source = join(scratch, '.generated-source');
const out = join(scratch, 'generated-rapier');
const metadata = JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8'));
if (metadata.version !== '0.19.0') throw new Error(`Expected Rapier 0.19.0, got ${metadata.version}`);
const sourceMapText = await readFile(join(pkg, 'rapier.mjs.map'), 'utf8');
const digest = (value) => createHash('sha256').update(value).digest('hex');
if (digest(sourceMapText) !== '0018762ab3878fbd60d02367fd0c6dc5c2920ca8877da9e918d69a750f322e1b') {
  throw new Error('Rapier source-map content differs from the verified 0.19.0 package');
}
if (digest(await readFile(join(pkg, 'rapier_wasm3d_bg.wasm'))) !== 'c8cf07035996629dbf6156c82fec836ddc1c6cff78cf6afde726c30585da2bfd') {
  throw new Error('Rapier WASM content differs from the verified 0.19.0 package');
}
const map = JSON.parse(sourceMapText);
const prefix = '../gen3d/gen3d/';
const saved = [];
async function save(relative, content) {
  const target = resolve(source, relative);
  if (!target.startsWith(`${source}/`)) throw new Error('Unsafe source path');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
  saved.push(relative);
}
for (let index = 0; index < map.sources.length; index++) {
  const path = map.sources[index];
  if (!path.startsWith(prefix)) continue;
  const relative = path.slice(prefix.length);
  if (relative === 'init.ts') continue;
  if (typeof map.sourcesContent[index] !== 'string') throw new Error(`Missing source ${path}`);
  await save(relative, map.sourcesContent[index]);
}
// These zero-runtime barrels/type declarations are omitted by the package's source map.
for (const relative of ['raw', 'rapier', 'dynamics/index', 'geometry/index', 'pipeline/index', 'control/index', 'geometry/interaction_groups']) {
  await save(`${relative}.ts`, await readFile(join(pkg, `${relative}.d.ts`), 'utf8'));
}
await save('rapier_wasm3d.js', await readFile(join(pkg, 'rapier_wasm3d.js'), 'utf8'));
await save('init.ts', `import wasmModule from './rapier_wasm3d_bg.wasm';
import { initSync } from './rapier_wasm3d.js';
/** Workers receive a precompiled module; no dynamic compilation or WASM fetch. */
export async function init(): Promise<void> {
  initSync({ module: wasmModule });
}
`);
await mkdir(out, { recursive: true });
await build({ entryPoints: [join(source, 'rapier.ts')], outfile: join(out, 'rapier.mjs'), bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', external: ['./rapier_wasm3d_bg.wasm'], sourcemap: true, minify: false });
await copyFile(join(pkg, 'rapier_wasm3d_bg.wasm'), join(out, 'rapier_wasm3d_bg.wasm'));
await writeFile(join(out, 'rapier.d.ts'), `export * from '@dimforge/rapier3d-compat';\nimport RAPIER from '@dimforge/rapier3d-compat';\nexport default RAPIER;\n`);
await copyFile(join(out, 'rapier.d.ts'), join(out, 'rapier.d.mts'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const report = { version: metadata.version, sourceModules: saved.length, sourceMapSha256: sha256(sourceMapText), wasmSha256: sha256(await readFile(join(out, 'rapier_wasm3d_bg.wasm'))), bundleBytes: (await readFile(join(out, 'rapier.mjs'))).length, wasmBytes: (await readFile(join(out, 'rapier_wasm3d_bg.wasm'))).length };
await writeFile(join(out, 'provenance.json'), JSON.stringify(report, null, 2) + '\n');
console.log(report);

for (const file of ['NOTICE', 'LICENSE-APACHE-2.0']) await copyFile(join(scratch, 'third-party', file), join(out, file));
