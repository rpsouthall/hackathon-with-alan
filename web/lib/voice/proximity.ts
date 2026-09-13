import type { PlayerVoiceClientMessage as VoiceClientMessage, PlayerVoiceServerMessage as VoiceServerMessage } from "../world/player-voice-contract";

export function proximityGain(distance: number, radius = 12) {
  if (!Number.isFinite(distance) || distance >= radius) return 0;
  return Math.max(0, Math.min(1, (radius - distance) / Math.max(0.001, radius - 2)));
}
export type VoiceState = { status: "off" | "requesting" | "enabled" | "error"; muted: boolean; talking: boolean; speakingPlayerIds: string[]; connectedPeers: number; message: string };
export const INITIAL_VOICE_STATE: VoiceState = { status: "off", muted: false, talking: false, speakingPlayerIds: [], connectedPeers: 0, message: "Voice off" };
export interface VoiceDependencies {
  getUserMedia(): Promise<MediaStream>;
  createPeer(configuration: RTCConfiguration): RTCPeerConnection;
  createAudio(): AudioContext;
}
const browserDependencies: VoiceDependencies = {
  getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }),
  createPeer: (configuration) => new RTCPeerConnection(configuration),
  createAudio: () => new AudioContext(),
};
type SpeakingMeter = { analyser: AnalyserNode; samples: Float32Array<ArrayBuffer>; lastLoudAt: number; active: boolean };
type Peer = { id: string; sessionId: string; pc: RTCPeerConnection; queue: Promise<void>; candidates: (RTCIceCandidateInit | null)[]; source?: MediaStreamAudioSourceNode; gain?: GainNode; meter?: SpeakingMeter; stream?: MediaStream; track?: MediaStreamTrack; trackEnded?: () => void };

