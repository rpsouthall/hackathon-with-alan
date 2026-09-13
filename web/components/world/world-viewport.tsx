"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EnvironmentManifest, PlayerSnapshot, NpcSnapshot, EncounterSnapshot, VehicleSnapshot } from "@/lib/world/schema";
import type { mountWorldScene } from "@/lib/world/scene";
import type { CameraView } from "@/lib/world/camera-rig";
import type { EmoteName } from "@/lib/world/player-actions";
import { EmoteWheel } from "./emote-wheel";
import { AtmosphereControls } from "./atmosphere-controls";
import { INITIAL_HOUR, type WorldTime } from "@/lib/world/day-cycle";
import { useWorld } from "./world-provider";
import { VehicleControls } from "./vehicle-controls";
import { getVehicleControlState } from "./vehicle-controls-state";

const EMPTY_VEHICLES: VehicleSnapshot[] = [];

export interface WorldViewportProps {
  speakingPlayerIds?: readonly string[];
  speakingNpcIds?: readonly string[];
  environment: EnvironmentManifest;
  players: PlayerSnapshot[];
  npcs: NpcSnapshot[];
  vehicles?: VehicleSnapshot[];
  localPlayerId: string | null;
  encounters?: EncounterSnapshot[];
  selectedNpcId?: string;
  onMove: (direction: [number, number], yaw: number, sprint?: boolean) => number | void;
  onEmote: (name: EmoteName) => void;
  onInteract: (npcId: string) => void;
  inputEnabled?: boolean;
  className?: string;
}

