import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionOffer } from '../public/webrtc-offer.mjs';

class FakePeer extends EventTarget {
  iceGatheringState = 'gathering';
  async createOffer() { return { type: 'offer', sdp: 'v=0 initial' }; }
  async setLocalDescription(offer) { this.localDescription = offer; }
}
test('a stalled ICE gather still submits a usable offer', async () => {
  const peer = new FakePeer();
  assert.equal(await createConnectionOffer(peer, { waitMs: 5 }), 'v=0 initial');
  assert.equal(peer.iceGatheringState, 'gathering');
});
test('uses gathered SDP as soon as gathering completes', async () => {
  const peer = new FakePeer();
  const pending = createConnectionOffer(peer);
  setTimeout(() => {
    peer.localDescription = { type: 'offer', sdp: 'v=0 with candidates' };
    peer.iceGatheringState = 'complete';
    peer.dispatchEvent(new Event('icegatheringstatechange'));
  }, 5);
  assert.equal(await pending, 'v=0 with candidates');
});
test('missing SDP fails before an API request can be made', async () => {
  const peer = new FakePeer(); peer.iceGatheringState = 'complete';
  peer.setLocalDescription = async () => {};
  await assert.rejects(createConnectionOffer(peer), /could not create/);
});
