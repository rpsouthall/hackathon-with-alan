"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Image from 'next/image';
import { ChevronRight, CircleStop, Headphones, Languages, Map, MicOff, RotateCcw, Sparkles, Volume2, Users, Shirt, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LessonDialogue } from "@/components/lesson/lesson-dialogue";
import { lessonNpcForWorldNpc } from "@/lib/lesson/world-lessons";
import { lessonCharacterForWorldNpc } from "@/lib/lesson/characters";
import { CharacterEditor, type CharacterJoinSettings } from "@/components/game/character-editor";
import { appearanceSchema, type PlayerAppearance } from "@/lib/world/schema";
import { WorldProvider, useWorld } from "@/components/world/world-provider";
import { WorldViewport } from "@/components/world/world-viewport";
import { KYOTO_ENVIRONMENT, KYOTO_NPCS } from "@/lib/world/kyoto";
import { createLocalTransport, createWebSocketTransport, type WorldTransport } from "@/lib/world/transport";
import { distance } from "@/lib/world/room";
import { npcs, npcPresentation, type ExperiencePhase, type NpcDefinition, type TranscriptLine } from "@/lib/game/contracts";

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
  inn_host: {
    lines: [
      { id: "1", speaker: "npc", japanese: "ようこそ。ご予約のお名前をお願いします。", translation: "Welcome. May I have the name on your reservation?" },
      { id: "2", speaker: "learner", japanese: "田中です。一泊で予約しています。", translation: "It is Tanaka. I have a reservation for one night." },
      { id: "3", speaker: "npc", japanese: "ありがとうございます。朝食は七時からです。", translation: "Thank you. Breakfast starts at seven." },
      { id: "4", speaker: "learner", japanese: "朝食はどこで食べられますか？", translation: "Where can I have breakfast?" },
    ],
    replies: ["予約しています。", "朝食は何時からですか？", "もう一度お願いします。"],
    feedback: "The example learner introduces their reservation clearly and asks a useful follow-up question.",
    next: "Try introducing your reservation with 「一泊で予約しています」.",
  },
  greeting: {
    lines: [
      { id: "1", speaker: "npc", japanese: "こんにちは。京都へようこそ。", translation: "Hello. Welcome to Kyoto." },
      { id: "2", speaker: "learner", japanese: "こんにちは。日本語を勉強しています。", translation: "Hello. I am studying Japanese." },
      { id: "3", speaker: "npc", japanese: "そうですか。今日はどちらへ行きますか？", translation: "I see. Where are you going today?" },
      { id: "4", speaker: "learner", japanese: "町を散歩したいです。おすすめはありますか？", translation: "I would like to walk around town. Do you have any recommendations?" },
    ],
    replies: ["日本語を勉強しています。", "おすすめはありますか？", "ゆっくり話してください。"],
    feedback: "The example learner introduces themselves and keeps the exchange going with a question.",
    next: "Use 「ゆっくり話してください」to ask someone to speak more slowly.",
  },
};

const APPEARANCE_STORAGE_KEY = "kyoto-character-appearance-v1";
type SessionSettings = { transport?: WorldTransport; roomId: string; name: string; serverUrl: string; appearance?: PlayerAppearance };

export function GameExperience() {
  const [session, setSession] = useState<SessionSettings | null>(null);
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const localTransport = useMemo(() => createLocalTransport({ environment: KYOTO_ENVIRONMENT, npcs: KYOTO_NPCS }), []);
  function join(next: Omit<SessionSettings, "transport">) {
    setSession({ ...next, transport: next.serverUrl ? createWebSocketTransport(next.serverUrl) : undefined });
  }
  if (!session) return <main className="game-shell iso-game-shell welcome-stage" aria-label="Welcome to Kyoto Conversations">
    <div className="welcome-wordmark" aria-hidden="true">京都で話そう<small>Kyoto Conversations</small></div>
    {hydrated ? <WelcomeCreator onJoin={join} /> : <p role="status">Preparing your traveller…</p>}
  </main>;
  return <WorldProvider transport={session.transport ?? localTransport} roomId={session.roomId} playerName={session.name}>
    <GameSession session={session} onJoin={join} />
  </WorldProvider>;
}

