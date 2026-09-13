"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVoicePreference } from "@/components/game/voice-welcome";
import { useWorld } from "@/components/world/world-provider";
import { distance } from "@/lib/world/room";
import { bindPushToTalk } from "@/lib/voice/push-to-talk";
import { INITIAL_VOICE_STATE, ProximityVoice } from "@/lib/voice/proximity";

type VoicePanelProps = { onTalkingChange?: (talking: boolean) => void; onSpeakingChange?: (playerIds: string[]) => void };
export function ProximityVoicePanel({ onTalkingChange, onSpeakingChange }: VoicePanelProps) {
  const { connection, mode, localPlayerId, supportsPlayerVoice } = useWorld();
  if (mode === "local" || connection !== "connected" || !localPlayerId) return <div className="proximity-voice"><span>Proximity voice · {mode === "local" ? "Join a multiplayer room to talk with friends" : "Connect to the room to enable voice"}</span></div>;
  if (!supportsPlayerVoice) return <div className="proximity-voice"><span>Nearby voice is unavailable in this room. You can keep exploring together.</span></div>;
  return <ConnectedVoice key={localPlayerId} playerId={localPlayerId} onTalkingChange={onTalkingChange} onSpeakingChange={onSpeakingChange} />;
}
function ConnectedVoice({ playerId, onTalkingChange, onSpeakingChange }: VoicePanelProps & { playerId: string }) {
  const { snapshot, sendVoice, subscribeVoice } = useWorld();
  const { enabled: preferredEnabled, setEnabled: setPreferredEnabled, getAudioContext } = useVoicePreference();
  const initialConsent = useRef(preferredEnabled);
  const [state, setState] = useState(INITIAL_VOICE_STATE);
  const [diagnostics, setDiagnostics] = useState<string[] | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => { onTalkingChange?.(state.talking); return () => onTalkingChange?.(false); }, [state.talking, onTalkingChange]);
  useEffect(() => { onSpeakingChange?.(state.speakingPlayerIds); }, [state.speakingPlayerIds, onSpeakingChange]);
  useEffect(() => () => onSpeakingChange?.([]), [onSpeakingChange]);
  const input = useRef<ReturnType<typeof bindPushToTalk> | null>(null);
  const controller = useRef<ProximityVoice | null>(null);
  useEffect(() => {
    const voice = new ProximityVoice(playerId, sendVoice, setState, { createAudio: getAudioContext });
    controller.current = voice;
    if (initialConsent.current) void voice.enable();
    const keys = bindPushToTalk(window, document, (held) => voice.setTalking(held));
    input.current = keys;
    const unsubscribe = subscribeVoice((message) => voice.receive(message));
    return () => { keys.dispose(); input.current = null; unsubscribe(); voice.disable(); controller.current = null; };
  }, [playerId, sendVoice, subscribeVoice, getAudioContext]);
  useEffect(() => {
    const me = snapshot?.players.find((player) => player.id === playerId);
    controller.current?.setDistances(new Map(snapshot?.players.map((player) => [player.id, me ? distance(player.position, me.position) : Infinity])));
  }, [snapshot, playerId]);
  const enabled = state.status === "enabled";
  function enable() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection || !window.AudioContext) {
      setState({ ...INITIAL_VOICE_STATE, status: "error", message: "Voice requires HTTPS (or localhost) and a browser with microphone/WebRTC support." });
      return;
    }
    setPreferredEnabled(true);
    void controller.current?.enable();
  }
  async function checkAudio() {
    const voice = controller.current;
    if (!voice || checking) return;
    setChecking(true);
    const report = await voice.diagnostics();
    if (controller.current === voice) { setDiagnostics(report); setChecking(false); }
  }
  return <div className="proximity-voice" aria-label="Proximity voice">
    <span className="proximity-voice-label"><strong>Nearby voice {enabled ? state.muted ? "· Mic muted" : state.talking ? "· Talking" : "· Hold T to talk" : ""}</strong><small role="status">{state.message}</small></span>
    {!enabled && <Button size="sm" variant="outline" disabled aria-label="Hold to talk (voice off)"><MicOff />Hold to talk · T</Button>}
    {enabled ? <>
      {state.playbackBlocked && <Button size="sm" variant="outline" onClick={() => void controller.current?.resumePlayback()}><Volume2 />Resume audio</Button>}
      <Button size="sm" variant="outline" disabled={state.muted} aria-pressed={state.talking} aria-keyshortcuts="T" aria-label="Hold to talk to nearby players"
        onPointerDown={(event) => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); input.current?.setHeld("pointer", true); }}
        onPointerUp={() => input.current?.setHeld("pointer", false)}
        onPointerCancel={() => input.current?.releaseAll()}
        onLostPointerCapture={() => input.current?.setHeld("pointer", false)}
        onBlur={() => input.current?.releaseAll()}
        onKeyDown={(event) => { if (!["Space", "Enter"].includes(event.code) || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return; event.preventDefault(); input.current?.setHeld("button-key", true); }}
        onKeyUp={(event) => { if (["Space", "Enter"].includes(event.code)) { event.preventDefault(); input.current?.setHeld("button-key", false); } }}
      ><Mic />{state.talking ? "Talking…" : "Hold to talk · T"}</Button>
      <Button size="sm" variant="outline" aria-pressed={state.muted} onClick={() => { input.current?.releaseAll(); controller.current?.mute(); }}>{state.muted ? <MicOff /> : <Mic />}{state.muted ? "Unmute" : "Mute"}</Button>
      <Button size="sm" variant="outline" onClick={() => { setPreferredEnabled(false); input.current?.releaseAll(); controller.current?.disable(); }}><PhoneOff />Disable voice</Button>
    </> : <Button size="sm" variant="outline" disabled={state.status === "requesting"} onClick={enable}><Mic />{state.status === "requesting" ? "Starting…" : "Enable voice"}</Button>}
    {state.status === "requesting" && <Button size="sm" variant="outline" onClick={() => { setPreferredEnabled(false); input.current?.releaseAll(); controller.current?.disable(); }}>Cancel</Button>}
    <Button size="sm" variant="outline" onClick={() => void checkAudio()} disabled={checking}>{checking ? "Checking…" : "Check audio"}</Button>
    {diagnostics && <div role="status" style={{ flexBasis: "100%", fontSize: ".75rem" }}><strong>Audio check · hold T while checking your microphone</strong>{diagnostics.map((line, index) => <div key={index}>{line}</div>)}<Button size="sm" variant="ghost" onClick={() => setDiagnostics(null)}>Close audio check</Button></div>}
    <small className="proximity-voice-help">Hold T or the talk button to speak to players within 12 m. Audio fades with distance. In busy areas, voice connects you with up to seven nearby players.</small>
  </div>;
}