/** One controller per authenticated room connection. Server owns the eligible peer set. */
export class ProximityVoice {
  private generation = 0;
  private stream?: MediaStream;
  private audio?: AudioContext;
  private localSource?: MediaStreamAudioSourceNode;
  private localMeter?: SpeakingMeter;
  private activityTimer?: ReturnType<typeof setInterval>;
  private peers = new Map<string, Peer>();
  private distances = new Map<string, number>();
  private radius = 12;
  private state: VoiceState = INITIAL_VOICE_STATE;
  constructor(private localId: string, private send: (message: VoiceClientMessage) => void, private changed: (state: VoiceState) => void, private dependencies = browserDependencies) {}
  private update(patch: Partial<VoiceState>) { this.state = { ...this.state, ...patch }; this.changed(this.state); }
  private createMeter(): SpeakingMeter {
    const analyser = this.audio!.createAnalyser();
    analyser.fftSize = 1024;
    return { analyser, samples: new Float32Array(analyser.fftSize), lastLoudAt: -Infinity, active: false };
  }
  private meterSpeaking(meter: SpeakingMeter | undefined, eligible: boolean, now: number, sample: boolean) {
    if (!meter) return false;
    if (!eligible) { meter.lastLoudAt = -Infinity; meter.active = false; return false; }
    if (!sample) return meter.active;
    meter.analyser.getFloatTimeDomainData(meter.samples);
    let energy = 0;
    for (const value of meter.samples) energy += value * value;
    const rms = Math.sqrt(energy / meter.samples.length);
    // Hysteresis and a short hangover bridge syllables without animating an open, silent mic.
    if (rms >= (meter.active ? 0.012 : 0.018)) meter.lastLoudAt = now;
    meter.active = now - meter.lastLoudAt < 220;
    return meter.active;
  }
  private sampleActivity = (sample = true) => {
    const running = this.state.status === "enabled" && this.audio?.state === "running";
    const now = Date.now();
    const speakingPlayerIds: string[] = [];
    if (this.meterSpeaking(this.localMeter, running && this.state.talking && !this.state.muted, now, sample)) speakingPlayerIds.push(this.localId);
    for (const peer of this.peers.values()) {
      const audible = running && peer.pc.connectionState === "connected" && peer.track?.readyState !== "ended" && !peer.track?.muted && proximityGain(this.distances.get(peer.id) ?? Infinity, this.radius) > 0;
      if (this.meterSpeaking(peer.meter, audible, now, sample)) speakingPlayerIds.push(peer.id);
    }
    speakingPlayerIds.sort();
    if (speakingPlayerIds.length !== this.state.speakingPlayerIds.length || speakingPlayerIds.some((id, index) => id !== this.state.speakingPlayerIds[index])) this.update({ speakingPlayerIds });
  };
  async enable() {
    if (this.state.status === "requesting" || this.state.status === "enabled") return;
    const generation = ++this.generation;
    this.update({ status: "requesting", message: "Requesting microphone…", muted: false, talking: false });
    try {
      // Start/resume from the enable button's user gesture, before awaiting permission.
      const audio = this.dependencies.createAudio();
      this.audio = audio;
      await audio.resume();
      if (generation !== this.generation) return;
      if (audio.state !== "running") throw new Error("Audio playback is blocked. Enable voice again to resume audio.");
      audio.onstatechange = () => { if (generation === this.generation && this.state.status === "enabled") this.peerState(); };
      const stream = await this.dependencies.getUserMedia();
      if (generation !== this.generation) { stream.getTracks().forEach((track) => track.stop()); return; }
      this.stream = stream;
      stream.getAudioTracks().forEach((track) => { track.enabled = false; track.onended = () => { if (generation === this.generation) this.fail("Microphone disconnected. Enable voice to try again."); }; });
      if (stream.getAudioTracks().length) {
        this.localMeter = this.createMeter();
        this.localSource = audio.createMediaStreamSource(stream);
        // Analyse the already permitted mic without routing it back to the speakers.
        this.localSource.connect(this.localMeter.analyser);
      }
      this.update({ status: "enabled", message: "Waiting for nearby players…" });
      this.activityTimer = setInterval(this.sampleActivity, 80);
      this.send({ type: "voice-join" });
    } catch (error) {
      if (generation === this.generation) this.fail(error instanceof Error ? error.message : "Could not start microphone.");
    }
  }
  mute() {
    if (!this.stream) return;
    const muted = !this.state.muted;
    this.stream.getAudioTracks().forEach((track) => { track.enabled = false; });
    this.update({ muted, talking: false });
    this.sampleActivity(false);
  }
  setTalking(held: boolean) {
    const talking = held && this.state.status === "enabled" && !this.state.muted;
    this.stream?.getAudioTracks().forEach((track) => { track.enabled = talking; });
    if (talking !== this.state.talking) this.update({ talking });
    if (!talking) this.sampleActivity(false);
  }
  disable() {
    const wasActive = this.state.status === "enabled";
    ++this.generation;
    clearInterval(this.activityTimer);
    this.activityTimer = undefined;
    for (const peer of this.peers.values()) this.closePeer(peer);
    this.peers.clear();
    this.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    this.stream = undefined;
    this.localSource?.disconnect(); this.localMeter?.analyser.disconnect();
    this.localSource = undefined; this.localMeter = undefined;
    if (this.audio) this.audio.onstatechange = null;
    void this.audio?.close().catch(() => {});
    this.audio = undefined;
    this.update({ ...INITIAL_VOICE_STATE });
    if (wasActive) this.send({ type: "voice-leave" });
  }
  private fail(message: string) { this.disable(); this.update({ status: "error", message }); }
  setDistances(distances: Map<string, number>) {
    this.distances = distances;
    for (const peer of this.peers.values()) this.setGain(peer);
    this.sampleActivity(false);
  }
  private setGain(peer: Peer) {
    if (peer.gain && this.audio) peer.gain.gain.setTargetAtTime(proximityGain(this.distances.get(peer.id) ?? Infinity, this.radius), this.audio.currentTime, 0.08);
  }
  private current(peer: Peer) { return this.state.status === "enabled" && this.peers.get(peer.id) === peer; }
  private disconnectPeerAudio(peer: Peer) {
    peer.source?.disconnect(); peer.gain?.disconnect(); peer.meter?.analyser.disconnect();
    peer.source = undefined; peer.gain = undefined; peer.meter = undefined;
  }
  private syncPeerAudio(peer: Peer) {
    if (["disconnected", "failed", "closed"].includes(peer.pc.connectionState) || peer.track?.readyState === "ended") { this.disconnectPeerAudio(peer); return; }
    if (!this.audio || !peer.stream || peer.source) return;
    // Attach when ontrack fires, including during ICE setup, so playback can begin
    // as soon as decoded media arrives. Activity still requires a connected peer.
    peer.meter = this.createMeter();
    peer.source = this.audio.createMediaStreamSource(peer.stream);
    peer.gain = this.audio.createGain();
    peer.gain.gain.value = 0;
    peer.source.connect(peer.gain).connect(peer.meter.analyser).connect(this.audio.destination);
    this.setGain(peer);
  }
  private detachPeerTrack(peer: Peer) {
    if (peer.trackEnded) peer.track?.removeEventListener("ended", peer.trackEnded);
    peer.track = undefined; peer.trackEnded = undefined; peer.stream = undefined;
    this.disconnectPeerAudio(peer);
  }
  private closePeer(peer: Peer) {
    peer.pc.onicecandidate = null; peer.pc.ontrack = null; peer.pc.onconnectionstatechange = null;
    peer.pc.close(); this.detachPeerTrack(peer);
  }
  private peerState() {
    const connectedPeers = [...this.peers.values()].filter((peer) => peer.pc.connectionState === "connected").length;
    const failed = [...this.peers.values()].some((peer) => peer.pc.connectionState === "failed");
    this.update({ connectedPeers, message: this.audio?.state !== "running" ? "Audio playback paused. Disable and enable voice to resume listening." : failed ? "A voice connection failed. Re-enable voice to retry." : connectedPeers ? `${connectedPeers} nearby player${connectedPeers === 1 ? "" : "s"} connected` : this.peers.size ? "Connecting to nearby players…" : "Waiting for nearby players…" });
    this.sampleActivity(false);
  }
  private enqueue(peer: Peer, action: () => Promise<void>) {
    peer.queue = peer.queue.then(async () => { if (this.current(peer)) await action(); }).catch(() => {
      if (this.current(peer)) { this.closePeer(peer); this.peers.delete(peer.id); this.peerState(); this.update({ message: "Voice negotiation failed. Re-enable voice to retry." }); }
    });
  }
  receive(message: VoiceServerMessage) {
    try { this.receiveMessage(message); }
    catch (error) { this.fail(error instanceof Error ? error.message : "Could not create voice connection."); }
  }
  private receiveMessage(message: VoiceServerMessage) {
    if (this.state.status !== "enabled") return;
    if (message.type === "voice-error") { this.update({ message: message.message }); return; }
    if (message.type === "voice-peers") {
      this.radius = Math.min(12, message.radius);
      for (const peer of this.peers.values()) {
        if (!message.peers.some((next) => next.playerId === peer.id && next.sessionId === peer.sessionId)) { this.closePeer(peer); this.peers.delete(peer.id); }
      }
      for (const next of message.peers) {
        if (next.playerId === this.localId || this.peers.has(next.playerId)) continue;
        const pc = this.dependencies.createPeer({ iceServers: message.iceServers });
        const peer: Peer = { id: next.playerId, sessionId: next.sessionId, pc, queue: Promise.resolve(), candidates: [] };
        this.peers.set(peer.id, peer);
        this.stream!.getTracks().forEach((track) => pc.addTrack(track, this.stream!));
        pc.onicecandidate = ({ candidate }) => { if (this.current(peer)) this.send({ type: "voice-signal", to: peer.id, sessionId: peer.sessionId, signal: { kind: "ice", candidate: candidate?.toJSON() ?? null } }); };
        pc.onconnectionstatechange = () => {
          if (!this.current(peer)) return;
          try { this.syncPeerAudio(peer); this.peerState(); }
          catch { this.fail("Could not play nearby audio. Enable voice to try again."); }
        };
        pc.ontrack = ({ streams, track }) => {
          if (!this.current(peer) || !this.audio || track.kind !== "audio") return;
          try {
            this.detachPeerTrack(peer);
            peer.stream = streams[0] ?? new MediaStream([track]);
            peer.track = track;
            peer.trackEnded = () => { if (this.current(peer)) { this.detachPeerTrack(peer); this.sampleActivity(false); } };
            track.addEventListener("ended", peer.trackEnded);
            this.syncPeerAudio(peer);
            this.sampleActivity(false);
          } catch { this.fail("Could not play nearby audio. Enable voice to try again."); }
        };
        if (this.localId < peer.id) this.enqueue(peer, async () => {
          const offer = await pc.createOffer();
          if (!this.current(peer)) return;
          await pc.setLocalDescription(offer);
          if (this.current(peer)) this.send({ type: "voice-signal", to: peer.id, sessionId: peer.sessionId, signal: { kind: "offer", sdp: pc.localDescription!.sdp } });
        });
      }
      for (const peer of this.peers.values()) this.setGain(peer);
      this.peerState();
      return;
    }
    if (message.type !== "voice-signal") return;
    const peer = this.peers.get(message.from);
    if (!peer || peer.sessionId !== message.sessionId) return;
    const signal = message.signal;
    this.enqueue(peer, async () => {
      if (signal.kind === "ice") {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(signal.candidate ?? undefined);
        else {
          if (peer.candidates.length >= 128) throw new Error("Too many pending ICE candidates");
          peer.candidates.push(signal.candidate);
        }
        return;
      }
      // Only the lower player ID offers; ignore unsolicited role inversions.
      if ((signal.kind === "offer") !== (this.localId > peer.id)) return;
      await peer.pc.setRemoteDescription({ type: signal.kind, sdp: signal.sdp });
      if (!this.current(peer)) return;
      for (const candidate of peer.candidates.splice(0)) { await peer.pc.addIceCandidate(candidate ?? undefined); if (!this.current(peer)) return; }
      if (signal.kind === "offer") {
        const answer = await peer.pc.createAnswer();
        if (!this.current(peer)) return;
        await peer.pc.setLocalDescription(answer);
        if (this.current(peer)) this.send({ type: "voice-signal", to: peer.id, sessionId: peer.sessionId, signal: { kind: "answer", sdp: peer.pc.localDescription!.sdp } });
      }
    });
  }
}
