import test from "node:test";
import assert from "node:assert/strict";
import { ProximityVoice, proximityGain, resumeVoiceAudio, VoiceAudioSession, type VoiceDependencies, type VoiceState } from "../../lib/voice/proximity";
import type { PlayerVoiceClientMessage as VoiceClientMessage, PlayerVoiceServerMessage as VoiceServerMessage } from "../../lib/world/player-voice-contract";
class FakePeer {
  connectionState = "new"; remoteDescription: unknown = null;
  iceConnectionState = "new";
  stats = new Map<string, Record<string, unknown>>();
  configurations: RTCConfiguration[] = [];
  localDescription: { type: string; sdp: string } | null = null;
  onicecandidate: ((event: unknown) => void) | null = null;
  ontrack: ((event: unknown) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  closed = false; candidates: unknown[] = [];
  async createOffer() { return { type: "offer", sdp: "offer" }; }
  async createAnswer() { return { type: "answer", sdp: "answer" }; }
  async setLocalDescription(value: { type: string; sdp: string }) { this.localDescription = value; }
  async setRemoteDescription(value: unknown) { this.remoteDescription = value; }
  async addIceCandidate(value: unknown) { this.candidates.push(value); }
  async getStats() { return this.stats; }
  setConfiguration(configuration: RTCConfiguration) { this.configurations.push(configuration); }
  addTrack() {}
  close() { this.closed = true; }
}
class FakeTrack extends EventTarget {
  enabled = true; stopped = false; muted = false; kind = "audio"; readyState = "live";
  onended: null | (() => void) = null;
  stop() { this.stopped = true; this.readyState = "ended"; }
  end() { this.readyState = "ended"; this.onended?.(); this.dispatchEvent(new Event("ended")); }
}
class FakeAudioNode {
  disconnected = false;
  connections: FakeAudioNode[] = [];
  connect<T extends FakeAudioNode>(node: T) { this.connections.push(node); return node; }
  disconnect() { this.disconnected = true; this.connections = []; }
}
class FakeAnalyser extends FakeAudioNode {
  fftSize = 0; level = 0; samples = 0;
  getFloatTimeDomainData(buffer: Float32Array) { buffer.fill(this.level); this.samples++; }
}
class FakeGain extends FakeAudioNode {
  levels: number[] = [];
  gain = { value: 999, setTargetAtTime: (value: number) => this.levels.push(value) };
}
class FakeAudio {
  state = "running"; closed = false; currentTime = 0;
  onstatechange: null | (() => void) = null;
  destination = new FakeAudioNode();
  analysers: FakeAnalyser[] = []; sources: FakeAudioNode[] = []; gains: FakeGain[] = [];
  async resume() {}
  async close() { this.closed = true; this.state = "closed"; }
  createAnalyser() { const analyser = new FakeAnalyser(); this.analysers.push(analyser); return analyser; }
  createGain() { const gain = new FakeGain(); this.gains.push(gain); return gain; }
  createMediaStreamSource() { const source = new FakeAudioNode(); this.sources.push(source); return source; }
}
class FakeRemoteAudio {
  autoplay = false; muted = false; volume = 1; srcObject: MediaStream | null = null; paused = true; plays = 0;
  async play() { this.plays++; this.paused = false; }
  pause() { this.paused = true; }
}
const trackStream = (track: FakeTrack) => ({ getTracks: () => [track], getAudioTracks: () => [track] }) as unknown as MediaStream;
function fixture(id = "a", getUserMedia?: VoiceDependencies["getUserMedia"], overrides: Partial<VoiceDependencies> = {}) {
  const sent: VoiceClientMessage[] = [], peers: FakePeer[] = [], states: VoiceState[] = [];
  const track = new FakeTrack(), stream = trackStream(track), audio = new FakeAudio();
  const remoteAudio: FakeRemoteAudio[] = [];
  const controller = new ProximityVoice(id, (message) => sent.push(message), (state) => states.push(state), {
    getUserMedia: getUserMedia ?? (async () => stream),
    createPeer() { const peer = new FakePeer(); peers.push(peer); return peer as unknown as RTCPeerConnection; },
    createAudio: () => audio as unknown as AudioContext,
    createRemoteAudio: () => { const output = new FakeRemoteAudio(); remoteAudio.push(output); return output as unknown as HTMLAudioElement; },
    ...overrides,
  });
  return { controller, sent, peers, states, track, stream, audio, remoteAudio, audioClosed: () => audio.closed };
}
const roster = (playerId = "b", sessionId = "first"): VoiceServerMessage => ({ type: "voice-peers", peers: [{ playerId, sessionId }], iceServers: [], radius: 12 });
const flush = () => new Promise((resolve) => setImmediate(resolve));
test("voice attenuation is full up to 2m and silent outside 12m", () => {
  assert.equal(proximityGain(0), 1); assert.equal(proximityGain(2), 1);
  assert.equal(proximityGain(7), .5); assert.equal(proximityGain(12), 0);
  assert.equal(proximityGain(100), 0); assert.equal(proximityGain(Infinity), 0);
});
test("cancel during permission prompt stops late microphone and never joins", async () => {
  let resolve!: (stream: MediaStream) => void;
  const f = fixture("a", () => new Promise((done) => { resolve = done; }));
  const pending = f.controller.enable(); await flush();
  f.controller.disable(); resolve(f.stream); await pending;
  assert.equal(f.track.stopped, true); assert.equal(f.audioClosed(), true); assert.deepEqual(f.sent, []);
});
test("mute disables tracks; disable closes peers and microphone", async () => {
  const f = fixture(); await f.controller.enable(); f.controller.receive(roster()); await flush();
  assert.equal(f.sent[0].type, "voice-join");
  assert.ok(f.sent.some((message) => message.type === "voice-signal" && message.signal.kind === "offer"));
  f.controller.setTalking(true); assert.equal(f.track.enabled, true);
  f.controller.mute(); assert.equal(f.track.enabled, false);
  f.controller.setTalking(true); assert.equal(f.track.enabled, false);
  f.controller.mute(); assert.equal(f.track.enabled, false);
  f.controller.setTalking(true); assert.equal(f.track.enabled, true);
  f.controller.disable(); assert.equal(f.track.stopped, true); assert.equal(f.peers[0].closed, true);
  assert.equal(f.sent.at(-1)?.type, "voice-leave");
});
test("range departure closes peer and stale signals cannot reach rejoined peer", async () => {
  const f = fixture(); await f.controller.enable(); f.controller.receive(roster()); await flush();
  f.controller.receive({ type: "voice-peers", peers: [], iceServers: [], radius: 12 });
  assert.equal(f.peers[0].closed, true); f.controller.receive(roster("b", "second")); await flush();
  f.controller.receive({ type: "voice-signal", from: "b", sessionId: "first", signal: { kind: "answer", sdp: "stale" } });
  await flush(); assert.equal(f.peers[1].remoteDescription, null); f.controller.disable();
});
test("responder buffers ICE before offer then answers", async () => {
  const f = fixture("z"); await f.controller.enable(); f.controller.receive(roster("a"));
  const signal = (value: Extract<VoiceServerMessage, { type: "voice-signal" }>["signal"]) => f.controller.receive({ type: "voice-signal", from: "a", sessionId: "first", signal: value });
  signal({ kind: "ice", candidate: { candidate: "candidate" } }); await flush();
  assert.equal(f.peers[0].candidates.length, 0); signal({ kind: "offer", sdp: "offer" }); await flush();
  assert.equal(f.peers[0].candidates.length, 1);
  assert.equal(f.sent.filter((message) => message.type === "voice-signal" && message.signal.kind === "answer").length, 1); f.controller.disable();
});
test("rejected stale relay reports status without terminating an active microphone", async () => {
  const f = fixture(); await f.controller.enable(); f.controller.receive({ type: "voice-error", message: "Voice unavailable" });
  assert.equal(f.track.stopped, false); assert.equal(f.states.at(-1)?.status, "enabled"); assert.equal(f.states.at(-1)?.message, "Voice unavailable");
  f.controller.disable();
});
test("late answer creation after disconnect never sends SDP", async () => {
  const f = fixture("z"); await f.controller.enable(); f.controller.receive(roster("a"));
  let resolve!: (value: { type: string; sdp: string }) => void;
  f.peers[0].createAnswer = () => new Promise((done) => { resolve = done; });
  f.controller.receive({ type: "voice-signal", from: "a", sessionId: "first", signal: { kind: "offer", sdp: "offer" } });
  await flush(); f.controller.disable(); resolve({ type: "answer", sdp: "late" }); await flush();
  assert.equal(f.sent.filter((message) => message.type === "voice-signal").length, 0);
});
test("permission denial reports error without joining or keeping audio context", async () => {
  const f = fixture("a", async () => { throw new Error("Microphone permission denied"); });
  await f.controller.enable();
  assert.equal(f.states.at(-1)?.status, "error");
  assert.equal(f.states.at(-1)?.message, "Microphone permission denied");
  assert.equal(f.audioClosed(), true); assert.deepEqual(f.sent, []);
});
test("output gain follows distance and starts silent until position is known", async () => {
  const f = fixture("z");
  await f.controller.enable(); f.controller.receive(roster("a"));
  const peer = f.peers[0], track = new FakeTrack();
  peer.connectionState = "connected";
  peer.ontrack?.({ streams: [trackStream(track)], track });
  const gain = f.audio.gains[0], levels = gain.levels;
  assert.equal(gain.gain.value, 0); assert.equal(levels.at(-1), 0);
  f.controller.setDistances(new Map([["a", 2]])); assert.equal(levels.at(-1), 1);
  f.controller.setDistances(new Map([["a", 7]])); assert.equal(levels.at(-1), .5);
  f.controller.setDistances(new Map([["a", 12]])); assert.equal(levels.at(-1), 0);
  assert.equal(f.audio.analysers[0].connections.length, 0, "local analysis must never feed mic audio to speakers");
  assert.deepEqual(gain.connections, [f.audio.analysers[1]], "remote activity measures the attenuated output");
  f.controller.disable();
  assert.ok([...f.audio.sources, ...f.audio.gains, ...f.audio.analysers].every((node) => node.disconnected));
});
test("peer constructor failure releases active microphone and context", async () => {
  const f = fixture("a", undefined, { createPeer: () => { throw new Error("Invalid ICE configuration"); } });
  await f.controller.enable(); assert.doesNotThrow(() => f.controller.receive(roster()));
  assert.equal(f.track.stopped, true); assert.equal(f.audioClosed(), true); assert.equal(f.states.at(-1)?.status, "error");
});
test("addTrack failure closes partially initialized peer and microphone", async () => {
  const peer = new FakePeer(); peer.addTrack = () => { throw new Error("Could not attach microphone"); };
  const f = fixture("a", undefined, { createPeer: () => peer as unknown as RTCPeerConnection });
  await f.controller.enable(); assert.doesNotThrow(() => f.controller.receive(roster()));
  assert.equal(peer.closed, true); assert.equal(f.track.stopped, true); assert.equal(f.states.at(-1)?.status, "error");
});
test("suspended playback after resume never starts microphone or advertises voice", async () => {
  let requested = false, closed = false;
  const f = fixture("a", async () => { requested = true; throw new Error("Must not request microphone"); }, {
    createAudio: () => ({ state: "suspended", resume: async () => {}, close: async () => { closed = true; } }) as unknown as AudioContext,
  });
  await f.controller.enable();
  assert.equal(requested, false); assert.equal(closed, true); assert.deepEqual(f.sent, []);
  assert.equal(f.states.at(-1)?.status, "error"); assert.match(f.states.at(-1)!.message, /playback is blocked/);
});
test("peer that floods ICE before SDP is closed without retaining an unbounded buffer", async () => {
  const f = fixture("z"); await f.controller.enable(); f.controller.receive(roster("a"));
  for (let i = 0; i < 129; i++) f.controller.receive({ type: "voice-signal", from: "a", sessionId: "first", signal: { kind: "ice", candidate: { candidate: `candidate:${i}` } } });
  await flush();
  assert.equal(f.peers[0].closed, true); assert.equal(f.states.at(-1)?.status, "enabled");
  assert.match(f.states.at(-1)!.message, /negotiation failed/); f.controller.disable();
});
test("voice starts with silent tracks; only explicit hold transmits and release silences", async () => {
  const f = fixture();
  f.controller.setTalking(true); await f.controller.enable();
  assert.equal(f.track.enabled, false); assert.equal(f.states.at(-1)?.talking, false);
  f.controller.receive(roster()); await flush(); assert.equal(f.track.enabled, false);
  f.controller.setTalking(true); assert.equal(f.track.enabled, true); assert.equal(f.states.at(-1)?.talking, true);
  f.controller.setTalking(false); assert.equal(f.track.enabled, false); assert.equal(f.states.at(-1)?.talking, false);
  f.controller.disable(); f.controller.setTalking(true); assert.equal(f.states.at(-1)?.talking, false);
});
test("local speaking requires energy and push-to-talk, bridges syllables, and emits only changed activity", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 });
  const f = fixture(); t.after(() => f.controller.disable()); await f.controller.enable();
  const meter = f.audio.analysers[0], speaking = () => f.states.at(-1)?.speakingPlayerIds;
  meter.level = .08;
  t.mock.timers.tick(80); assert.deepEqual(speaking(), [], "closed mic must not animate from stale samples");
  f.controller.setTalking(true); meter.level = 0;
  t.mock.timers.tick(80); assert.deepEqual(speaking(), [], "holding push-to-talk in silence is not speaking");
  meter.level = .03; t.mock.timers.tick(80); assert.deepEqual(speaking(), ["a"]);
  const updates = f.states.length;
  t.mock.timers.tick(160); assert.equal(f.states.length, updates, "steady speech must not publish every sample");
  meter.level = 0;
  t.mock.timers.tick(160); assert.deepEqual(speaking(), ["a"], "short pauses preserve the talking animation");
  t.mock.timers.tick(80); assert.deepEqual(speaking(), []);
  meter.level = .03; t.mock.timers.tick(80); assert.deepEqual(speaking(), ["a"]);
  f.controller.setTalking(false); assert.deepEqual(speaking(), [], "release must bypass the quiet hangover");
  f.controller.setTalking(true); t.mock.timers.tick(80); assert.deepEqual(speaking(), ["a"]);
  f.controller.mute(); assert.deepEqual(speaking(), []);
  const samples = meter.samples;
  f.controller.disable(); t.mock.timers.tick(1000);
  assert.equal(meter.samples, samples); assert.equal(meter.disconnected, true);
});
test("remote speaking follows audible connected streams and clears on range departure, track end, and disconnect", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 });
  const f = fixture("z"); t.after(() => f.controller.disable()); await f.controller.enable();
  f.controller.receive(roster("a"));
  const peer = f.peers[0], track = new FakeTrack(), speaking = () => f.states.at(-1)?.speakingPlayerIds;
  peer.connectionState = "connecting";
  peer.ontrack?.({ streams: [trackStream(track)], track });
  assert.equal(f.audio.analysers.length, 2, "attach remote playback when ontrack fires during ICE setup");
  const firstMeter = f.audio.analysers[1]; firstMeter.level = .05;
  t.mock.timers.tick(80); assert.deepEqual(speaking(), [], "attaching early must not mark an unconnected peer as speaking");
  assert.equal(firstMeter.samples, 0);
  peer.connectionState = "connected"; peer.onconnectionstatechange?.();
  assert.equal(f.audio.analysers[1], firstMeter, "connection completion preserves the attached playback graph");
  t.mock.timers.tick(80); assert.deepEqual(speaking(), [], "unknown position is inaudible");
  f.controller.setDistances(new Map([["a", 2]])); t.mock.timers.tick(80); assert.deepEqual(speaking(), ["a"]);
  const samples = firstMeter.samples;
  for (let i = 0; i < 20; i++) f.controller.setDistances(new Map([["a", 3]]));
  assert.equal(firstMeter.samples, samples, "position updates must not increase audio sampling frequency");
  f.controller.setDistances(new Map([["a", 12]])); assert.deepEqual(speaking(), []);
  f.controller.setDistances(new Map([["a", 2]])); t.mock.timers.tick(80); assert.deepEqual(speaking(), ["a"]);
  peer.connectionState = "disconnected"; peer.onconnectionstatechange?.();
  assert.deepEqual(speaking(), []); assert.equal(firstMeter.disconnected, true);
  peer.connectionState = "connected"; peer.onconnectionstatechange?.();
  f.audio.analysers[2].level = .05; t.mock.timers.tick(80); assert.deepEqual(speaking(), ["a"]);
  track.end(); assert.deepEqual(speaking(), []); assert.equal(f.audio.analysers[2].disconnected, true);
  const replacement = new FakeTrack(); peer.ontrack?.({ streams: [trackStream(replacement)], track: replacement });
  f.audio.analysers[3].level = .05; t.mock.timers.tick(80); assert.deepEqual(speaking(), ["a"]);
  f.controller.receive({ type: "voice-peers", peers: [], iceServers: [], radius: 12 });
  assert.deepEqual(speaking(), []); assert.equal(f.audio.analysers[3].disconnected, true);
  assert.equal(peer.closed, true);
});
test("suspended audio and microphone disconnection clear speaking immediately", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 });
  const f = fixture(); t.after(() => f.controller.disable()); await f.controller.enable();
  f.controller.setTalking(true); f.audio.analysers[0].level = .05;
  t.mock.timers.tick(80); assert.deepEqual(f.states.at(-1)?.speakingPlayerIds, ["a"]);
  f.audio.state = "suspended"; f.audio.onstatechange?.();
  assert.deepEqual(f.states.at(-1)?.speakingPlayerIds, []);
  f.audio.state = "running"; f.audio.onstatechange?.(); t.mock.timers.tick(80);
  assert.deepEqual(f.states.at(-1)?.speakingPlayerIds, ["a"]);
  f.track.end(); assert.deepEqual(f.states.at(-1)?.speakingPlayerIds, []);
  assert.equal(f.states.at(-1)?.status, "error"); assert.equal(f.audio.closed, true);
});

