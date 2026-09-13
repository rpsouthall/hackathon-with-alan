"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Languages, Map, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LessonDialogue } from "@/components/lesson/lesson-dialogue";
import { Progress } from "@/components/ui/progress";
import { WorldProvider, useWorld } from "@/components/world/world-provider";
import { WorldViewport } from "@/components/world/world-viewport";
import { createWebSocketTransport, type WorldTransport } from "@/lib/world/transport";
import { distance } from "@/lib/world/room";
import { npcs, type ExperiencePhase, type NpcDefinition } from "@/lib/game/contracts";

export function GameExperience() {
  const [session, setSession] = useState<{ transport?: WorldTransport; roomId: string; name: string }>({ roomId: "courtyard", name: "Learner" });
  const [showRoom, setShowRoom] = useState(false);
  return <WorldProvider transport={session.transport} roomId={session.roomId} playerName={session.name}>
    <GameSession onRoomSettings={() => setShowRoom(true)} />
    {showRoom && <section className="results-overlay room-settings" role="dialog" aria-modal="true" aria-label="Room settings">
      <form className="results-card room-form" onSubmit={(event) => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        const url = String(data.get("server")).trim();
        setSession({ name: String(data.get("name")), roomId: String(data.get("room")), transport: url ? createWebSocketTransport(url) : undefined });
        setShowRoom(false);
      }}>
        <h1>Learn together</h1>
        <p>Use the same room and server as your friends. Leave the server blank for a private local preview.</p>
        <label>Your name<input name="name" defaultValue={session.name} required maxLength={32} autoFocus /></label>
        <label>Room name<input name="room" defaultValue={session.roomId} required pattern="[a-zA-Z0-9_-]+" maxLength={64} /></label>
        <label>Multiplayer server<input name="server" placeholder="wss://your-room-server/world" /></label>
        <div className="results-actions"><Button type="button" variant="outline" onClick={() => setShowRoom(false)}>Cancel</Button><Button type="submit">Join room</Button></div>
      </form>
    </section>}
  </WorldProvider>;
}

