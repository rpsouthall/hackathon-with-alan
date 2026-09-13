// Adapted from HeyGen's MIT reference. See HEYGEN-LICENSE.txt.
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';

export async function joinAvatarRoom(
  url: string, token: string, video: HTMLVideoElement, audio: HTMLAudioElement,
  onVideo: () => void, onDisconnect: () => void, signal?: AbortSignal,
  onAudioBlocked?: () => void,
) {
  signal?.throwIfAborted();
  const room = new Room({ adaptiveStream: true, dynacast: true });
  let disposed = false, deliveredVideo = false;
  let ownedVideo: HTMLMediaElement['srcObject'] = null;
  let ownedAudio: HTMLMediaElement['srcObject'] = null;
  let closing: Promise<void> | undefined;
  let resolveFrame!: () => void;
  let rejectStartup!: (error: Error) => void;
  const firstFrame = new Promise<void>(resolve => { resolveFrame = resolve; });
  const interrupted = new Promise<never>((_, reject) => { rejectStartup = reject; });
  void interrupted.catch(() => {});
  const checkFrame = () => {
    if (disposed || deliveredVideo || video.srcObject !== ownedVideo || video.readyState < 2 || video.videoWidth === 0) return;
    deliveredVideo = true; onVideo(); resolveFrame();
  };
  video.addEventListener('loadeddata', checkFrame);
  video.addEventListener('playing', checkFrame);
  const attach = (track: RemoteTrack) => {
    if (disposed) return;
    if (track.kind === Track.Kind.Video) {
      track.attach(video); ownedVideo = video.srcObject;
      void video.play().then(checkFrame).catch(() => {});
      checkFrame();
    }
    if (track.kind === Track.Kind.Audio) { track.attach(audio); ownedAudio = audio.srcObject; }
  };
  const timeout = setTimeout(() => {
    rejectStartup(new Error('The avatar video took too long to arrive.'));
    void disconnect();
  }, 30000);
  const aborted = () => {
    rejectStartup(new DOMException('Avatar connection cancelled.', 'AbortError'));
    void disconnect();
  };
  function disconnect(): Promise<void> {
    if (closing) return closing;
    disposed = true;
    clearTimeout(timeout); signal?.removeEventListener('abort', aborted);
    video.removeEventListener('loadeddata', checkFrame); video.removeEventListener('playing', checkFrame);
    room.removeAllListeners();
    closing = room.disconnect().finally(() => {
      // An older connection must not clear a newer stream on the same element.
      if (video.srcObject === ownedVideo) video.srcObject = null;
      if (audio.srcObject === ownedAudio) audio.srcObject = null;
    });
    return closing;
  }
  room.on(RoomEvent.TrackSubscribed, attach);
  room.on(RoomEvent.TrackUnsubscribed, track => {
    track.detach();
    if (!disposed && track.kind === Track.Kind.Video) onDisconnect();
  });
  room.on(RoomEvent.Disconnected, () => {
    if (disposed) return;
    rejectStartup(new Error('The avatar room disconnected.'));
    onDisconnect();
  });
  signal?.addEventListener('abort', aborted, { once: true });
  if (signal?.aborted) aborted();
  try {
    const connecting = room.connect(url, token).then(async () => {
      if (disposed) { await room.disconnect(); return; }
      room.remoteParticipants.forEach(p => p.trackPublications.forEach(publication => { if (publication.track) attach(publication.track); }));
    });
    await Promise.race([connecting, interrupted]);
    await Promise.race([firstFrame, interrupted]);
    signal?.throwIfAborted();
    await room.startAudio().catch(() => onAudioBlocked?.());
    clearTimeout(timeout);
    return { disconnect, enableAudio: () => room.startAudio() };
  } catch (error) { await disconnect(); throw error; }
}