test("the welcome click's unlocked context is reused by the later room controller", async () => {
  const audio = new FakeAudio(); let creates = 0;
  const session = new VoiceAudioSession(() => { creates++; return audio as unknown as AudioContext; });
  await resumeVoiceAudio(session.getContext());
  const f = fixture("a", undefined, { createAudio: session.getContext });
  await f.controller.enable();
  assert.equal(creates, 1, "joining must not create a new, gesture-less context");
  assert.equal(f.states.at(-1)?.status, "enabled"); f.controller.disable();
  assert.equal(audio.closed, true);
  session.getContext(); assert.equal(creates, 2, "an explicit later enable can replace a closed context"); session.close();
});

test("a browser that never resolves resume leaves Starting with an actionable error and no microphone", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requested = false;
  const audio = new FakeAudio(); audio.state = "suspended"; audio.resume = () => new Promise(() => {});
  const f = fixture("a", async () => { requested = true; return trackStream(new FakeTrack()); }, { createAudio: () => audio as unknown as AudioContext });
  const pending = f.controller.enable();
  t.mock.timers.tick(2500); await pending;
  assert.equal(requested, false); assert.equal(audio.closed, true); assert.deepEqual(f.sent, []);
  assert.equal(f.states.at(-1)?.status, "error"); assert.match(f.states.at(-1)!.message, /playback is blocked/);
});

