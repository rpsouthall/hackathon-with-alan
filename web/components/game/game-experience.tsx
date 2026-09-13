"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, CircleStop, Headphones, Languages, Map, MicOff, RotateCcw, Sparkles, Volume2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { WorldProvider, useWorld } from "@/components/world/world-provider";
import { WorldViewport } from "@/components/world/world-viewport";
import { createWebSocketTransport, type WorldTransport } from "@/lib/world/transport";
import { distance } from "@/lib/world/room";
import { npcs, type ExperiencePhase, type NpcDefinition, type TranscriptLine } from "@/lib/game/contracts";

const encounterContent: Record<NpcDefinition["id"], { lines: TranscriptLine[]; replies: string[]; feedback: string; next: string }> = {
  cafe_owner: {
    lines: [
      { id: "1", speaker: "npc", japanese: "いらっしゃいませ。何になさいますか？", translation: "Welcome. What would you like?" },
      { id: "2", speaker: "learner", japanese: "おすすめのお茶は何ですか？", translation: "Which tea do you recommend?" },
      { id: "3", speaker: "npc", japanese: "宇治の抹茶がおすすめです。甘い物もいかがですか？", translation: "I recommend Uji matcha. Would you like something sweet as well?" },
      { id: "4", speaker: "learner", japanese: "はい、抹茶と和菓子を一つお願いします。", translation: "Yes, one matcha and one Japanese sweet, please." },
    ],
    replies: ["おすすめは何ですか？", "抹茶を一つお願いします。", "もう一度お願いします。"],
    feedback: "Your recommendation question was clear, and 「お願いします」closed the order naturally.",
    next: "Say 「和菓子を一つ」so the counter sits directly beside the item.",
  },
  local_guide: {
    lines: [
      { id: "1", speaker: "npc", japanese: "こんにちは。何かお探しですか？", translation: "Hello. Are you looking for something?" },
      { id: "2", speaker: "learner", japanese: "すみません、お寺はどこですか？", translation: "Excuse me, where is the temple?" },
      { id: "3", speaker: "npc", japanese: "この道をまっすぐ行って、橋の手前を左です。", translation: "Go straight on this road and turn left before the bridge." },
      { id: "4", speaker: "learner", japanese: "橋の手前を左ですね。ありがとうございます。", translation: "Left before the bridge, right? Thank you." },
    ],
    replies: ["お寺はどこですか？", "ここから遠いですか？", "もう一度お願いします。"],
    feedback: "You confirmed the key direction in your own words, which made the exchange clear.",
    next: "Use 「曲がる」when you repeat the route: 「橋の手前を左に曲がります」.",
  },
  shopkeeper: {
    lines: [
      { id: "1", speaker: "npc", japanese: "いらっしゃい！お土産を見ていきませんか？", translation: "Welcome! Would you like to look at some souvenirs?" },
      { id: "2", speaker: "learner", japanese: "この扇子はいくらですか？", translation: "How much is this folding fan?" },
      { id: "3", speaker: "npc", japanese: "二千円です。青と赤がありますよ。", translation: "It is 2,000 yen. We have blue and red." },
      { id: "4", speaker: "learner", japanese: "では、青い扇子をください。", translation: "Then, please give me the blue fan." },
    ],
    replies: ["これはいくらですか？", "青い物をください。", "少し考えます。"],
    feedback: "You asked the price clearly and used 「ください」naturally to make your choice.",
    next: "Attach the color directly to the item: 「青い扇子をください」.",
  },
};

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
  const [result, setResult] = useState<{ npcId: NpcDefinition["id"]; playerId: string | null } | null>(null);
  const [showTranslations, setShowTranslations] = useState(true);
  const [transcriptCount, setTranscriptCount] = useState(1);
  const active = snapshot?.encounters.find((e) => e.participantIds.includes(localPlayerId ?? ""));
  const showingResult = !!result && result.playerId === localPlayerId && connection === "connected";
  const selectedNpc = npcs.find((npc) => npc.id === (showingResult ? result.npcId : active?.npcId ?? selectedNpcId)) ?? npcs[0];
  const phase: ExperiencePhase = showingResult ? "results" : active ? "conversation" : "explore";
  const encounter = encounterContent[selectedNpc.id];
  const visibleTranscript = useMemo(() => encounter.lines.slice(0, transcriptCount), [encounter.lines, transcriptCount]);
  const localPlayer = snapshot?.players.find((p) => p.id === localPlayerId);
  const target = snapshot?.npcs.find((npc) => npc.id === selectedNpc.id);
  const inRange = !!localPlayer && !!target && distance(localPlayer.position, target.position) <= target.interactionRadius;
  const targetEncounter = snapshot?.encounters.find((e) => e.npcId === selectedNpc.id);

  function requestConversation(npcId = selectedNpc.id) {
    if (connection !== "connected" || active) return;
    const presentation = npcs.find((npc) => npc.id === npcId);
    if (!presentation) return;
    setSelectedNpcId(presentation.id); setResult(null); setTranscriptCount(1);
    const existing = snapshot?.encounters.find((e) => e.npcId === npcId);
    send(existing ? { type: "join-encounter", encounterId: existing.id } : { type: "interact", npcId });
  }
  function finishConversation() {
    if (!active) return;
    setResult({ npcId: selectedNpc.id, playerId: localPlayerId });
    send({ type: "leave-encounter" });
  }
  function returnToWorld() {
    send({ type: "leave-encounter" }); setResult(null); setTranscriptCount(1);
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
      description: "Request a nearby character encounter; room authority validates membership and distance. Voice is not connected.",
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
      name: "finish_japanese_encounter", title: "Leave encounter and preview feedback",
      description: "Leave the current encounter and show illustrative feedback. No real assessment is performed.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute() {
        if (!actions.current.active) throw new Error("No active encounter.");
        actions.current.finishConversation(); return { preview: true, score: null, npcId: actions.current.selectedNpc.id };
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
            <p>Complete three conversations on your way to the temple.</p>
            <div className="mission-progress-row"><span>0 verified encounters</span><span>Voice not connected</span></div>
            <Progress value={0} aria-label="Verified mission progress" />
            <div className="character-picker">{npcs.map((npc) => <button key={npc.id} aria-pressed={npc.id === selectedNpc.id} onClick={() => setSelectedNpcId(npc.id)}>{npc.name}</button>)}</div>
            <small>{snapshot?.players.map((p) => p.name).join(" · ")}</small>
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

      {phase === "conversation" && (
        <section className="conversation-layout" aria-label={`Conversation with ${selectedNpc.name}`}>
          <div className="conversation-focus">
            <div className="portrait" style={{ background: selectedNpc.accent }}>{selectedNpc.nameJapanese}</div>
            <div className="speaking-label">{active?.participantIds.length} learners · Voice not connected</div>
            <h1>{selectedNpc.objective}</h1>
            <p>Preview the dialogue while the voice service is being connected.</p>
          </div>
          <aside className="transcript-panel">
            <div className="panel-heading"><span><Headphones /> Sample conversation</span><span className="live-pill">PREVIEW</span></div>
            <div className="transcript-list" aria-live="polite">
              {visibleTranscript.map((line) => (
                <article key={line.id} className={`transcript-line ${line.speaker}`}>
                  <small>{line.speaker === "npc" ? selectedNpc.name : "Example learner"}</small>
                  <p lang="ja">{line.japanese}</p>
                  {showTranslations && <span>{line.translation}</span>}
                </article>
              ))}
            </div>
            <div className="reply-strip">
              <small>Explore example replies</small>
              <div>{encounter.replies.map((reply) => <Button key={reply} variant="outline" size="sm" onClick={() => setTranscriptCount((count) => Math.min(encounter.lines.length, count + 2))}>{reply}</Button>)}</div>
            </div>
            <div className="turn-controls">
              <span>Speaking turn: {snapshot?.players.find((p) => p.id === active?.speakerId)?.name ?? "available"}</span>
              <Button size="sm" variant="outline" disabled={!!active?.speakerId && active.speakerId !== localPlayerId} onClick={() => active && send({ type: active.speakerId === localPlayerId ? "release-turn" : "claim-turn", encounterId: active.id })}>{active?.speakerId === localPlayerId ? "Release turn" : "Claim turn"}</Button>
            </div>
            <div className="conversation-controls">
              <Button variant="outline" size="icon" disabled aria-label="Microphone unavailable until voice is connected"><MicOff /></Button>
              <div className="voice-state"><Volume2 /><span><strong>Microphone off</strong><small>GPT-Live connection placeholder</small></span></div>
              <Button variant="destructive" onClick={finishConversation}><CircleStop /> Finish</Button>
            </div>
          </aside>
        </section>
      )}

      {phase === "results" && (
        <section className="results-overlay" aria-label="Conversation feedback">
          <div className="results-card">
            <div className="results-heading">
              <span className="result-icon"><Sparkles /></span>
              <div><small>Example feedback · not your score</small><h1>Feedback preview</h1><p>This illustrates the future assessment for the {selectedNpc.role.toLowerCase()} challenge.</p></div>
              <div className="score-ring"><strong>84</strong><span>/ 100</span></div>
            </div>
            <div className="score-grid">
              {[["Task completion", 92], ["Comprehension", 86], ["Grammar", 78], ["Politeness", 82]].map(([label, value]) => (
                <div key={label as string}><span>{label}<strong>{value}</strong></span><Progress value={value as number} /></div>
              ))}
            </div>
            <div className="feedback-grid">
              <article className="feedback-good"><small>Example strength</small><h2>You kept the exchange moving.</h2><p>{encounter.feedback}</p></article>
              <article className="feedback-next"><small>Example suggestion</small><h2>Make one phrase more natural.</h2><p>{encounter.next}</p></article>
            </div>
            <div className="results-actions">
              <Button variant="outline" disabled={!!active || connection !== "connected"} onClick={() => requestConversation()}><RotateCcw /> Try again</Button>
              <Button onClick={returnToWorld}>Continue exploring <ChevronRight /></Button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
