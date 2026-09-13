// ICE gathering can remain pending in embedded browsers. Give local candidates
// a short head start, then apply the server's answer so ICE checks can proceed.
// The original peer connection keeps gathering while the request is in flight.
export async function createConnectionOffer(connection, { waitMs = 1500 } = {}) {
  await connection.setLocalDescription(await connection.createOffer());
  if (connection.iceGatheringState !== 'complete') {
    await new Promise(resolve => {
      const done = () => {
        clearTimeout(timer);
        connection.removeEventListener('icegatheringstatechange', changed);
        resolve();
      };
      const changed = () => { if (connection.iceGatheringState === 'complete') done(); };
      const timer = setTimeout(done, waitMs);
      connection.addEventListener('icegatheringstatechange', changed);
      changed();
    });
  }
  const sdp = connection.localDescription?.sdp;
  if (!sdp) throw new Error('The browser could not create a voice connection offer.');
  return sdp;
}
