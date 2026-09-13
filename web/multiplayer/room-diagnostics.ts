import { z } from "zod";

// The pinned Workers types support APAC; this is a best-effort placement hint,
// not a Singapore data-center guarantee. New names avoid old rooms' fixed placement.
export const ROOM_LOCATION_HINT = "apac" as const;
export const ROOM_GENERATION = "v3-apac";
export const roomObjectName = (roomId: string) => `${ROOM_GENERATION}:${roomId}`;
export const diagnosticRequestSchema = z.object({
  type: z.literal("diagnostic-ping"), id: z.number().int().min(0).max(2147483647),
}).strict();

const stats = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  const rounded = (value: number) => Math.round(value*100)/100;
  return { p50: rounded(sorted[Math.floor(sorted.length/2)]), p95: rounded(sorted[Math.ceil(sorted.length*.95)-1]), max: rounded(sorted[sorted.length-1]) };
};

/** Bounded in-memory operational samples, reset when the room empties. */
export class RoomTickDiagnostics {
  private samples: { interval: number; duration: number }[] = [];
  record(intervalMs: number, durationMs: number) {
    if (!Number.isFinite(intervalMs) || !Number.isFinite(durationMs) || intervalMs < 0 || durationMs < 0) return;
    this.samples.push({ interval: intervalMs, duration: durationMs });
    if (this.samples.length > 120) this.samples.shift();
  }
  snapshot() {
    const durationResolved = this.samples.some(s=>s.duration>0);
    return {
      samples: this.samples.length, targetIntervalMs: 50,
      intervalMs: stats(this.samples.map(s=>s.interval)),
      latenessMs: stats(this.samples.map(s=>Math.max(0,s.interval-50))),
      // Workerd's clock may not advance during synchronous execution. Never
      // interpret an all-zero sample as zero CPU use or a healthy tick cost.
      processingWallMs: durationResolved ? stats(this.samples.map(s=>s.duration)) : null,
      processingClock: durationResolved ? "wall-clock-not-cpu" : "below-clock-resolution",
      cpuMs: null,
    };
  }
}
