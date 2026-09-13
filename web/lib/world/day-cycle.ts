/** A full Kyoto day lasts twelve minutes; presentation never changes room state. */
export const DAY_LENGTH_SECONDS = 12 * 60;
export const INITIAL_HOUR = 14;
export interface WorldTime { hours: number; playing: boolean }

export function wrapHour(hours: number): number { return ((hours % 24) + 24) % 24; }
export function daylightAtHour(hours: number): number {
  const elevation = Math.sin((wrapHour(hours) - 6) * Math.PI / 12);
  const amount = Math.max(0, Math.min(1, (elevation + .12) / .48));
  return amount * amount * (3 - 2 * amount);
}
export function formatWorldTime(hours: number): string {
  const minutes = Math.floor(wrapHour(hours) * 60) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export class DayCycle {
  hours = INITIAL_HOUR;
  playing: boolean;
  private transition?: { start: number; distance: number; elapsed: number };
  constructor(private readonly reducedMotion = false) { this.playing = !reducedMotion; }

  setHour(hours: number, animate = true): void {
    if (!Number.isFinite(hours)) return;
    this.playing = false;
    const distance = wrapHour(hours - this.hours + 12) - 12;
    if (this.reducedMotion || !animate) { this.hours = wrapHour(hours); this.transition = undefined; }
    else this.transition = { start: this.hours, distance, elapsed: 0 };
  }
  setPlaying(playing: boolean): void { this.playing = playing; this.transition = undefined; }
  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (this.transition) {
      const transition = this.transition;
      transition.elapsed += dt;
      const t = Math.min(1, transition.elapsed / 2.4);
      this.hours = wrapHour(transition.start + transition.distance * t * t * (3 - 2 * t));
      if (t === 1) this.transition = undefined;
    } else if (this.playing) this.hours = wrapHour(this.hours + dt * 24 / DAY_LENGTH_SECONDS);
  }
}
