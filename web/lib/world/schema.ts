import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;
export const MAX_ROOM_PLAYERS = 32;
const id = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
export const vectorSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export type Vec3 = z.infer<typeof vectorSchema>;
const assetUrl = z.string().max(2048).refine((value) => /^\/(?!\/)/.test(value) || /^https:\/\//.test(value), "Use a root-relative asset path or HTTPS URL");
const boxSchema = z.object({ min: vectorSchema, max: vectorSchema }).refine(({ min, max }) => min.every((v, i) => v < max[i]), "Box minimum must be below maximum");
const quaternionSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])
  .refine((value) => Math.abs(Math.hypot(...value) - 1) < 0.01, "Collider rotation must be a unit quaternion");
export const physicsSchema = z.object({
  colliders: z.array(z.object({
    name: z.string().max(160).optional(), position: vectorSchema,
    halfExtents: vectorSchema.refine((values) => values.every((value) => value > 0 && value <= 1000), "Box half extents must be positive"),
    quaternion: quaternionSchema,
  })).min(1).max(4096),
  gravity: z.number().finite().min(-30).max(-1).default(-9.81),
  stepHeight: z.number().finite().min(0).max(0.4).default(0.22),
  maxSlopeDegrees: z.number().finite().min(1).max(60).default(35),
  groundSnap: z.number().finite().min(0).max(0.5).default(0.30),
});
export const environmentSchema = z.object({
  id, revision: id, name: z.string().min(1).max(120),
  // All coordinates below are exported world coordinates: meters, glTF Y-up.
  assetUrl: assetUrl.nullable(), spawn: vectorSchema,
  bounds: boxSchema, colliders: z.array(boxSchema).max(256),
  npcSpawns: z.record(id, vectorSchema),
  // When present these exported, rotated collision boxes drive Rapier on the authority.
  physics: physicsSchema.optional(),
  lights: z.array(z.object({
    position: vectorSchema,
    color: vectorSchema.refine((value) => value.every((component) => component >= 0 && component <= 1), "Light colors use linear RGB components from zero to one"),
    intensity: z.number().finite().min(0).max(10000), range: z.number().finite().positive().max(1000),
  })).max(32).optional(),
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
  yaw: z.number().finite().optional(),
  // Dialogue prompts and secrets stay on the voice server, not in this descriptor.
  avatarUrl: assetUrl.nullable().default(null),
});
export type NpcSnapshot = z.infer<typeof npcSchema>;
const cosmeticColor = z.string().regex(/^#[0-9a-f]{6}$/i).transform((value) => value.toLowerCase());
export const appearanceSchema = z.object({
  hair: z.enum(["crop", "bob", "topknot"]).default("crop"),
  outfit: z.enum(["jacket", "apron", "haori"]).default("jacket"),
  glasses: z.boolean().default(false), bag: z.boolean().default(false),
  // Visual height only. Every learner uses the same 1.7 m authority capsule.
  height: z.number().finite().min(1.4).max(2.1).default(1.7),
  skin: cosmeticColor.default("#d7a879"), hairColor: cosmeticColor.default("#302924"),
  top: cosmeticColor.default("#567574"), accent: cosmeticColor.default("#d7ab58"),
  trousers: cosmeticColor.default("#343b43"), shoes: cosmeticColor.default("#302d2a"),
});
export type PlayerAppearance = z.infer<typeof appearanceSchema>;
export const avatarAppearanceSchema = appearanceSchema;
export type AvatarAppearance = PlayerAppearance;
export const playerSchema = z.object({
  id, name: z.string().min(1).max(32), position: vectorSchema,
  yaw: z.number().finite(), animation: z.enum(["idle", "walk"]),
  appearance: appearanceSchema.default({}),
});
export type PlayerSnapshot = z.infer<typeof playerSchema>;
export const encounterSchema = z.object({
  id, npcId: id, ownerId: id, participantIds: z.array(id).min(1).max(MAX_ROOM_PLAYERS),
  speakerId: id.nullable(),
});
export type EncounterSnapshot = z.infer<typeof encounterSchema>;
export const roomSchema = z.object({
  protocol: z.literal(PROTOCOL_VERSION), roomId: id, revision: z.number().int().nonnegative(),
  environment: environmentSchema, players: z.array(playerSchema).max(MAX_ROOM_PLAYERS), npcs: z.array(npcSchema).max(64),
  encounters: z.array(encounterSchema).max(MAX_ROOM_PLAYERS),
});
export type RoomSnapshot = z.infer<typeof roomSchema>;
/** Static environment travels once in welcome; live room state stays small. */
export const roomStateSchema = roomSchema.omit({ environment: true }).extend({ environmentRevision: id });
export type RoomStateSnapshot = z.infer<typeof roomStateSchema>;
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("move"), direction: z.tuple([z.number().finite().min(-1).max(1), z.number().finite().min(-1).max(1)]), yaw: z.number().finite().min(-Math.PI).max(Math.PI), sequence: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal("interact"), npcId: id }).strict(),
  z.object({ type: z.literal("join-encounter"), encounterId: id }).strict(),
  z.object({ type: z.literal("claim-turn"), encounterId: id }).strict(),
  z.object({ type: z.literal("release-turn"), encounterId: id }).strict(),
  z.object({ type: z.literal("leave-encounter") }).strict(),
  z.object({ type: z.literal("set-appearance"), appearance: appearanceSchema }).strict(),
]);
export type WorldCommand = z.infer<typeof commandSchema>;
export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join"), protocol: z.literal(PROTOCOL_VERSION), roomId: id, name: z.string().trim().min(1).max(32) }).strict(),
  z.object({ type: z.literal("command"), command: commandSchema }).strict(),
]);
export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("welcome"), playerId: id, snapshot: roomSchema }),
  z.object({ type: z.literal("snapshot"), snapshot: roomSchema }),
  roomStateSchema.extend({ type: z.literal("state") }).strict(),
  z.object({ type: z.literal("error"), message: z.string().max(300) }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
