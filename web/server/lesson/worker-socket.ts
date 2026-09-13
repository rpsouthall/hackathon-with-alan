import { EventEmitter } from 'node:events';
import type { LessonSocket, SocketFactory } from './socket';

/** Native Workers sockets preserve the existing lesson/provider wire protocol. */
export class WorkerSocket extends EventEmitter implements LessonSocket {
  private socket?: WebSocket;
  private stopped = false;
  private state = 0;
  private opening = new AbortController();
  get readyState() { return this.state; }
  get bufferedAmount() { return 0; }
  constructor(socket?: WebSocket, private maxPayload = 24 * 1024) {
    super();
    if (socket) this.bind(socket);
  }
  private bind(socket: WebSocket) {
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    this.state = 1;
    socket.addEventListener('message', event => {
      const text = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data);
      if (new TextEncoder().encode(text).byteLength > this.maxPayload) { this.close(1009, 'Message too large'); return; }
      this.emit('message', text);
    });
    socket.addEventListener('close', () => this.finish());
    socket.addEventListener('error', () => { this.emit('error', new Error('Live socket failed')); this.finish(); });
  }
  private finish() {
    if (this.state === 3) return;
    this.state = 3;
    this.emit('close');
  }
  async connect(url: string, headers: Record<string, string> = {}) {
    try {
      const destination = new URL(url);
      if (!['wss:', 'https:'].includes(destination.protocol)) throw new Error('Secure live connection required');
      destination.protocol = 'https:';
      // Workers supports follow/manual, not error. Never forward provider credentials through a redirect.
      const response = await fetch(destination, { headers: { ...headers, Upgrade: 'websocket' }, signal: this.opening.signal, redirect: 'manual' });
      const socket = response.webSocket;
      if (!socket) throw new Error(`Provider rejected the live connection (HTTP ${response.status}).`);
      socket.accept();
      if (this.stopped) { socket.close(1000, 'Cancelled'); return; }
      this.bind(socket);
      this.emit('open');
    } catch (cause) {
      // Only fixed wording and the HTTP status reach the UI; never response bodies, tokens or URLs.
      const status = cause instanceof Error ? cause.message.match(/\(HTTP \d{3}\)/)?.[0] : undefined;
      if (!this.stopped) this.emit('error', new Error(`Provider live connection failed${status ? ` ${status}` : ''}.`));
      this.finish();
    }
  }
  send(data: string) { if (this.state === 1) this.socket?.send(data); }
  close(code = 1000, reason = '') {
    this.stopped = true;
    this.opening.abort();
    try { this.socket?.close(code, reason); } finally { this.finish(); }
  }
  terminate() { this.close(); }
}
export const connectWorkerSocket: SocketFactory = (url, options) => {
  const socket = new WorkerSocket(undefined, options.maxPayload);
  void socket.connect(url, options.headers);
  return socket;
};
