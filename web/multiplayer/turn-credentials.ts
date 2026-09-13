import { z } from "zod";
import { voiceIceSchema, type VoiceIceServer } from "../lib/world/player-voice-contract";

/** These optional values are Worker secrets, never public build variables. */
export interface TurnSecrets { TURN_KEY_ID?: string; TURN_KEY_API_TOKEN?: string }
export const TURN_TTL_SECONDS = 3600;
export const TURN_REFRESH_MS = 50 * 60 * 1000;
export const TURN_RETRY_MS = 60 * 1000;
export const DIRECT_ICE_SERVERS: VoiceIceServer[] = [{ urls: "stun:stun.cloudflare.com:3478" }];
const RESPONSE_LIMIT = 16 * 1024;
const responseSchema = z.object({ iceServers: z.array(voiceIceSchema).min(1).max(8) }).strict();
type Bundle = { iceServers: VoiceIceServer[]; expiresAt: number; refreshAt: number };
export type TurnUpdate = { iceServers: VoiceIceServer[]; status: "pending" | "ready" | "unavailable"; message: string };
type Dependencies = { fetcher: typeof fetch; now: () => number };

async function readResponse(response: Response) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > RESPONSE_LIMIT) { await response.body?.cancel(); throw new Error("TURN response too large"); }
  if (!response.body) throw new Error("Empty TURN response");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, body = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > RESPONSE_LIMIT) { await reader.cancel(); throw new Error("TURN response too large"); }
      body += decoder.decode(next.value, { stream: true });
    }
    return JSON.parse(body + decoder.decode()) as unknown;
  } finally { reader.releaseLock(); }
}

/** One bounded cache per admitted WebSocket; callers own admission and opt-in. */
export class TurnCredentialsSession {
  private active = false;
  private generation = 0;
  private bundle?: Bundle;
  private pending?: AbortController;
  private retryAt = 0;
  private published?: string;
  private dependencies: Dependencies;
  constructor(private secrets: TurnSecrets, dependencies: Partial<Dependencies> = {}) { this.dependencies = { fetcher: (...args) => fetch(...args), now: Date.now, ...dependencies }; }
  enable() { if (!this.active) { this.active = true; this.generation++; this.published = undefined; } }
  disable() { this.active = false; this.generation++; this.pending?.abort(); this.pending = undefined; this.published = undefined; }
  dispose() { this.disable(); this.bundle = undefined; }
  private publish(now: number, changed: (update: TurnUpdate) => void) {
    const usable = this.bundle && this.bundle.expiresAt > now ? this.bundle : undefined;
    const status = usable ? "ready" : this.pending ? "pending" : "unavailable";
    const key = usable ? String(usable.expiresAt) : status;
    if (this.published === key) return;
    this.published = key;
    changed({ iceServers: usable?.iceServers ?? DIRECT_ICE_SERVERS, status, message: usable ? "Voice relay is ready." : this.pending ? "Preparing voice relay…" : "Voice relay is unavailable; trying a direct connection." });
  }
  /** Fast synchronous guard on normal ticks. External I/O runs independently of gameplay. */
  tick(changed: (update: TurnUpdate) => void): Promise<void> | undefined {
    if (!this.active) return;
    const now = this.dependencies.now();
    const key = this.secrets.TURN_KEY_ID?.trim(), token = this.secrets.TURN_KEY_API_TOKEN?.trim();
    if (this.pending || now < this.retryAt || (this.bundle && now < this.bundle.refreshAt) || !key || !token || !/^[A-Za-z0-9_-]{1,128}$/.test(key)) { this.publish(now, changed); return; }
    const generation = this.generation, abort = new AbortController();
    this.pending = abort; this.retryAt = now + TURN_RETRY_MS;
    this.publish(now, changed);
    if (!this.active || this.pending !== abort) return;
    return this.refresh(key, token, abort).then((iceServers) => {
      if (!this.active || generation !== this.generation || this.pending !== abort) return;
      // Use request start as the conservative beginning of the provider's TTL.
      this.bundle = { iceServers, expiresAt: now + TURN_TTL_SECONDS * 1000, refreshAt: now + TURN_REFRESH_MS };
      this.pending = undefined;
      this.publish(this.dependencies.now(), changed);
    }).catch(() => {
      // Provider errors can contain credentials. Report only the fixed fallback status.
      if (this.active && generation === this.generation && this.pending === abort) { this.pending = undefined; this.publish(this.dependencies.now(), changed); }
    }).finally(() => { if (this.pending === abort) this.pending = undefined; });
  }
  private async refresh(key: string, token: string, abort: AbortController): Promise<VoiceIceServer[]> {
    const timeout = setTimeout(() => abort.abort(), 5000);
    try {
      const response = await this.dependencies.fetcher(`https://rtc.live.cloudflare.com/v1/turn/keys/${key}/credentials/generate-ice-servers`, {
        // workerd supports manual/follow, not redirect:"error". Reject every
        // non-2xx below so a redirect can never forward the API token elsewhere.
        method: "POST", redirect: "manual", signal: abort.signal,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error("TURN credentials unavailable"); }
      const parsed = responseSchema.parse(await readResponse(response));
      // Port 53 is blocked by browsers. Preserve the provider's UDP/TCP/TLS fallbacks.
      const servers = parsed.iceServers.flatMap((server) => {
        const urls = (typeof server.urls === "string" ? [server.urls] : server.urls).filter((url) => !/:53(?:\?|$)/.test(url));
        return urls.length ? [{ ...server, urls }] : [];
      });
      if (!servers.some((server) => server.urls.some((url) => /^turns?:/.test(url)) && server.username && server.credential)) throw new Error("No usable TURN relay");
      return servers;
    } finally { clearTimeout(timeout); }
  }
}