test("resume playback restores listening without reopening microphone or changing push-to-talk", async () => {
  let captures = 0;
  const track = new FakeTrack();
  const f = fixture("a", async () => { captures++; return trackStream(track); });
  await f.controller.enable(); f.controller.setTalking(true);
  f.audio.state = "suspended"; f.audio.onstatechange?.();
  assert.equal(f.states.at(-1)?.playbackBlocked, true);
  f.audio.resume = async () => { f.audio.state = "running"; };
  await f.controller.resumePlayback();
  assert.equal(f.states.at(-1)?.playbackBlocked, false); assert.equal(captures, 1); assert.equal(track.enabled, true);
  assert.deepEqual(f.sent.map((message) => message.type), ["voice-join"]); f.controller.disable();
});

test("remote audio has a silent decoding sink and releases it on disconnect, replacement and disable", async () => {
  const f = fixture("z"); await f.controller.enable(); f.controller.receive(roster("a"));
  const peer = f.peers[0], track = new FakeTrack(), stream = trackStream(track);
  peer.ontrack?.({ streams: [stream], track }); await flush();
  const output = f.remoteAudio[0];
  assert.equal(output.srcObject, stream); assert.equal(output.plays, 1);
  assert.equal(output.muted, true); assert.equal(output.volume, 0, "the media sink must never bypass distance attenuation");
  peer.connectionState = "disconnected"; peer.onconnectionstatechange?.();
  assert.equal(output.paused, true); assert.equal(output.srcObject, null);
  peer.connectionState = "connected"; peer.onconnectionstatechange?.(); await flush();
  assert.equal(f.remoteAudio.length, 2); assert.equal(f.remoteAudio[1].srcObject, stream);
  const replacement = new FakeTrack(); peer.ontrack?.({ streams: [trackStream(replacement)], track: replacement });
  assert.equal(f.remoteAudio[1].srcObject, null); f.controller.disable();
  assert.ok(f.remoteAudio.every((element) => element.paused && element.srcObject === null));
});

