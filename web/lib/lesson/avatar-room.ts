// Adapted from HeyGen's MIT reference. See HEYGEN-LICENSE.txt.
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';

export async function joinAvatarRoom(url: string, token: string, video: HTMLVideoElement, audio: HTMLAudioElement, onVideo: () => void, onDisconnect: () => void) {
  const room = new Room({ adaptiveStream: true, dynacast: true });
  const attach = (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Video) { track.attach(video); onVideo(); }
    if (track.kind === Track.Kind.Audio) track.attach(audio);
  };
  room.on(RoomEvent.TrackSubscribed, attach);
  room.on(RoomEvent.TrackUnsubscribed, track => track.detach());
  room.on(RoomEvent.Disconnected, onDisconnect);
  const disconnect = async () => {
    room.removeAllListeners();
    room.remoteParticipants.forEach(p => p.trackPublications.forEach(publication => publication.track?.detach()));
    await room.disconnect(); video.srcObject = null; audio.srcObject = null;
  };
  try {
    await room.connect(url, token);
    room.remoteParticipants.forEach(p => p.trackPublications.forEach(publication => { if (publication.track) attach(publication.track); }));
    await room.startAudio().catch(() => {});
    return { disconnect, enableAudio: () => room.startAudio() };
  } catch (error) { await disconnect(); throw error; }
}
