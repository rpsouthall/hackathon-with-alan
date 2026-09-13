/**
 * Microphone → base64 PCM16 mono @ 24kHz, via an AudioWorklet.
 *
 * Deliberately NO voice-activity detection: GPT-Live is full-duplex and
 * decides turn-taking itself, hearing the same audio with the conversation as
 * context. The browser only does I/O. Downsampling happens on the audio thread
 * because doing it on the main thread drops frames whenever the page renders.
 */

const TARGET_SAMPLE_RATE = 24000;

const WORKLET_CODE = `
class PCMDownsampler extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = (options.processorOptions && options.processorOptions.targetRate) || 24000;
    this.ratio = sampleRate / this.targetRate;
    this.pos = 0;
    this.batch = new Int16Array(2400); this.used = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];
    const out = [];
    for (; this.pos < ch.length; this.pos += this.ratio) {
      const start = Math.floor(this.pos);
      const end = Math.min(ch.length, Math.ceil(this.pos + this.ratio));
      let sum = 0, cnt = 0;
      for (let j = start; j < end; j++) { sum += ch[j]; cnt++; }
      out.push(cnt ? sum / cnt : (ch[start] || 0));
    }
    this.pos -= ch.length;
    const pcm = new Int16Array(out.length);
    for (let k = 0; k < out.length; k++) {
      let s = Math.max(-1, Math.min(1, out[k]));
      pcm[k] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    for (let i = 0; i < pcm.length; i++) {
      this.batch[this.used++] = pcm[i];
      if (this.used === this.batch.length) {
        this.port.postMessage(this.batch.buffer, [this.batch.buffer]);
        this.batch = new Int16Array(2400); this.used = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-downsampler', PCMDownsampler);
`;

export interface MicCapture {
  stop: () => void;
  /**
   * Mute by disabling the track, not by pausing capture: a disabled track
   * renders silence, so the worklet keeps shipping frames and the model hears
   * a continuous (silent) stream — turn detection stays with the model.
   */
  setMuted: (muted: boolean) => void;
  /**
   * Taps the same mic source the worklet consumes — for UI (the frequency
   * bars on the mic button). Muting flattens it automatically: a disabled
   * track renders silence into the analyser too.
   */
  analyser: AnalyserNode;
}

export async function startMicCapture(
  onAudio: (base64Pcm24k: string) => void,
  onLevel?: (rms01: number) => void,
  signal?: AbortSignal,
): Promise<MicCapture> {
  signal?.throwIfAborted();
  // Start/resume sound directly in the click handler, before awaiting permission.
  const audioContext = new AudioContext();
  let stream: MediaStream | undefined;
  let abandoned = false;
  const audioReady = waitForMedia(audioContext.resume(), 'Click Start live avatar again to enable browser audio.', signal);
  // Attach immediately: permission may stay pending after audio setup rejects.
  void audioReady.catch(() => {});
  try {
  // Echo cancellation matters more than usual here: the avatar's own voice
  // plays out of the same machine the mic is listening on, and without it the
  // model hears itself and answers itself.
  const requestedStream = navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  }).then(received => {
    if (abandoned || signal?.aborted) {
      received.getTracks().forEach(track => track.stop());
      throw new DOMException('Microphone setup cancelled.', 'AbortError');
    }
    stream = received;
    stream.getAudioTracks().forEach(track => { track.enabled = false; });
    return received;
  });
  const [capturedStream] = await Promise.all([
    waitForMedia(requestedStream, 'Allow microphone access in your browser, then try again.', signal),
    audioReady,
  ]);

  const blob = new Blob([WORKLET_CODE], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    await waitForMedia(audioContext.audioWorklet.addModule(url), 'Microphone audio setup took too long. Please try again.', signal);
  } finally {
    URL.revokeObjectURL(url);
  }

  signal?.throwIfAborted();
  const source = audioContext.createMediaStreamSource(capturedStream);
  const worklet = new AudioWorkletNode(audioContext, "pcm-downsampler", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { targetRate: TARGET_SAMPLE_RATE },
  });

  worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    const bytes = new Uint8Array(e.data);
    if (bytes.length === 0) return;
    if (onLevel) {
      // Level is a UI courtesy (the mic meter), computed off the same chunk
      // that ships — what the meter shows is exactly what the model hears.
      const samples = new Int16Array(e.data);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i] ?? 0;
        sum += s * s;
      }
      onLevel(Math.sqrt(sum / samples.length) / 0x8000);
    }
    onAudio(base64FromBytes(bytes));
  };

  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  source.connect(worklet);
  // A worklet only runs while connected to the destination, but its output is
  // the raw mic — routing it through a muted gain keeps it pumping without
  // playing the user back to themselves.
  const mute = audioContext.createGain();
  mute.gain.value = 0;
  worklet.connect(mute);
  mute.connect(audioContext.destination);

  return {
    analyser,
    setMuted: (muted) => {
      for (const track of capturedStream.getAudioTracks()) track.enabled = !muted;
    },
    stop: () => {
      worklet.port.onmessage = null;
      worklet.port.close();
      worklet.disconnect();
      mute.disconnect();
      analyser.disconnect();
      source.disconnect();
      capturedStream.getTracks().forEach((t) => t.stop());
      if (audioContext.state !== 'closed') void audioContext.close();
    },
  };
  } catch (error) {
    abandoned = true;
    stream?.getTracks().forEach(track => track.stop());
    if (audioContext.state !== 'closed') void audioContext.close();
    if (error instanceof DOMException && error.name === 'NotAllowedError') throw new Error('Allow microphone access in your browser, then try again.');
    throw error;
  }
}

function waitForMedia<T>(pending: Promise<T>, message: string, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(new DOMException('Microphone setup cancelled.', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(message)); }, 15000);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    pending.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