test("a blocked remote media sink can be resumed by a later user gesture", async () => {
  const output = new FakeRemoteAudio();
  output.play = async () => { throw new Error("NotAllowedError"); };
  const f = fixture("z", undefined, { createRemoteAudio: () => output as unknown as HTMLAudioElement });
  await f.controller.enable(); f.controller.receive(roster("a"));
  const track = new FakeTrack(); f.peers[0].ontrack?.({ streams: [trackStream(track)], track }); await flush();
  assert.equal(f.states.at(-1)?.playbackBlocked, true);
  output.play = async () => { output.paused = false; }; await f.controller.resumePlayback();
  assert.equal(f.states.at(-1)?.playbackBlocked, false); assert.equal(f.track.enabled, false);
  f.controller.disable();
});

test("audio diagnostics distinguish packets from decoded audio without exposing ICE addresses or credentials", async () => {
  const f = fixture("z"); await f.controller.enable(); f.controller.receive(roster("a"));
  const peer = f.peers[0]; peer.connectionState = "connected"; peer.iceConnectionState = "connected";
  peer.stats = new Map([
    ["transport", { id: "transport", type: "transport", selectedCandidatePairId: "pair" }],
    ["pair", { id: "pair", type: "candidate-pair", localCandidateId: "local", remoteCandidateId: "remote" }],
    ["local", { id: "local", type: "local-candidate", candidateType: "relay", address: "secret-address", usernameFragment: "secret-credential" }],
    ["remote", { id: "remote", type: "remote-candidate", candidateType: "host", address: "other-address" }],
    ["inbound", { id: "inbound", type: "inbound-rtp", kind: "audio", packetsReceived: 84, totalSamplesReceived: 0, totalAudioEnergy: 0 }],
    ["outbound", { id: "outbound", type: "outbound-rtp", kind: "audio", packetsSent: 36 }],
  ]);
  const report = (await f.controller.diagnostics()).join("\n");
  assert.match(report, /Route: relay/); assert.match(report, /Sent 36 \/ received 84 packets; decoded 0 samples/);
  assert.doesNotMatch(report, /secret|other-address/); assert.equal(f.track.enabled, false, "checking must never open transmission");
  f.controller.disable();
});

test("credential-only roster updates refresh retained WebRTC configurations and direct-only status", async () => {
  const f = fixture(); await f.controller.enable(); f.controller.receive(roster()); await flush();
  assert.match(f.states.at(-1)!.message, /Direct voice only/);
  const iceServers = [{ urls: "turns:turn.cloudflare.com:443?transport=tcp", username: "fake-user", credential: "fake-credential" }];
  const update = { ...roster(), iceServers };
  f.controller.receive(update); await flush();
  assert.equal(f.peers.length, 1, "unchanged sessions retain their connection");
  assert.deepEqual(f.peers[0].configurations, [{ iceServers }]);
  assert.doesNotMatch(f.states.at(-1)!.message, /Direct voice only/);
  f.controller.receive(update); assert.equal(f.peers[0].configurations.length, 1);
  f.controller.disable();
});
