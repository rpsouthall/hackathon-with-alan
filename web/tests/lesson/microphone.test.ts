import test from 'node:test';
import assert from 'node:assert/strict';
import { startMicCapture } from '../../lib/lesson/mic-capture';

test('leaving while microphone permission is pending stops a stream that arrives later', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  let provideStream!: (stream: MediaStream) => void;
  let microphoneStopped = false;
  let audioClosed = false;
  class PendingAudioContext {
    state = 'suspended';
    resume() { return new Promise<void>(() => {}); }
    close() { this.state = 'closed'; audioClosed = true; return Promise.resolve(); }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: PendingAudioContext });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { getUserMedia: () => new Promise<MediaStream>(resolve => { provideStream = resolve; }) },
  } });
  try {
    const controller = new AbortController();
    const startup = startMicCapture(() => assert.fail('Cancelled microphone must never send audio'), undefined, controller.signal);
    controller.abort();
    await assert.rejects(startup, { name: 'AbortError' });
    provideStream({ getTracks: () => [{ stop: () => { microphoneStopped = true; } }] } as unknown as MediaStream);
    await Promise.resolve();
    assert.equal(microphoneStopped, true);
    assert.equal(audioClosed, true);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
    if (originalContext) Object.defineProperty(globalThis, 'AudioContext', originalContext); else Reflect.deleteProperty(globalThis, 'AudioContext');
  }
});