export function WorldViewport(props: WorldViewportProps) {
  const { snapshot, worldClock, send } = useWorld();
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<ReturnType<typeof mountWorldScene> | null>(null);
  const vehicles = props.vehicles ?? snapshot?.vehicles ?? EMPTY_VEHICLES;
  const encounters = props.encounters ?? snapshot?.encounters;
  const localPlayer = props.players.find((player) => player.id === props.localPlayerId);
  const blocked = props.inputEnabled === false || !!encounters?.some((encounter) => encounter.participantIds.includes(props.localPlayerId ?? ""));
  const mountedVehicle = !!localPlayer?.vehicleId;
  const sceneState = useMemo(() => ({ ...props, vehicles, encounters, worldClock, inputEnabled: !blocked }), [props, vehicles, encounters, worldClock, blocked]);
  const latest = useRef(sceneState);
  const [emoteOwner, setEmoteOwner] = useState<string | null>(null);
  const emotesOpen = !!emoteOwner && emoteOwner === props.localPlayerId && !blocked && !mountedVehicle;
  const openEmotes = useCallback(() => {
    const player = latest.current.players.find((candidate) => candidate.id === latest.current.localPlayerId);
    if (latest.current.inputEnabled === false || player?.vehicleId) return;
    runtime.current?.update(latest.current, false);
    host.current?.focus(); setEmoteOwner(latest.current.localPlayerId);
  }, []);
  function closeEmotes() {
    setEmoteOwner(null);
    runtime.current?.update(latest.current, latest.current.inputEnabled !== false);
    host.current?.focus();
  }
  function chooseEmote(name: EmoteName) {
    closeEmotes();
    const player = latest.current.players.find((candidate) => candidate.id === latest.current.localPlayerId);
    if (latest.current.inputEnabled !== false && !player?.vehicleId) latest.current.onEmote(name);
  }
  const mountVehicle = useCallback((vehicleId: string) => {
    const state = latest.current;
    const player = state.players.find((candidate) => candidate.id === state.localPlayerId);
    const available = getVehicleControlState(player, state.vehicles.filter((vehicle) => vehicle.id === vehicleId), !state.inputEnabled);
    if (available?.mode !== "available") return;
    setEmoteOwner(null); send({ type: "mount-vehicle", vehicleId }); host.current?.focus();
  }, [send]);
  const dismountVehicle = useCallback(() => {
    const state = latest.current;
    const player = state.players.find((candidate) => candidate.id === state.localPlayerId);
    if (!state.inputEnabled || !player?.vehicleId) return;
    send({ type: "dismount-vehicle" }); host.current?.focus();
  }, [send]);
  const [status, setStatus] = useState({ phase: "loading", error: "" });
  const [time, setTime] = useState<WorldTime>({ hours: INITIAL_HOUR, playing: true, source: "local" });
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
    latest.current = sceneState;
    runtime.current?.update(sceneState, !blocked && !emotesOpen);
  }, [sceneState, blocked, emotesOpen]);
  useEffect(() => {
    let cancelled = false;
    let mounted: ReturnType<typeof mountWorldScene> | null = null;
    import("@/lib/world/scene").then(({ mountWorldScene }) => {
      if (cancelled || !host.current) return;
      mounted = mountWorldScene(host.current, JSON.parse(manifest), {
        onMove: (direction, yaw, sprint) => latest.current.onMove(direction, yaw, sprint),
        onInteract: (id) => latest.current.onInteract(id),
        onStatus: (phase, error = "") => { if (!cancelled) setStatus({ phase, error }); },
        onToggleView: toggleView,
        onOpenEmotes: openEmotes,
        onTime: (next) => { if (!cancelled) setTime(next); },
        onMountVehicle: mountVehicle,
        onDismountVehicle: dismountVehicle,
      });
      runtime.current = mounted;
      mounted.update(latest.current, latest.current.inputEnabled !== false);
      mounted.setView(cameraState.current.view);
      if (cameraState.current.overview) mounted.setOverview(true);
    }).catch(() => { if (!cancelled) setStatus({ phase: "unavailable", error: "3D rendering is unavailable on this device. You can still use the character list." }); });
    return () => { cancelled = true; mounted?.dispose(); runtime.current = null; };
  }, [manifest, toggleView, openEmotes, mountVehicle, dismountVehicle]);
  return <div className={props.className} style={{ position: "relative", minHeight: 320, height: "100%" }}>
    <div ref={host} tabIndex={0} role="application" aria-label="3D world. WASD or arrow keys to walk or ride. Hold Shift to sprint on foot. Press F to mount or dismount a vehicle, G for emotes, V to change view, E to interact." style={{ position: "absolute", inset: 0, outlineOffset: -3 }} />
    <AtmosphereControls time={time} onHour={(hours, animate) => runtime.current?.setHour(hours, animate)} onPlaying={playing => runtime.current?.setTimePlaying(playing)} onSharedTime={() => runtime.current?.returnToSharedTime()} />
    <nav aria-label="Walking controls" style={{ position: "absolute", right: 16, top: "45%", display: "grid", gridTemplateColumns: "repeat(3, 32px)", gap: 3 }}>
      {([{ label: "Move forward", direction: [0, -1], symbol: "↑", column: 2 }, { label: "Move left", direction: [-1, 0], symbol: "←", column: 1 }, { label: "Move backward", direction: [0, 1], symbol: "↓", column: 2 }, { label: "Move right", direction: [1, 0], symbol: "→", column: 3 }] as const).map((control, index) => <button key={control.label} type="button" aria-label={control.label} disabled={blocked || emotesOpen} onClick={(event) => runtime.current?.step([...control.direction], event.shiftKey)} style={{ gridColumn: control.column, gridRow: index === 0 ? 1 : 2, height: 32, color: "#203c30", background: "#ffffffe8", borderRadius: 6, border: "1px solid #849c8d" }}>{control.symbol}</button>)}
    </nav>
    <nav className="world-camera-controls" aria-label="View and character controls" data-view={overview ? "overview" : view}>
      <button type="button" disabled={blocked || emotesOpen} onClick={toggleView}
        aria-label={view === "isometric" ? "Switch to third-person view" : "Switch to isometric view"} aria-keyshortcuts="V" title="Change camera view (V)">
        <span aria-hidden="true">{view === "isometric" ? "◉" : "◇"}</span> {view === "isometric" ? "Third person" : "Isometric"} <kbd>V</kbd>
      </button>
      <button type="button" disabled={blocked || emotesOpen} onClick={toggleOverview}>{overview ? "Follow player" : "View town"}</button>
      <button type="button" disabled={blocked || mountedVehicle || emotesOpen} onClick={openEmotes} aria-label={mountedVehicle ? "Dismount to use emotes" : "Open emote wheel"} aria-haspopup="dialog" aria-keyshortcuts="G"><span aria-hidden="true">✧</span> Emotes <kbd>G</kbd></button>
    </nav>
    <div role="status" data-world-ready={!status.error && status.phase !== "loading"} style={{ position: "absolute", top: 12, left: 12, maxWidth: "90%", padding: "6px 10px", background: "#ffffffed", color: "#26372d", borderRadius: 8, fontSize: 12, pointerEvents: "none" }}>
      {status.error || (status.phase === "loading" ? "Loading environment…" : `${overview ? "Town overview" : view === "isometric" ? "Isometric" : "Third person · 360°"} · ${view === "third-person" && !overview ? "Drag to look around" : "Right drag to rotate"} · Scroll to zoom`)}
      {status.phase === "fallback" && <button type="button" onClick={() => runtime.current?.retryEnvironment()} style={{ pointerEvents: "auto", marginLeft: 10, padding: "5px 9px", border: "1px solid #849c8d", borderRadius: 5, background: "#fff9e8", color: "#26372d", cursor: "pointer" }}>Retry loading Kyoto</button>}
    </div>
    <VehicleControls state={getVehicleControlState(localPlayer, vehicles, blocked || emotesOpen)} onMount={mountVehicle} onDismount={dismountVehicle} />
    {emotesOpen && !blocked && <EmoteWheel onChoose={chooseEmote} onClose={closeEmotes} />}
  </div>;
}
