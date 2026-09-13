"use client";

import { useEffect, useRef } from "react";
import { EMOTES, EMOTE_NAMES, type EmoteName } from "@/lib/world/player-actions";

function EmoteGlyph({ name }: { name: EmoteName }) {
  const bow = name === "bow", nod = name === "nod";
  return <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className="emote-glyph">
    <g stroke="currentColor" strokeWidth="3.5" strokeLinecap="square" strokeLinejoin="miter">
      <path d={bow ? "M23 16L34 23V30H27V23L18 18" : "M18 8H30V19H18Z"} />
      <path d={bow ? "M18 18L13 31H26L29 43M13 31L10 43" : "M18 23H30V34H18ZM20 35V43M28 35V43"} />
      <path d={name === "cheer" ? "M18 24L10 17V7M30 24L38 17V7" : name === "wave" ? "M18 24L13 33M30 24L37 18V9" : bow ? "M24 24L27 35" : "M18 24L13 34M30 24L35 34"} />
      {name === "wave" && <path d="M41 7L44 10M41 16H45" strokeWidth="2" />}
      {name === "cheer" && <path d="M4 3L7 5M44 3L41 5" strokeWidth="2" />}
      {nod && <path d="M36 6V16L40 12M36 16L32 12" strokeWidth="2" />}
    </g>
  </svg>;
}

export function EmoteWheel({ onChoose, onClose }: { onChoose: (name: EmoteName) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Remove the modal's inert state before the parent returns focus to the world.
  function close() { dialog.current?.close(); onClose(); }
  function choose(name: EmoteName) { dialog.current?.close(); onChoose(name); }
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    element.querySelector<HTMLButtonElement>("button")?.focus();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="emote-dialog" aria-labelledby="emote-title" aria-describedby="emote-help"
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClick={(event) => { if (event.target === event.currentTarget) close(); }}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key.toLowerCase() === "g") { event.preventDefault(); if (!event.repeat) close(); }
      const index = ["1", "2", "3", "4"].indexOf(event.key);
      if (index >= 0 && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); choose(EMOTE_NAMES[index]); }
    }}>
    <div className="emote-wheel-panel">
      <p className="emote-eyebrow">A LITTLE HELLO GOES A LONG WAY</p>
      <h2 id="emote-title">Express yourself</h2>
      <div className="emote-wheel">
        {EMOTE_NAMES.map((name, index) => <button key={name} type="button" className={`emote-choice emote-choice-${name}`} aria-label={EMOTES[name].label} onClick={() => choose(name)}>
          <kbd aria-hidden="true">{index + 1}</kbd><EmoteGlyph name={name} />
          <strong>{EMOTES[name].label}</strong><span lang="ja">{EMOTES[name].japanese}</span>
        </button>)}
        <button type="button" className="emote-cancel" aria-label="Close emote wheel" onClick={close}><span aria-hidden="true">×</span><small>Close</small></button>
      </div>
      <p id="emote-help">Choose an emote · <kbd>1</kbd>–<kbd>4</kbd> to select · <kbd>Esc</kbd> to close</p>
      <p className="emote-footnote">Your friends can see your emotes. Moving ends the gesture.</p>
    </div>
  </dialog>;
}
