import { createServer } from 'node:http';
import { attachInworld } from './inworld.mjs';
import { createHandler } from './handler.mjs';
const handle = createHandler(process.env);
const server = createServer(async (req, res) => {
  try {
    // Routes intentionally accept no request bodies. Drain rather than buffer uploads.
    req.resume();
    const response = await handle(new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  } catch { res.writeHead(500); res.end('{"error":"internal_error"}'); }
});
await attachInworld(server, process.env);
server.listen(Number(process.env.PORT || 8787), '127.0.0.1', () => console.log('Voice API listening on http://localhost:' + (process.env.PORT || 8787)));
