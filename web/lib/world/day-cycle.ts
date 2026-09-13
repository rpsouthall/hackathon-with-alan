import { DAY_LENGTH_SECONDS, INITIAL_HOUR, sharedWorldHour, type WorldClockAnchor } from "./world-clock";
export { DAY_LENGTH_SECONDS, INITIAL_HOUR } from "./world-clock";
export interface WorldTime { hours: number; playing: boolean; source: "shared" | "personal" | "local" }

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
  private sharedClock: WorldClockAnchor | null = null;
  private personalOverride = false;
  private transition?: { start: number; distance: number; elapsed: number };
  constructor(private readonly reducedMotion = false, private readonly now = () => performance.now()) { this.playing = !reducedMotion; }

  get source(): WorldTime["source"] { return this.sharedClock ? this.personalOverride ? "personal" : "shared" : "local"; }
  syncWorldClock(anchor: WorldClockAnchor | null): void {
    this.sharedClock = anchor;
    if (anchor && !this.personalOverride) { this.playing = true; this.transition = undefined; this.update(0); }
  }
  returnToSharedTime(): void {
    if (!this.sharedClock) return;
    this.personalOverride = false; this.playing = true; this.transition = undefined; this.update(0);
  }

  setHour(hours: number, animate = true): void {
    if (!Number.isFinite(hours)) return;
    this.personalOverride = true;
    this.playing = false;
    const distance = wrapHour(hours - this.hours + 12) - 12;
    if (this.reducedMotion || !animate) { this.hours = wrapHour(hours); this.transition = undefined; }
    else this.transition = { start: this.hours, distance, elapsed: 0 };
  }
  setPlaying(playing: boolean): void { this.personalOverride = true; this.playing = playing; this.transition = undefined; }
  update(dt: number): void {
    // Frame dt is clamped for physics/animation. Shared time must catch up after
    // background tabs and renderer startup, independently of the device wall clock.
    if (this.sharedClock && !this.personalOverride) { this.hours = sharedWorldHour(this.sharedClock, this.now()); return; }
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
