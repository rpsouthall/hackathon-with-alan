import type { LessonSnapshot } from './types';
export type LessonCue = 'points' | 'correct' | 'complete';
export function rewardCue(previous: LessonSnapshot, next: LessonSnapshot): LessonCue | null {
  if (previous.scenarioId !== next.scenarioId || next.attempts < previous.attempts) return null;
  if (next.completed && !previous.completed) return 'complete';
  if (next.attempts <= previous.attempts) return null;
  if (next.feedback?.verdict === 'correct') return 'correct';
  return (next.rewards?.points ?? 0) > (previous.rewards?.points ?? 0) ? 'points' : null;
}
/** Quiet local chimes: no downloads, network requests, or speech synthesis. */
export class LessonSounds {
  private context?: AudioContext;
  private nodes = new Set<OscillatorNode>();
  enabled = true;
  unlock() {
    if (!this.enabled) return;
    try { this.context ??= new AudioContext(); void this.context.resume().catch(() => {}); } catch { /* Audio is optional. */ }
  }
  play(cue: LessonCue) {
    const ctx = this.context;
    if (!this.enabled || !ctx || ctx.state !== 'running') return;
    const notes = cue === 'complete' ? [523.25, 659.25, 783.99, 1046.5] : cue === 'correct' ? [659.25, 880] : [784];
    notes.forEach((frequency, index) => {
      const oscillator = ctx.createOscillator(), gain = ctx.createGain();
      const start = ctx.currentTime + index * .095;
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.035, start + .012);
      gain.gain.exponentialRampToValueAtTime(.001, start + .22);
      oscillator.connect(gain); gain.connect(ctx.destination); this.nodes.add(oscillator);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); this.nodes.delete(oscillator); };
      oscillator.start(start); oscillator.stop(start + .24);
    });
  }
  mute(value: boolean) { this.enabled = !value; if (value) for (const node of this.nodes) { try { node.stop(); } catch {} } }
  dispose() { this.mute(true); void this.context?.close().catch(() => {}); this.context = undefined; }
}
