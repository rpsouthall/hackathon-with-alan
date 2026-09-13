import { z } from "zod";

export const VOICE_RADIUS = 12;
export const MAX_VOICE_PEERS = 7;
export const VOICE_ENVELOPE_LIMIT = 20000;
const id = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
export const playerVoiceSignalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("offer"), sdp: z.string().min(1).max(16000) }).strict(),
  z.object({ kind: z.literal("answer"), sdp: z.string().min(1).max(16000) }).strict(),
  z.object({ kind: z.literal("ice"), candidate: z.object({
    candidate: z.string().max(2048).optional(), sdpMid: z.string().max(100).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(100).nullable().optional(), usernameFragment: z.string().max(256).nullable().optional(),
  }).strict().nullable() }).strict(),
]);
export const playerVoiceClientSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("voice-join") }).strict(),
  z.object({ type: z.literal("voice-leave") }).strict(),
  z.object({ type: z.literal("voice-signal"), to: id, sessionId: id, signal: playerVoiceSignalSchema }).strict(),
]);
export const voiceIceSchema = z.object({
  urls: z.union([z.string().regex(/^(stun|stuns|turn|turns):/), z.array(z.string().regex(/^(stun|stuns|turn|turns):/)).min(1).max(8)]),
  username: z.string().max(512).optional(), credential: z.string().max(1024).optional(),
}).strict();
export const playerVoiceServerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("voice-peers"), peers: z.array(z.object({ playerId: id, sessionId: id }).strict()).max(MAX_VOICE_PEERS), iceServers: z.array(voiceIceSchema).max(8), radius: z.literal(VOICE_RADIUS) }).strict(),
  z.object({ type: z.literal("voice-signal"), from: id, sessionId: id, signal: playerVoiceSignalSchema }).strict(),
  z.object({ type: z.literal("voice-error"), message: z.string().max(300) }).strict(),
]);
export type PlayerVoiceClientMessage = z.infer<typeof playerVoiceClientSchema>;
export type PlayerVoiceServerMessage = z.infer<typeof playerVoiceServerSchema>;
export type VoiceIceServer = z.infer<typeof voiceIceSchema>;
