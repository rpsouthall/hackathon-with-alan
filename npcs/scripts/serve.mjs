import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const base=await realpath(root);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary','.png':'image/png','.svg':'image/svg+xml'};
const port=Number(process.env.PORT ?? 4174);
createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    let path=resolve(root,'.'+decodeURIComponent(url.pathname));
    let data=await stat(path);
    if(data.isDirectory()) { path=resolve(path,'index.html'); data=await stat(path); }
    const actual=await realpath(path);
    if(!actual.startsWith(base+sep)) { res.writeHead(403);res.end('Forbidden');return; }
    res.writeHead(200,{'Content-Type':mime[extname(path)]??'application/octet-stream','Content-Length':data.size,'Cache-Control':'no-cache'});
    createReadStream(path).pipe(res);
  } catch { res.writeHead(404);res.end('Not found'); }
}).listen(port,'127.0.0.1',()=>console.log(`Komorebi character workshop: http://127.0.0.1:${port}`));
