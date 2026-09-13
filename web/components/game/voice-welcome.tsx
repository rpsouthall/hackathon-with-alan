"use client";

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resumeVoiceAudio, VoiceAudioSession } from "@/lib/voice/proximity";

const VoiceConsent = createContext<{ enabled: boolean; setEnabled: (enabled: boolean) => void; getAudioContext: () => AudioContext }>({ enabled: false, setEnabled: () => {}, getAudioContext: () => new AudioContext() });
export const useVoicePreference = () => useContext(VoiceConsent);

const subscribeToHydration = () => () => {};

/** Ask once for hosted voice rooms; the local development server is gameplay-only. */
export function VoiceWelcome({ children }: { children: ReactNode }) {
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const configuredServer = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_WORLD_SERVER_URL?.trim();
  const hostedDefault = !hydrated || configuredServer === "hosted" || (!configuredServer && !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname));
  const [choice, setChoice] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [audioSession] = useState(() => new VoiceAudioSession());
  const attempt = useRef(0);
  useEffect(() => () => { attempt.current++; audioSession.close(); }, [audioSession]);
  async function accept() {
    const current = ++attempt.current;
    setPending(true);
    setError("");
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.RTCPeerConnection) {
        throw new Error("Microphone access needs HTTPS or localhost. You can continue with voice off.");
      }
      // Unlock output inside this click, then reuse that exact context after room join.
      // Both promises are observed immediately, and even a late permission grant is stopped.
      await Promise.all([
        resumeVoiceAudio(audioSession.getContext()),
        navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then((stream) => { stream.getTracks().forEach(track => track.stop()); }),
      ]);
      if (current === attempt.current) setChoice(true);
    } catch (error) {
      if (current === attempt.current) {
        audioSession.close();
        setError(error instanceof Error && error.message.startsWith("Audio playback") ? error.message : "Voice is off. Allow microphone access in your browser to enable it, or continue without voice.");
      }
    } finally {
      if (current === attempt.current) setPending(false);
    }
  }
  if (hostedDefault && choice === null) return <main className="game-shell welcome-stage voice-welcome-stage">
    <section className="voice-welcome-card" aria-labelledby="voice-welcome-title">
      <Mic aria-hidden="true" />
      <h1 id="voice-welcome-title">Talk as you explore</h1>
      <p>Enable nearby voice to talk with other players. Your microphone only transmits while you hold T or the talk button.</p>
      <p>You can enable or disable voice anytime from the heads-up display.</p>
      {error && <p role="alert">{error}</p>}
      <Button onClick={() => void accept()} disabled={pending}>{pending ? "Waiting for microphone permission…" : "Enable voice"}</Button>
      <Button variant="outline" onClick={() => { attempt.current++; audioSession.close(); setChoice(false); }}>Continue without voice</Button>
    </section>
  </main>;
  return <VoiceConsent.Provider value={{ enabled: choice ?? false, setEnabled: setChoice, getAudioContext: audioSession.getContext }}>{children}</VoiceConsent.Provider>;
}