function subscribeToHydration() { return () => {}; }
function WelcomeCreator({ onJoin }: { onJoin: (settings: CharacterJoinSettings) => void }) {
  const [welcome] = useState<CharacterJoinSettings>(() => {
    let appearance = appearanceSchema.parse({});
    try {
      const saved = localStorage.getItem(APPEARANCE_STORAGE_KEY);
      const parsed = saved ? appearanceSchema.safeParse(JSON.parse(saved)) : null;
      if (parsed?.success) appearance = parsed.data;
    } catch { /* Local storage is optional. */ }
    const configuredServer = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_WORLD_SERVER_URL?.trim();
    const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
    return { name: "Learner", roomId: "kyoto", appearance, serverUrl: configuredServer ?? (localHost ? "ws://127.0.0.1:8788/world" : "") };
  });
  return <CharacterEditor appearance={welcome.appearance} connected onSave={() => {}} joining={{ defaults: welcome, onJoin }} />;
}

function RoomSettings({ session, onJoin, onClose }: {
  session: SessionSettings; onJoin: (session: Omit<SessionSettings, "transport">) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  return <dialog ref={dialog} className="room-dialog" aria-labelledby="room-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <form className="room-form" onSubmit={(event) => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      onJoin({ name: String(data.get("name")).trim(), roomId: String(data.get("room")).trim(), serverUrl: String(data.get("server")).trim() });
      onClose();
    }}>
      <div className="editor-heading"><div><small>Share the same streets</small><h1 id="room-title">Learn together</h1></div><Button type="button" variant="ghost" size="icon" aria-label="Close room settings" onClick={onClose}><X /></Button></div>
      <p>Use the same room and server as your friends. Leave the server blank to explore on your own.</p>
      <label>Your name<input name="name" defaultValue={session.name} required maxLength={32} autoFocus /></label>
      <label>Room name<input name="room" defaultValue={session.roomId} required pattern="[a-zA-Z0-9_-]+" maxLength={64} /></label>
      <label>Multiplayer server<input name="server" defaultValue={session.serverUrl} placeholder="wss://your-room-server/world" /></label>
      <div className="editor-actions"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit">Join room</Button></div>
    </form>
  </dialog>;
}

