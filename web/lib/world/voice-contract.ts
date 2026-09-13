import type { RoomSnapshot } from "./schema";

/** Checked on the authoritative voice server before creating/routing a Live session.
 * Do not trust a browser-supplied speakerId or permit a listener's microphone.
 * This contract contains no API credentials and does not open a microphone.
 */
export function voiceAccess(snapshot: RoomSnapshot, authenticatedPlayerId: string) {
  const encounter = snapshot.encounters.find((e) => e.participantIds.includes(authenticatedPlayerId));
  if (!encounter || !snapshot.players.some((p) => p.id === authenticatedPlayerId)) return null;
  const npc = snapshot.npcs.find((n) => n.id === encounter.npcId);
  if (!npc) return null;
  return {
    roomId: snapshot.roomId, encounterId: encounter.id, npcId: npc.id,
    scenarioId: npc.scenarioId, playerId: authenticatedPlayerId,
    canTransmit: encounter.speakerId === authenticatedPlayerId,
    canListen: true as const,
  };
}

export interface AttributedTranscript {
  roomId: string;
  encounterId: string;
  speaker: { kind: "player"; playerId: string } | { kind: "npc"; npcId: string };
  text: string;
  startMs: number;
  endMs: number;
}
