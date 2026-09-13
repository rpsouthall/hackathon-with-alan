"use client";

import { useEffect, useRef, useState } from "react";
import { Check, RotateCcw, Shirt, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { mountAvatarPreview } from "@/lib/characters/preview";
import { appearanceSchema, type PlayerAppearance } from "@/lib/world/schema";

const presets: { name: string; appearance: PlayerAppearance }[] = [
  { name: "Canal explorer", appearance: { hair: "crop", outfit: "jacket", glasses: false, bag: true, height: 1.7, skin: "#d7a879", hairColor: "#302924", top: "#567574", accent: "#d7ab58", trousers: "#343b43", shoes: "#302d2a" } },
  { name: "Tea house friend", appearance: { hair: "bob", outfit: "apron", glasses: true, bag: false, height: 1.6, skin: "#e5bd9c", hairColor: "#51392c", top: "#b86550", accent: "#e8d6b7", trousers: "#4d5254", shoes: "#493a31" } },
  { name: "Evening traveller", appearance: { hair: "topknot", outfit: "haori", glasses: false, bag: true, height: 1.85, skin: "#946445", hairColor: "#242323", top: "#454d73", accent: "#c3a56b", trousers: "#3b3542", shoes: "#332f36" } },
];
const colors = [["skin", "Skin"], ["hairColor", "Hair colour"], ["top", "Clothing"], ["accent", "Accent"], ["trousers", "Trousers"], ["shoes", "Shoes"]] as const;

export interface CharacterJoinSettings { name: string; roomId: string; serverUrl: string; appearance: PlayerAppearance }

export function CharacterEditor({ appearance, connected, onSave, onClose, joining }: {
  appearance: PlayerAppearance; connected: boolean; onSave: (appearance: PlayerAppearance) => void; onClose?: () => void;
  joining?: { defaults: Omit<CharacterJoinSettings, "appearance">; onJoin: (settings: CharacterJoinSettings) => void };
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<PlayerAppearance>(() => ({ ...appearance }));
  const [validationError, setValidationError] = useState("");
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  function update<K extends keyof PlayerAppearance>(key: K, value: PlayerAppearance[K]) { setDraft((current) => ({ ...current, [key]: value })); setValidationError(""); }
  return <dialog ref={dialog} className="character-editor-dialog" aria-labelledby="character-editor-title" onCancel={(event) => { event.preventDefault(); onClose?.(); }}>
    <form className="character-editor-card" onSubmit={(event) => {
      event.preventDefault();
      const parsed = appearanceSchema.safeParse(draft);
      if (!parsed.success) { setValidationError("Choose a valid appearance before saving."); return; }
      if (joining) {
        const fields = new FormData(event.currentTarget);
        const name = String(fields.get("name")).trim();
        const roomId = String(fields.get("room")).trim().toLowerCase();
        const shared = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") !== "solo";
        const serverUrl = shared ? joining.defaults.serverUrl : "";
        if (!name) { setValidationError("Add your name before joining."); return; }
        if (shared && serverUrl !== "hosted") {
          try { if (!["ws:", "wss:"].includes(new URL(serverUrl).protocol)) throw new Error("protocol"); }
          catch { setValidationError("The shared world is unavailable. Please try again."); return; }
        }
        joining.onJoin({ name, roomId, serverUrl, appearance: parsed.data });
      } else onSave(parsed.data);
    }}>
      <header className="editor-heading"><span className="editor-stamp" aria-hidden="true"><Shirt /></span><div><small>{joining ? "Your story starts here" : "Make yourself at home"}</small><h1 id="character-editor-title">{joining ? "Welcome to Kyoto" : "Your character"}</h1></div>{onClose && <Button type="button" variant="ghost" size="icon" aria-label="Close character editor" onClick={onClose}><X /></Button>}</header>
      <p className="editor-description">{joining ? "Create your traveller and join Kyoto. Everyone using the same room code explores the same streets." : "Choose your look, then return to the streets. Everyone in your room sees your saved character."}</p>
      {joining && <fieldset className="editor-join-fields"><legend>Your visit</legend>
        <label>Your name<input name="name" defaultValue={joining.defaults.name} required maxLength={32} autoFocus /></label>
        <label>Room code<input name="room" defaultValue={joining.defaults.roomId} required pattern="[a-zA-Z0-9_-]+" maxLength={48} /></label>
      </fieldset>}
      <div className="editor-workspace"><CharacterPreview appearance={draft} /><div className="editor-customization">
      <fieldset className="editor-presets"><legend>Start with a style</legend>{presets.map((preset) => <button type="button" key={preset.name} onClick={() => setDraft({ ...preset.appearance })}><span aria-hidden="true" style={{ background: preset.appearance.top }} />{preset.name}</button>)}</fieldset>
      <div className="editor-grid">
        <label>Hair style<select value={draft.hair} onChange={(event) => update("hair", event.target.value as PlayerAppearance["hair"])}><option value="crop">Short crop</option><option value="bob">Bob</option><option value="topknot">Topknot</option></select></label>
        <label>Outfit<select value={draft.outfit} onChange={(event) => update("outfit", event.target.value as PlayerAppearance["outfit"])}><option value="jacket">Jacket</option><option value="apron">Apron</option><option value="haori">Haori</option></select></label>
        <label className="editor-height">Height <output>{draft.height.toFixed(2)} m</output><input aria-label="Character height" type="range" min="1.4" max="2.1" step="0.05" value={draft.height} onChange={(event) => update("height", Number(event.target.value))} /></label>
        <fieldset className="editor-accessories"><legend>Accessories</legend><label><input type="checkbox" checked={draft.glasses} onChange={(event) => update("glasses", event.target.checked)} />Glasses</label><label><input type="checkbox" checked={draft.bag} onChange={(event) => update("bag", event.target.checked)} />Shoulder bag</label></fieldset>
      </div>
      <fieldset className="editor-colors"><legend>Personal palette</legend>{colors.map(([key, label]) => <ColorControl key={key} label={label} value={draft[key]} onChange={(value) => update(key, value)} />)}</fieldset>
      </div></div>
      {validationError && <p role="alert">{validationError}</p>}
      {!connected && <p role="status">Reconnect to your room to save your character.</p>}
      <footer className="editor-actions">{joining ? <><Button type="submit" value="solo" variant="outline">Play solo</Button><Button type="submit" value="shared"><Check /> Join Kyoto</Button></> : <><Button type="button" variant="outline" onClick={() => setDraft({ ...appearance })}><RotateCcw /> Reset changes</Button><Button type="submit" disabled={!connected}><Check /> Save character</Button></>}</footer>
      <small className="editor-footnote">Your saved appearance stays on this browser for your next visit.</small>
    </form>
  </dialog>;
}


function CharacterPreview({ appearance }: { appearance: PlayerAppearance }) {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<ReturnType<typeof mountAvatarPreview> | null>(null);
  const latest = useRef(appearance);
  const [status, setStatus] = useState("Loading character…");
  useEffect(() => { latest.current = appearance; runtime.current?.setAppearance(appearance); }, [appearance]);
  useEffect(() => {
    let cancelled = false;
    import("@/lib/characters/preview").then(({ mountAvatarPreview }) => {
      if (cancelled || !host.current) return;
      runtime.current = mountAvatarPreview(host.current, latest.current, (message) => { if (!cancelled) setStatus(message); });
    }).catch(() => { if (!cancelled) setStatus("3D preview is unavailable. You can still customize your character."); });
    return () => { cancelled = true; runtime.current?.dispose(); runtime.current = null; };
  }, []);
  return <section className="editor-preview" aria-label="Character preview">
    <div ref={host} className="editor-preview-stage" role="img" aria-label="Live 3D preview of your character appearance" />
    <div className="editor-preview-status" role="status">{status}</div>
    <div className="editor-preview-actions" aria-label="Preview animations">
      {(["Idle", "Walk", "Run", "Wave", "Bow"] as const).map((clip) => <button type="button" key={clip} disabled={status !== "Character ready"} onClick={() => runtime.current?.play(clip)}>{clip}</button>)}
    </div>
  </section>;
}


function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [entry, setEntry] = useState({ text: value, source: value });
  const text = entry.source === value ? entry.text : value;
  return <label className="editor-color-control">
    <input type="color" value={value} aria-label={label} onInput={(event) => onChange(event.currentTarget.value)} onChange={(event) => onChange(event.target.value)} />
    <span>{label}</span>
    <input className="color-hex-input" type="text" aria-label={`${label} hex`} value={text} pattern="#[0-9a-fA-F]{6}" required maxLength={7} spellCheck={false} title="Use a six-digit hex colour, such as #567574" onChange={(event) => {
      const next = event.target.value;
      setEntry({ text: next, source: value });
      if (/^#[0-9a-fA-F]{6}$/.test(next)) onChange(next);
    }} />
  </label>;
}