function GameSession({ onRoomSettings }: { onRoomSettings: () => void }) {
  const { snapshot, localPlayerId, connection, mode, error, clearError, send } = useWorld();
  const [selectedNpcId, setSelectedNpcId] = useState<NpcDefinition["id"]>(npcs[0].id);
  const [showTranslations, setShowTranslations] = useState(true);
  const active = snapshot?.encounters.find((e) => e.participantIds.includes(localPlayerId ?? ""));
  const selectedNpc = npcs.find((npc) => npc.id === (active?.npcId ?? selectedNpcId)) ?? npcs[0];
  const phase: ExperiencePhase = active ? "conversation" : "explore";
  const localPlayer = snapshot?.players.find((p) => p.id === localPlayerId);
  const target = snapshot?.npcs.find((npc) => npc.id === selectedNpc.id);
  const inRange = !!localPlayer && !!target && distance(localPlayer.position, target.position) <= target.interactionRadius;
  const targetEncounter = snapshot?.encounters.find((e) => e.npcId === selectedNpc.id);

  function requestConversation(npcId = selectedNpc.id) {
    if (connection !== "connected" || active) return;
    const presentation = npcs.find((npc) => npc.id === npcId);
    if (!presentation) return;
    setSelectedNpcId(presentation.id);
    const existing = snapshot?.encounters.find((e) => e.npcId === npcId);
    send(existing ? { type: "join-encounter", encounterId: existing.id } : { type: "interact", npcId });
  }
  function finishConversation() {
    if (!active) return;
    send({ type: "leave-encounter" });
  }
  function returnToWorld() {
    send({ type: "leave-encounter" });
  }
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code === "Escape" && active) send({ type: "leave-encounter" });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, send]);

  const actions = useRef({ requestConversation, finishConversation, active, connection, selectedNpc });
  useEffect(() => { actions.current = { requestConversation, finishConversation, active, connection, selectedNpc }; });

  useEffect(() => {
    type ToolRegistration = { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => unknown };
    type ModelContext = { registerTool: (tool: ToolRegistration, options?: { signal?: AbortSignal }) => void | Promise<void> };
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const report = (error: unknown) => console.warn("WebMCP registration failed", error);
    void Promise.resolve(context.registerTool({
      name: "start_japanese_encounter", title: "Request Japanese encounter",
      description: "Request a nearby character encounter; room authority validates membership and distance. Opens the guided Japanese lesson for that character.",
      inputSchema: { type: "object", properties: { npcId: { type: "string", enum: npcs.map((npc) => npc.id) } }, required: ["npcId"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const id = typeof input === "object" && input !== null ? (input as { npcId?: unknown }).npcId : undefined;
        const npc = npcs.find((candidate) => candidate.id === id);
        if (!npc || actions.current.connection !== "connected" || actions.current.active) throw new Error("Connect and leave any current encounter before requesting a valid character.");
        actions.current.requestConversation(npc.id);
        return { requested: true, npcId: npc.id, confirmed: false };
      },
    }, { signal: lifecycle.signal })).catch(report);
    void Promise.resolve(context.registerTool({
      name: "finish_japanese_encounter", title: "Leave Japanese encounter",
      description: "Leave the current encounter and close its lesson and voice connection.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute() {
        if (!actions.current.active) throw new Error("No active encounter.");
        actions.current.finishConversation(); return { left: true, npcId: actions.current.selectedNpc.id };
      },
    }, { signal: lifecycle.signal })).catch(report);
    return () => lifecycle.abort();
  }, []);

  return (
    <main className="game-shell">
      <section className="world-stage" aria-label={`${snapshot?.environment.name ?? "World"} interactive preview`}>
        {snapshot && <WorldViewport environment={snapshot.environment} players={snapshot.players} npcs={snapshot.npcs} localPlayerId={localPlayerId}
          inputEnabled={phase === "explore" && connection === "connected"}
          onMove={(direction, yaw) => send({ type: "move", direction, yaw, sequence: 0 })}
          onInteract={(npcId) => requestConversation(npcId as NpcDefinition["id"])} />}
      </section>
      {error && <div className="world-error" role="alert">{error} <button onClick={clearError}>Dismiss</button></div>}

      <header className="topbar">
        <div className="brand-lockup" aria-label="Kyoto Conversations">
          <span className="brand-mark" aria-hidden="true">京</span>
          <span><strong>Kyoto Conversations</strong><small>京都で話そう</small></span>
        </div>
        <div className="session-status"><span className="status-light" />{mode === "local" ? "Local preview" : "Multiplayer"} · {connection} · {snapshot?.players.length ?? 0} players</div>
        <Button variant="ghost" size="sm" className="hud-button" onClick={() => setShowTranslations((value) => !value)}>
          <Languages /> {showTranslations ? "Hide English" : "Show English"}
        </Button>
        <Button className="room-button" variant="outline" size="sm" onClick={onRoomSettings}><Users /> Room</Button>
      </header>

      {phase === "explore" && (
        <>
          <aside className="mission-card" aria-label="Current mission">
            <div className="eyebrow"><Map /> Current mission</div>
            <h1>A quiet afternoon in Kyoto</h1>
            <p>Practise at the coffee shop, fruit market, and restaurant.</p>
            <div className="mission-progress-row"><span>3 guided scenarios</span><span>10 questions each</span></div>
            <Progress value={0} aria-label="Verified mission progress" />
            <div className="character-picker">{npcs.map((npc) => <button key={npc.id} aria-pressed={npc.id === selectedNpc.id} onClick={() => setSelectedNpcId(npc.id)}>{npc.name}</button>)}</div>
            <small>{snapshot?.players.map((p) => p.name).join(" · ")}</small>
            <Link className="environment-preview-link" href="/environments">Explore the conversation settings <ChevronRight size={14} /></Link>
          </aside>

          <aside className="location-card" aria-label="Selected character">
            <span className="npc-monogram" style={{ background: selectedNpc.accent }}>{selectedNpc.nameJapanese}</span>
            <div><small>{selectedNpc.role} · {selectedNpc.level}</small><h2>{selectedNpc.name}</h2><p>{selectedNpc.objective}</p></div>
          </aside>

          <div className="interaction-prompt">
            <span className="keycap">E</span>
            <span><small>Talk to</small>{selectedNpc.name}</span>
            <Button size="sm" disabled={!inRange || connection !== "connected"} onClick={() => requestConversation()}>{inRange ? targetEncounter ? "Join encounter" : "Start encounter" : "Walk closer"} <ChevronRight /></Button>
          </div>
          <div className="movement-hint"><span>W A S D</span> Move <span>E</span> Talk nearby · Click the world to focus</div>
        </>
      )}

      {phase === "conversation" && <LessonDialogue key={active?.id} npcId={selectedNpc.id} allowLive={mode === "local"} onClose={returnToWorld} />}
    </main>
  );
}
