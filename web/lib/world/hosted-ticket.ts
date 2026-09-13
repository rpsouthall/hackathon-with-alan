import { z } from "zod";

export const roomCodeSchema = z.string().trim().min(1).max(48).regex(/^[a-zA-Z0-9_-]+$/).transform((value) => value.toLowerCase());
export const hostedJoinSchema = z.object({
  roomId: roomCodeSchema,
  name: z.string().trim().min(1).max(32).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), "Use a display name without control characters"),
}).strict();
const ticketSchema = hostedJoinSchema.extend({
  playerId: z.string().uuid(), nonce: z.string().uuid(), expiresAt: z.number().int(),
  origin: z.string().url(),
}).strict();
export type WorldTicket = z.infer<typeof ticketSchema>;
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const decode = (value: string) => Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
const key = (secret: string, usage: KeyUsage[]) => {
  if (secret.length < 32) throw new Error("World ticket secret is missing");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);
};
export async function signWorldTicket(ticket: WorldTicket, secret: string): Promise<string> {
  const body = encode(new TextEncoder().encode(JSON.stringify(ticketSchema.parse(ticket))));
  const signature = await crypto.subtle.sign("HMAC", await key(secret, ["sign"]), new TextEncoder().encode(body));
  return `${body}.${encode(new Uint8Array(signature))}`;
}
export async function verifyWorldTicket(token: string, secret: string, origin: string, now = Date.now()): Promise<WorldTicket | null> {
  try {
    if (token.length > 2048) return null;
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra) return null;
    const valid = await crypto.subtle.verify("HMAC", await key(secret, ["verify"]), decode(signature), new TextEncoder().encode(body));
    if (!valid) return null;
    const ticket = ticketSchema.parse(JSON.parse(new TextDecoder().decode(decode(body))));
    if (ticket.origin !== origin || ticket.expiresAt <= now || ticket.expiresAt > now + 90_000) return null;
    return ticket;
  } catch { return null; }
}

export function worldSocketUrl(server: string): string {
  const url = new URL(server);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!["https:", "wss:"].includes(url.protocol) && !(loopback && ["http:", "ws:"].includes(url.protocol))) throw new Error("The game server must use a secure connection");
  if (url.username || url.password || url.search || url.hash) throw new Error("Invalid game server address");
  url.protocol = ["https:", "wss:"].includes(url.protocol) ? "wss:" : "ws:";
  url.pathname = "/world";
  return url.toString();
}
