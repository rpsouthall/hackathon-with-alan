"use client";

import { useState } from "react";
import { formatWorldTime, type WorldTime } from "@/lib/world/day-cycle";
import styles from "./atmosphere-controls.module.css";

export function AtmosphereControls({ time, onHour, onPlaying }: { time: WorldTime; onHour: (hour: number, animate?: boolean) => void; onPlaying: (playing: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const night = time.hours < 6 || time.hours >= 19;
  return <div className={styles.root} onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}>
    <button className={styles.trigger} type="button" aria-label="Time of day" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span aria-hidden="true">{night ? "☾" : "☀"}</span><span>Kyoto · {formatWorldTime(time.hours)}</span><span className={styles.chevron} aria-hidden="true">{open ? "⌃" : "⌄"}</span>
    </button>
    {open && <section className={styles.panel} aria-label="Sky and time controls">
      <div className={styles.heading}><span>Under the Kyoto sky</span><span className={styles.clock}>{formatWorldTime(time.hours)}</span></div>
      <label className={styles.sliderLabel}>Time of day
        <input aria-label="Set time of day" type="range" min="0" max="23.99" step=".25" value={time.hours} onChange={event => onHour(Number(event.target.value), false)} />
      </label>
      <div className={styles.presets}>{[{ label: "Dawn", hour: 6.5 }, { label: "Day", hour: 12 }, { label: "Sunset", hour: 17.5 }, { label: "Night", hour: 22 }].map(preset => <button key={preset.label} type="button" onClick={() => onHour(preset.hour)}>{preset.label}</button>)}</div>
      <button className={styles.play} type="button" onClick={() => onPlaying(!time.playing)} aria-label={time.playing ? "Pause day and night cycle" : "Resume day and night cycle"}><span aria-hidden="true">{time.playing ? "Ⅱ" : "▷"}</span> {time.playing ? "Pause cycle" : "Resume cycle"}</button>
      <p>A Kyoto day lasts 12 minutes.</p>
    </section>}
  </div>;
}
