"use client";

import { useState } from "react";
import { formatWorldTime, type WorldTime } from "@/lib/world/day-cycle";
import styles from "./atmosphere-controls.module.css";

export function AtmosphereControls({ time, onHour, onPlaying, onSharedTime }: { time: WorldTime; onHour: (hour: number, animate?: boolean) => void; onPlaying: (playing: boolean) => void; onSharedTime: () => void }) {
  const [open, setOpen] = useState(false);
  const night = time.hours < 6 || time.hours >= 19;
  return <div className={styles.root} onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}>
    <button className={styles.trigger} type="button" aria-label="Time of day" aria-expanded={open} onClick={() => setOpen(!open)}>
      <span aria-hidden="true">{night ? "☾" : "☀"}</span><span>{time.source === "personal" ? "Your sky" : "Kyoto"} · {formatWorldTime(time.hours)}</span><span className={styles.chevron} aria-hidden="true">{open ? "⌃" : "⌄"}</span>
    </button>
    {open && <section className={styles.panel} aria-label="Sky and time controls">
      <div className={styles.heading}><span>{time.source === "shared" ? "Shared world time" : time.source === "personal" ? "Personal lighting" : "Local lighting"}</span><span className={styles.clock}>{formatWorldTime(time.hours)}</span></div>
      <label className={styles.sliderLabel}>Adjust your lighting only
        <input aria-label="Set personal time of day" type="range" min="0" max="23.99" step=".25" value={time.hours} onChange={event => onHour(Number(event.target.value), false)} />
      </label>
      <div className={styles.presets}>{[{ label: "Dawn", hour: 6.5 }, { label: "Day", hour: 12 }, { label: "Sunset", hour: 17.5 }, { label: "Night", hour: 22 }].map(preset => <button key={preset.label} type="button" onClick={() => onHour(preset.hour)}>{preset.label}</button>)}</div>
      <button className={styles.play} type="button" onClick={() => onPlaying(!time.playing)} aria-label={time.playing ? "Pause your day and night cycle" : "Resume your personal day and night cycle"}><span aria-hidden="true">{time.playing ? "Ⅱ" : "▷"}</span> {time.playing ? "Pause for me" : "Play personal cycle"}</button>
      {time.source === "personal" && <button className={styles.play} type="button" onClick={onSharedTime}>Return to shared time</button>}
      <p>{time.source === "shared" ? "Everyone follows the same 12-minute day. Changes here affect your view only." : time.source === "personal" ? "Your lighting is different. Other players still follow shared time." : "This room has not supplied a shared clock."}</p>
    </section>}
  </div>;
}
