import { z } from 'zod';

export const LESSON_PROTOCOL = 'kyoto-lesson-v1';
const schema = z.object({
  audience: z.literal(LESSON_PROTOCOL), ownerId: z.string().min(1).max(200),
  origin: z.string().url(), nonce: z.string().uuid(), expiresAt: z.number().int(),
}).strict();
export type LessonTicket = z.infer<typeof schema>;
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const decode = (text: string) => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
const data = (body: string) => new TextEncoder().encode(`${LESSON_PROTOCOL}:${body}`);
const key = (secret: string, usage: KeyUsage[]) => {
  if (secret.length < 32) throw new Error('Lesson ticket signing is unavailable');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usage);
};
export async function signLessonTicket(ticket: LessonTicket, secret: string) {
  const body = encode(new TextEncoder().encode(JSON.stringify(schema.parse(ticket))));
  const signature = await crypto.subtle.sign('HMAC', await key(secret, ['sign']), data(body));
  return `${body}.${encode(new Uint8Array(signature))}`;
}
export async function verifyLessonTicket(token: string, secret: string, origin: string, now = Date.now()): Promise<LessonTicket | null> {
  try {
    if (token.length > 2048) return null;
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra) return null;
    if (!await crypto.subtle.verify('HMAC', await key(secret, ['verify']), decode(signature), data(body))) return null;
    const ticket = schema.parse(JSON.parse(new TextDecoder().decode(decode(body))));
    return ticket.origin === origin && ticket.expiresAt > now && ticket.expiresAt <= now + 90_000 ? ticket : null;
  } catch { return null; }
}
export function lessonSocketUrl(server: string) {
  const url = new URL(server);
  if (!['https:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid lesson server');
  url.protocol = 'wss:'; url.pathname = '/lesson-api/session';
  return url.toString();
}
