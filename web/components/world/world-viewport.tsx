"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EnvironmentManifest, PlayerSnapshot, NpcSnapshot, EncounterSnapshot } from "@/lib/world/schema";
import type { mountWorldScene } from "@/lib/world/scene";
import type { CameraView } from "@/lib/world/camera-rig";

export interface WorldViewportProps {
  environment: EnvironmentManifest;
  players: PlayerSnapshot[];
  npcs: NpcSnapshot[];
  localPlayerId: string | null;
  encounters?: EncounterSnapshot[];
  selectedNpcId?: string;
  onMove: (direction: [number, number], yaw: number) => void;
  onInteract: (npcId: string) => void;
  inputEnabled?: boolean;
  className?: string;
}

export function WorldViewport(props: WorldViewportProps) {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<ReturnType<typeof mountWorldScene> | null>(null);
  const latest = useRef(props);
  const [status, setStatus] = useState({ phase: "loading", error: "" });
  const [overview, setOverview] = useState(false);
  const [view, setView] = useState<CameraView>("isometric");
  const cameraState = useRef({ view, overview });
  const toggleView = useCallback(() => {
    const next: CameraView = cameraState.current.view === "isometric" ? "third-person" : "isometric";
    cameraState.current = { view: next, overview: false };
    setView(next); setOverview(false); runtime.current?.setView(next); host.current?.focus();
  }, []);
  function toggleOverview() {
    const next = !cameraState.current.overview;
    cameraState.current.overview = next;
    setOverview(next); runtime.current?.setOverview(next); host.current?.focus();
  }
  // Snapshot objects change on network updates; reload only when the manifest changes.
  const manifest = JSON.stringify(props.environment);
  useEffect(() => {
    latest.current = props;
    runtime.current?.update(props, props.inputEnabled !== false);
  }, [props]);
  useEffect(() => {
    let cancelled = false;
    let mounted: ReturnType<typeof mountWorldScene> | null = null;
    import("@/lib/world/scene").then(({ mountWorldScene }) => {
      if (cancelled || !host.current) return;
      mounted = mountWorldScene(host.current, JSON.parse(manifest), {
        onMove: (direction, yaw) => latest.current.onMove(direction, yaw),
        onInteract: (id) => latest.current.onInteract(id),
        onStatus: (phase, error = "") => { if (!cancelled) setStatus({ phase, error }); },
        onToggleView: toggleView,
      });
      runtime.current = mounted;
      mounted.update(latest.current, latest.current.inputEnabled !== false);
      mounted.setView(cameraState.current.view);
      if (cameraState.current.overview) mounted.setOverview(true);
    }).catch(() => { if (!cancelled) setStatus({ phase: "unavailable", error: "3D rendering is unavailable on this device. You can still use the character list." }); });
    return () => { cancelled = true; mounted?.dispose(); runtime.current = null; };
  }, [manifest, toggleView]);
  return <div className={props.className} style={{ position: "relative", minHeight: 320, height: "100%" }}>
    <div ref={host} tabIndex={0} role="application" aria-label="3D world. Focus here and use WASD or arrow keys to walk. Press V to change camera view. Press E near a character to interact." style={{ position: "absolute", inset: 0, outlineOffset: -3 }} />
    <nav aria-label="Walking controls" style={{ position: "absolute", right: 16, top: "45%", display: "grid", gridTemplateColumns: "repeat(3, 32px)", gap: 3 }}>
      {([{ label: "Move forward", direction: [0, -1], symbol: "↑", column: 2 }, { label: "Move left", direction: [-1, 0], symbol: "←", column: 1 }, { label: "Move backward", direction: [0, 1], symbol: "↓", column: 2 }, { label: "Move right", direction: [1, 0], symbol: "→", column: 3 }] as const).map((control, index) => <button key={control.label} type="button" aria-label={control.label} disabled={props.inputEnabled === false} onClick={() => runtime.current?.step([...control.direction])} style={{ gridColumn: control.column, gridRow: index === 0 ? 1 : 2, height: 32, color: "#203c30", background: "#ffffffe8", borderRadius: 6, border: "1px solid #849c8d" }}>{control.symbol}</button>)}
    </nav>
    <nav className="world-camera-controls" aria-label="Camera controls" data-view={overview ? "overview" : view}>
      <button type="button" disabled={props.inputEnabled === false} onClick={toggleView}
        aria-label={view === "isometric" ? "Switch to third-person view" : "Switch to isometric view"} aria-keyshortcuts="V" title="Change camera view (V)">
        <span aria-hidden="true">{view === "isometric" ? "◉" : "◇"}</span> {view === "isometric" ? "Third person" : "Isometric"} <kbd>V</kbd>
      </button>
      <button type="button" disabled={props.inputEnabled === false} onClick={toggleOverview}>{overview ? "Follow player" : "View town"}</button>
    </nav>
    <div role="status" style={{ position: "absolute", top: 12, left: 12, maxWidth: "90%", padding: "6px 10px", background: "#ffffffed", color: "#26372d", borderRadius: 8, fontSize: 12, pointerEvents: "none" }}>
      {status.error || (status.phase === "loading" ? "Loading environment…" : `${overview ? "Town overview" : view === "isometric" ? "Isometric" : "Third person · 360°"} · ${view === "third-person" && !overview ? "Drag to look around" : "Right drag to rotate"} · Scroll to zoom`)}
      {status.phase === "fallback" && <button type="button" onClick={() => runtime.current?.retryEnvironment()} style={{pointerEvents: "auto", marginLeft: 10, padding: "5px 9px", border: "1px solid #849c8d", borderRadius: 5, background: "#fff9e8", color: "#26372d", cursor: "pointer"}}>Retry loading Kyoto</button>}
    </div>
  </div>;
}
