export interface MovementInput { direction: [number, number]; yaw: number; sprint: boolean }
export const MIN_MOVEMENT_SEND_MS = 25;
export const MOVEMENT_REFRESH_MS = 50;
/** Every path, including key release and camera rotation, shares this ceiling.
 * Local simulation samples separately and is never throttled by this scheduler. */
export class MovementSendThrottle {
  private lastSentAt = -Infinity;
  private lastSignature = "";
  take(input: MovementInput, now: number): boolean {
    if (!Number.isFinite(now) || now - this.lastSentAt + 1e-6 < this.waitInterval(input)) return false;
    this.lastSentAt = now;
    this.lastSignature = this.signature(input);
    return true;
  }
  retryAfter(input: MovementInput, now: number) { return Math.max(0, this.waitInterval(input) - (now - this.lastSentAt)); }
  private waitInterval(input: MovementInput) { return this.signature(input) !== this.lastSignature ? MIN_MOVEMENT_SEND_MS : MOVEMENT_REFRESH_MS; }
  private signature(input: MovementInput) { return JSON.stringify([input.direction, input.yaw, input.sprint]); }
}
