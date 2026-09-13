import WebSocket from 'ws';

// WebRTC sessions use a sideband command for backend cleanup, not the SIP hangup API.
export function closeLiveSession(id, key, { connect = (url, options) => new WebSocket(url, options), timeoutMs = 10000 } = {}) {
  return new Promise(resolve => {
    const socket = connect(`wss://api.openai.com/v1/live/sessions/${encodeURIComponent(id)}/attach`, {
      headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: timeoutMs,
    });
    let settled = false;
    const finish = stopped => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (socket.readyState === WebSocket.OPEN) socket.close();
      else if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
      resolve(stopped);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.on('open', () => socket.send(JSON.stringify({ type: 'session.close' })));
    socket.on('message', raw => {
      let event; try { event = JSON.parse(raw.toString()); } catch { return; }
      if (event.type === 'session.closed') finish(true);
    });
    // A missing session can have already been closed by the browser. No final usage is inferred.
    socket.on('unexpected-response', (_req, response) => { response.resume(); finish(response.statusCode === 404); });
    socket.on('error', () => finish(false));
    socket.on('close', () => finish(false));
  });
}
