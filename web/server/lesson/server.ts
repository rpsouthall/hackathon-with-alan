import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { LiveBridge } from './live';
import { LiveSessionSlot } from './live-slot';
import { attachLessonSession, type Bridge, type BridgeFactory } from './session';
import { capabilities } from './runtime';
export { capabilities } from './runtime';

/** Loopback companion for local development; production uses the Sites routes. */
export function createLessonServer(options: { createBridge?: BridgeFactory } = {}) {
  const runtime = process.env;
  const createBridge: BridgeFactory = options.createBridge ?? ((scenario, language, question, sink, avatarId) =>
    new LiveBridge(scenario, language, question, sink, avatarId, (url, settings) => new WebSocket(url, settings), runtime));
  const allowedOrigins = new Set((process.env.LESSON_ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(','));
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' && req.url === '/lesson-api/config') {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ...capabilities(), transport: 'local' }));
    } else { res.writeHead(404); res.end(); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 24 * 1024 });
  const liveSlot = new LiveSessionSlot<Bridge>();
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/lesson-api/session' || !allowedOrigins.has(req.headers.origin || '') || wss.clients.size >= 8) {
      console.warn('Rejected lesson websocket:', { origin: req.headers.origin || '(missing)', clients: wss.clients.size });
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    attachLessonSession(ws, { runtime, createBridge, liveSlot });
    let alive = true;
    ws.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => { if (!alive) ws.terminate(); else { alive = false; ws.ping(); } }, 30000);
    ws.once('close', () => clearInterval(heartbeat));
  });
  const close = async () => { for (const ws of wss.clients) ws.close(1001); wss.close(); server.close(); };
  return { server, close };
}
