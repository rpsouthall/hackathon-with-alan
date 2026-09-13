import { register } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
if (!process.env.THREE_COMPAT_ROOT) throw new Error('Set THREE_COMPAT_ROOT to the target node_modules/three directory.');
register('./three-compat-loader.mjs', import.meta.url, { data: { root: pathToFileURL(resolve(process.env.THREE_COMPAT_ROOT) + '/').href } });
