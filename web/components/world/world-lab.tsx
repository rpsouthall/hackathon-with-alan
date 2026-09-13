"use client";

import { useState } from "react";
import { WorldProvider, useWorld } from "./world-provider";
import { WorldViewport } from "./world-viewport";
import { createLocalTransport, createWebSocketTransport, type WorldTransport } from "@/lib/world/transport";
import { DEFAULT_ENVIRONMENT } from "@/lib/world/defaults";
import { KYOTO_ENVIRONMENT, KYOTO_NPCS } from "@/lib/world/kyoto";
import cityGameplay from "@/lib/world/data/kyoto-city-gameplay.json";
import type { Vec3 } from "@/lib/world/schema";

const shopEntries = cityGameplay.markers.filter((marker) => marker.properties.kind === "venue_entry");

export function WorldLab() {
  const [session, setSession] = useState<{ transport: WorldTransport; roomId: string; name: string } | null>(null);
  return <main style={{ position: "fixed", inset: 0, overflow: "auto", padding: 24, background: "#f7faf6", color: "#25362c", fontFamily: "sans-serif" }}>
    <h1 style={{ fontSize: 26, fontWeight: 700 }}>World integration lab</h1>
    <p>Verify movement, room membership, character reservations and speaking turns. Voice and assessment are not connected.</p>
    {!session ? <form onSubmit={(event) => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      const url = String(data.get("server") ?? "").trim();
      const fixture = String(data.get("fixture"));
      const entry = shopEntries.find((marker) => marker.name === fixture);
      const environment = entry
        ? { ...KYOTO_ENVIRONMENT, spawn: [...entry.position] as Vec3 }
        : fixture === "blockout" ? DEFAULT_ENVIRONMENT : { ...DEFAULT_ENVIRONMENT, revision: fixture, assetUrl: fixture === "valid" ? "/world-fixtures/courtyard.glb" : "/world-fixtures/missing.glb" };
      setSession({ name: String(data.get("name")), roomId: String(data.get("room")), transport: url ? createWebSocketTransport(url) : createLocalTransport({ environment, ...(entry ? { npcs: KYOTO_NPCS } : {}) }) });
    }} style={{ display: "grid", gap: 12, maxWidth: 500, marginTop: 24 }}>
      <label>Display name <input name="name" required maxLength={32} defaultValue="Learner" style={{ border: "1px solid", padding: 6 }} /></label>
      <label>Room <input name="room" required pattern="[a-zA-Z0-9_-]+" maxLength={64} defaultValue="courtyard" style={{ border: "1px solid", padding: 6 }} /></label>
      <label>WebSocket server (blank for local preview) <input name="server" placeholder="ws://127.0.0.1:8788/world" style={{ border: "1px solid", padding: 6, width: "100%" }} /></label>
      <label>Local asset check (network rooms use the server manifest) <select name="fixture" defaultValue="blockout" style={{ border: "1px solid", padding: 6 }}><option value="blockout">Default blockout</option><option value="valid">Valid GLB fixture</option><option value="missing">Missing GLB fallback</option><optgroup label="Shop entry review">{shopEntries.map((entry) => <option key={entry.name} value={entry.name}>{entry.properties.display_name} entrance</option>)}</optgroup></select></label>
      <p>Shop fixtures start at the actual doorway with city collisions and residents. Leave the server blank, then walk inside, pause, reverse through the doorway and orbit the camera to check visibility.</p>
      <button type="submit" style={{ padding: 12, background: "#285e48", color: "white" }}>Enter world</button>
    </form> : <WorldProvider transport={session.transport} roomId={session.roomId} playerName={session.name}>
      <button onClick={() => setSession(null)} style={{ marginTop: 12, textDecoration: "underline" }}>Leave room</button>
      <WorldLabSession />
    </WorldProvider>}
  </main>;
}

function WorldLabSession() {
  const { snapshot, localPlayerId, connection, mode, error, clearError, send } = useWorld();
  const active = snapshot?.encounters.find((e) => e.participantIds.includes(localPlayerId ?? ""));
  return <>
    <p role="status">{mode === "local" ? "Local preview · only you" : "Multiplayer room"} · {connection} · {snapshot?.players.length ?? 0} players</p>
    {error && <p role="alert">{error} <button onClick={clearError}>Dismiss</button></p>}
    {snapshot && <>
      <div style={{ height: 440, margin: "16px 0" }}><WorldViewport environment={snapshot.environment} players={snapshot.players} npcs={snapshot.npcs} localPlayerId={localPlayerId} inputEnabled={!active && connection === "connected"} onMove={(direction, yaw, sprint) => send({ type: "move", direction, yaw, sprint, sequence: 0 })} onEmote={(name) => send({ type: "emote", name })} onInteract={(npcId) => send({ type: "interact", npcId })} /></div>
      <p>Players: {snapshot.players.map((p) => `${p.name}${p.id === localPlayerId ? " (you)" : ""}`).join(", ")}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {snapshot.npcs.map((npc) => {
          const encounter = snapshot.encounters.find((e) => e.npcId === npc.id);
          return <button key={npc.id} disabled={!!active} onClick={() => send(encounter ? { type: "join-encounter", encounterId: encounter.id } : { type: "interact", npcId: npc.id })} style={{ border: "1px solid #819487", padding: 10, opacity: active ? 0.5 : 1 }}>{encounter ? "Join" : "Talk to"} {npc.name} · {npc.role}</button>;
        })}
      </div>
      {active && <section style={{ marginTop: 16 }}>
        <h2>Shared encounter · {active.participantIds.length} learners</h2>
        <p>Speaking turn: {snapshot.players.find((p) => p.id === active.speakerId)?.name ?? "available"}. Audio is not connected.</p>
        <button disabled={!!active.speakerId && active.speakerId !== localPlayerId} onClick={() => send({ type: active.speakerId === localPlayerId ? "release-turn" : "claim-turn", encounterId: active.id })} style={{ border: "1px solid", padding: 10 }}> {active.speakerId === localPlayerId ? "Release turn" : "Claim speaking turn"}</button>{" "}
        <button onClick={() => send({ type: "leave-encounter" })} style={{ border: "1px solid", padding: 10 }}>Leave encounter</button>
      </section>}
    </>}
  </>;
}
