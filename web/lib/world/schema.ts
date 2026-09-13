import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;
const id = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
export const vectorSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export type Vec3 = z.infer<typeof vectorSchema>;
const assetUrl = z.string().max(2048).refine((value) => /^\/(?!\/)/.test(value) || /^https:\/\//.test(value), "Use a root-relative asset path or HTTPS URL");
const boxSchema = z.object({ min: vectorSchema, max: vectorSchema }).refine(({ min, max }) => min.every((v, i) => v < max[i]), "Box minimum must be below maximum");
export const environmentSchema = z.object({
  id, revision: id, name: z.string().min(1).max(120),
  // All coordinates below are exported world coordinates: meters, glTF Y-up.
  assetUrl: assetUrl.nullable(), spawn: vectorSchema,
  bounds: boxSchema, colliders: z.array(boxSchema).max(256),
  npcSpawns: z.record(id, vectorSchema),
}).superRefine((value, context) => {
  const inside = (p: Vec3) => p.every((v, i) => v >= value.bounds.min[i] && v <= value.bounds.max[i]);
  if (!inside(value.spawn) || Object.values(value.npcSpawns).some((p) => !inside(p))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Spawn points must be inside world bounds" });
  }
});
export type EnvironmentManifest = z.infer<typeof environmentSchema>;
export const npcSchema = z.object({
  id, name: z.string().min(1).max(80), role: z.string().max(120),
  scenarioId: id, position: vectorSchema, interactionRadius: z.number().positive().max(10),
  // Dialogue prompts and secrets stay on the voice server, not in this descriptor.
  avatarUrl: assetUrl.nullable().default(null),
});
export type NpcSnapshot = z.infer<typeof npcSchema>;
export const playerSchema = z.object({
  id, name: z.string().min(1).max(32), position: vectorSchema,
  yaw: z.number().finite(), animation: z.enum(["idle", "walk"]),
});
export type PlayerSnapshot = z.infer<typeof playerSchema>;
export const encounterSchema = z.object({
  id, npcId: id, ownerId: id, participantIds: z.array(id).min(1).max(8),
  speakerId: id.nullable(),
});
export type EncounterSnapshot = z.infer<typeof encounterSchema>;
export const roomSchema = z.object({
  protocol: z.literal(PROTOCOL_VERSION), roomId: id, revision: z.number().int().nonnegative(),
  environment: environmentSchema, players: z.array(playerSchema).max(8), npcs: z.array(npcSchema).max(64),
  encounters: z.array(encounterSchema).max(8),
});
export type RoomSnapshot = z.infer<typeof roomSchema>;
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), direction: z.tuple([z.number().finite().min(-1).max(1), z.number().finite().min(-1).max(1)]), yaw: z.number().finite().min(-Math.PI).max(Math.PI), sequence: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("interact"), npcId: id }).strict(),
  z.object({ type: z.literal("join-encounter"), encounterId: id }).strict(),
  z.object({ type: z.literal("claim-turn"), encounterId: id }).strict(),
  z.object({ type: z.literal("release-turn"), encounterId: id }).strict(),
  z.object({ type: z.literal("leave-encounter") }).strict(),
]);
export type WorldCommand = z.infer<typeof commandSchema>;
export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join"), protocol: z.literal(PROTOCOL_VERSION), roomId: id, name: z.string().trim().min(1).max(32) }).strict(),
  z.object({ type: z.literal("command"), command: commandSchema }).strict(),
]);
export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("welcome"), playerId: id, snapshot: roomSchema }),
  z.object({ type: z.literal("snapshot"), snapshot: roomSchema }),
  z.object({ type: z.literal("error"), message: z.string().max(300) }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