function GameSession({ session, onJoin }: { session: SessionSettings; onJoin: (session: Omit<SessionSettings, "transport">) => void }) {
  const { snapshot, localPlayerId, connection, mode, error, clearError, send } = useWorld();
  const [showRoom, setShowRoom] = useState(false);
  const [showCharacter, setShowCharacter] = useState(false);
  const [showCast, setShowCast] = useState(true);
  const [walkingRequest, setWalkingRequest] = useState<{ npcId: string; sequence: number } | null>(null);
  const [walking, setWalking] = useState(false);
  const [walkingNotice, setWalkingNotice] = useState('');
  const [appearanceNotice, setAppearanceNotice] = useState("");
  const restoredFor = useRef<string | null>(null);
  const preferredAppearance = useRef<PlayerAppearance | undefined>(session.appearance);
  const pendingAppearance = useRef<PlayerAppearance | null>(null);
  const [selectedNpcId, setSelectedNpcId] = useState<NpcDefinition["id"]>(npcs[0].id);
  const [result, setResult] = useState<{ npcId: string; playerId: string | null } | null>(null);
  const [transcriptCount, setTranscriptCount] = useState(1);
  const [showTranslations, setShowTranslations] = useState(true);
  const active = snapshot?.encounters.find((e) => e.participantIds.includes(localPlayerId ?? ""));
  const showingResult = !!result && result.playerId === localPlayerId && connection === "connected";
  const cast = snapshot?.npcs.map(npcPresentation) ?? [];
  const selectedNpc = cast.find((npc) => npc.id === (showingResult ? result.npcId : active?.npcId ?? selectedNpcId)) ?? cast[0] ?? npcs[0];
  const phase: ExperiencePhase = showingResult ? "results" : active ? "conversation" : "explore";
  const lessonNpcId = lessonNpcForWorldNpc(selectedNpc.id);
  const liveCharacter = lessonCharacterForWorldNpc(selectedNpc.id);
  const encounter = encounterContent[selectedNpc.id] ?? encounterContent.greeting;
  const visibleTranscript = useMemo(() => encounter.lines.slice(0, transcriptCount), [encounter.lines, transcriptCount]);
  const localPlayer = snapshot?.players.find((p) => p.id === localPlayerId);
  const target = snapshot?.npcs.find((npc) => npc.id === selectedNpc.id);
  const targetDistance = localPlayer && target ? distance(localPlayer.position, target.position) : null;
  const inRange = targetDistance !== null && !!target && targetDistance <= target.interactionRadius;
  const closest = snapshot?.npcs.filter((npc) => localPlayer && distance(localPlayer.position, npc.position) <= npc.interactionRadius).sort((a, b) => distance(localPlayer!.position, a.position) - distance(localPlayer!.position, b.position))[0];
  const targetEncounter = snapshot?.encounters.find((e) => e.npcId === selectedNpc.id);

  function requestConversation(npcId = selectedNpc.id) {
    if (connection !== "connected" || active) return;
    const presentation = cast.find((npc) => npc.id === npcId);
    if (!presentation) return;
    setSelectedNpcId(presentation.id);
    setTranscriptCount(1);
    setResult(null);
    const existing = snapshot?.encounters.find((e) => e.npcId === npcId);
    send(existing ? { type: "join-encounter", encounterId: existing.id } : { type: "interact", npcId });
  }
  function finishConversation() {
    if (!active) return;
    if (!lessonNpcId) setResult({ npcId: active.npcId, playerId: localPlayerId });
    send({ type: "leave-encounter" });
  }
  function returnToWorld() {
    setResult(null);
    send({ type: "leave-encounter" });
  }
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code === "Escape" && active && !showCharacter && !showRoom) send({ type: "leave-encounter" });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, send, showCharacter, showRoom]);

  useEffect(() => {
    if (connection !== "connected" || !localPlayerId || !localPlayer) return;
    if (restoredFor.current !== localPlayerId) {
      restoredFor.current = localPlayerId;
      pendingAppearance.current = null;
      let appearance = preferredAppearance.current;
      if (!appearance) try {
        const stored = localStorage.getItem(APPEARANCE_STORAGE_KEY);
        const saved = stored ? appearanceSchema.safeParse(JSON.parse(stored)) : null;
        if (saved?.success) appearance = saved.data;
      } catch { /* Storage may be disabled; the character still works for this visit. */ }
      if (appearance) { pendingAppearance.current = appearance; send({ type: "set-appearance", appearance }); }
    }
    if (pendingAppearance.current && JSON.stringify(localPlayer.appearance) === JSON.stringify(pendingAppearance.current)) {
      try { localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(localPlayer.appearance)); }
      catch { /* The server has accepted this appearance even without persistence. */ }
      preferredAppearance.current = pendingAppearance.current;
      pendingAppearance.current = null;
      setAppearanceNotice("Your character is updated.");
    }
  }, [connection, localPlayerId, localPlayer, send]);

  function saveAppearance(appearance: PlayerAppearance) {
    if (connection !== "connected" || !localPlayer) return;
    if (JSON.stringify(localPlayer.appearance) === JSON.stringify(appearance)) {
      try { localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance)); } catch { /* Appearance is already accepted by the room. */ }
      preferredAppearance.current = appearance;
      setAppearanceNotice("Your character is updated.");
      setShowCharacter(false);
      return;
    }
    pendingAppearance.current = appearance;
    setAppearanceNotice("Saving your character…");
    send({ type: "set-appearance", appearance });
    setShowCharacter(false);
  }

  const actions = useRef({ requestConversation, finishConversation, active, connection, selectedNpc, cast });
  useEffect(() => { actions.current = { requestConversation, finishConversation, active, connection, selectedNpc, cast }; });

  useEffect(() => {
    type ToolRegistration = { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => unknown };
    type ModelContext = { registerTool: (tool: ToolRegistration, options?: { signal?: AbortSignal }) => void | Promise<void> };
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const report = (error: unknown) => console.warn("WebMCP registration failed", error);
    void Promise.resolve(context.registerTool({
      name: "start_japanese_encounter", title: "Request Japanese encounter",
      description: "Request a nearby character encounter; room authority validates membership and distance. Coffee, fruit-market and restaurant hosts open guided lessons.",
      inputSchema: { type: "object", properties: { npcId: { type: "string", minLength: 1 } }, required: ["npcId"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const id = typeof input === "object" && input !== null ? (input as { npcId?: unknown }).npcId : undefined;
        const npc = actions.current.cast.find((candidate) => candidate.id === id);
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
    <main className="game-shell iso-game-shell">
      <section className="world-stage" aria-label={`${snapshot?.environment.name ?? "World"} interactive preview`}>
        {snapshot && <WorldViewport environment={snapshot.environment} players={snapshot.players} npcs={snapshot.npcs} localPlayerId={localPlayerId} selectedNpcId={selectedNpc.id} encounters={snapshot.encounters}
          inputEnabled={phase === "explore" && connection === "connected" && !showRoom && !showCharacter}
          renderPaused={phase !== "explore" || showCharacter || showRoom}
          walkingRequest={walkingRequest} onWalking={(walking, message) => { setWalking(walking); setWalkingNotice(message); }}
          onMove={(direction, yaw) => send({ type: "move", direction, yaw, sequence: 0 })}
          onInteract={(npcId) => requestConversation(npcId as NpcDefinition["id"])} />}
      </section>
      {appearanceNotice && <div className="appearance-notice" role="status">{appearanceNotice}<button aria-label="Dismiss appearance update" onClick={() => setAppearanceNotice("")}>×</button></div>}
      {showCharacter && localPlayer && <CharacterEditor appearance={localPlayer.appearance} connected={connection === "connected"} onSave={saveAppearance} onClose={() => setShowCharacter(false)} />}
      {showRoom && <RoomSettings session={session} onJoin={onJoin} onClose={() => setShowRoom(false)} />}
      {error && <div className="world-error" role="alert">{error} <button onClick={clearError}>Dismiss</button></div>}

      <header className="topbar">
        <div className="brand-lockup" aria-label="Kyoto Conversations">
          <span className="brand-mark" aria-hidden="true">京</span>
          <span><strong>Kyoto Conversations</strong><small>京都で話そう</small></span>
        </div>
        <div className="session-status"><span className={`status-light ${connection === "connected" ? "" : "is-offline"}`} />{mode === "local" ? "Solo exploration" : `Room ${session.roomId}`} · {connection} · {snapshot?.players.length ?? 0} players</div>
        <Button variant="ghost" size="sm" className="hud-button" onClick={() => setShowTranslations((value) => !value)}>
          <Languages /> {showTranslations ? "Hide English" : "Show English"}
        </Button>
        <Button className="room-button" variant="outline" size="sm" disabled={!localPlayer} onClick={() => setShowCharacter(true)}><Shirt /><span>Character</span></Button>
        <Button className="room-button" variant="outline" size="sm" onClick={() => setShowRoom(true)}><Users /><span>Room</span></Button>
      </header>

      {phase === "explore" && (
        <>
          <aside className={`mission-card iso-rail ${showCast ? "" : "is-collapsed"}`} aria-label="Explore Kyoto">
            <div className="rail-title" aria-hidden="true"><span>京都で</span><span>話そう</span><small>Speak in Kyoto</small></div>
            <div className="rail-rule" aria-hidden="true" />
            <div className="eyebrow"><Map /> Your afternoon</div>
            <div className="mission-title-row"><h1>Meet the neighbourhood</h1><button className="cast-toggle" onClick={() => setShowCast(!showCast)} aria-expanded={showCast} aria-controls="world-cast">{showCast ? "Hide" : "Show"}</button></div>
            <p>Pick a local, then Walk closer. Start a conversation when you reach them.</p>
            <div className="character-picker" id="world-cast" hidden={!showCast}>{cast.map((npc) => {
              const character = snapshot?.npcs.find((entry) => entry.id === npc.id);
              const meters = localPlayer && character ? distance(localPlayer.position, character.position) : null;
              const occupied = snapshot?.encounters.some((entry) => entry.npcId === npc.id);
              const avatar = lessonCharacterForWorldNpc(npc.id);
              return <button key={npc.id} aria-pressed={npc.id === selectedNpc.id} onClick={() => { setWalkingRequest(null); setSelectedNpcId(npc.id); }}><span className="cast-dot" style={{ background: npc.accent }} /><span><strong>{npc.name}</strong><small>{npc.role}{avatar ? ' · Live avatar' : ''}</small></span><small>{meters !== null ? `${meters.toFixed(0)} m` : "…"}{occupied ? " · Group" : ""}</small></button>;
            })}</div>
            <p className="rail-caption">言葉で、もっと近くに。<br /><span>Meet live characters and practise ten-question lessons around the neighbourhood.</span></p>
            <Link className="environment-preview-link" href="/environments">Explore the conversation settings <ChevronRight size={14} /></Link>
          </aside>

          <aside className="location-card iso-character-card" aria-label="Selected character">
            {liveCharacter ? <Image className="npc-live-preview" src={liveCharacter.preview} alt={`${selectedNpc.name}'s live avatar`} width={76} height={76} unoptimized /> : <span className="npc-monogram" style={{ background: selectedNpc.accent }}>{selectedNpc.nameJapanese}</span>}
            <div><small>{selectedNpc.role} · {selectedNpc.level}</small><h2>{selectedNpc.name}</h2><p>{selectedNpc.objective}</p><span className="distance-label">{inRange ? "Within talking distance" : targetDistance !== null ? `${targetDistance.toFixed(1)} m away` : "Joining the world…"}</span></div>
          </aside>

          <div className="interaction-prompt iso-interaction-prompt">
            <span className="keycap" aria-hidden="true">話</span>
            <span><small>Selected character</small>{selectedNpc.name}</span>
            <Button size="sm" disabled={!target || connection !== "connected"} onClick={() => {
              if (walking) setWalkingRequest(null);
              else if (inRange) requestConversation();
              else setWalkingRequest({ npcId: selectedNpc.id, sequence: Date.now() });
            }}>{walking ? "Stop walking" : inRange ? targetEncounter ? "Join encounter" : "Start encounter" : "Walk closer"} <ChevronRight /></Button>
          </div>
          <div className="movement-hint iso-movement-hint"><span>W A S D</span> Move <span>E</span> {closest ? `Talk to ${closest.name}` : "Talk nearby"} · Click the world to focus</div>
          {walkingNotice && <div className="walking-notice" role="status">{walkingNotice}</div>}
        </>
      )}

      {phase === "conversation" && lessonNpcId && <LessonDialogue key={active?.id} npcId={lessonNpcId} worldNpcId={selectedNpc.id} onClose={returnToWorld} />}
      {phase === "conversation" && !lessonNpcId && (
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
              <div className="voice-state"><Volume2 /><span><strong>Microphone off</strong><small>Voice service not connected</small></span></div>
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
              <div><small>Practice preview</small><h1>Keep the conversation going</h1><p>This illustrates the future assessment for the {selectedNpc.role.toLowerCase()} challenge.</p></div>
            </div>
            <div className="assessment-placeholder"><strong>No score yet</strong><p>This was a sample dialogue. A real Japanese conversation will receive feedback once the voice and assessment services are connected.</p></div>
            <div className="feedback-grid">
              <article className="feedback-good"><small>Example strength</small><h2>A useful follow-up question.</h2><p>{encounter.feedback}</p></article>
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
