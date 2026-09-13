import type { WorldClockSnapshot } from "./schema";

export const DAY_LENGTH_SECONDS = 12 * 60;
export const INITIAL_HOUR = 14;
// A fixed epoch keeps the sky continuous through empty rooms and server restarts.
export const WORLD_CLOCK_EPOCH_MS = 0;

export interface WorldClockAnchor {
  sample: WorldClockSnapshot;
  /** Captured by the store at receipt, before React or Three.js loads. */
  receivedAtMs: number;
  /** Optional round-trip estimate, measured by the world socket. */
  latencyMs?: number | null;
}

export function sampleWorldClock(serverTimeMs = Date.now()): WorldClockSnapshot {
  return { serverTimeMs, epochMs: WORLD_CLOCK_EPOCH_MS, dayLengthSeconds: DAY_LENGTH_SECONDS, initialHour: INITIAL_HOUR };
}

export function sharedWorldHour(anchor: WorldClockAnchor, nowMs: number): number {
  const { sample, receivedAtMs } = anchor;
  const roundTripMs = Number.isFinite(anchor.latencyMs) ? Math.min(Math.max(anchor.latencyMs ?? 0, 0), 2000) : 0;
  const elapsedMs = sample.serverTimeMs - sample.epochMs + Math.max(0, nowMs - receivedAtMs) + roundTripMs / 2;
  const hours = sample.initialHour + (elapsedMs % (sample.dayLengthSeconds * 1000)) * 24 / (sample.dayLengthSeconds * 1000);
  return ((hours % 24) + 24) % 24;
}
