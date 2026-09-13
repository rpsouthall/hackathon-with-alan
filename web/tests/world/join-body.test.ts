import test from "node:test";
import assert from "node:assert/strict";
import { readJoinBody } from "../../lib/world/join-body";

function request(chunks: Uint8Array[], cancelled: () => void = () => {}) {
  let offset = 0;
  return new Request("https://kyoto.example/api/world/join", {
    method: "POST", duplex: "half",
    body: new ReadableStream({ pull(controller) { if (offset < chunks.length) controller.enqueue(chunks[offset++]); else controller.close(); }, cancel: cancelled }),
  } as RequestInit);
}
test("join body handles Japanese split across network chunks", async () => {
  const text = '{"name":"葵","roomId":"kyoto"}', bytes = new TextEncoder().encode(text);
  assert.equal(await readJoinBody(request([...bytes].map((byte) => Uint8Array.of(byte)))), text);
});
test("join body cancels oversized streams using bytes rather than character count", async () => {
  let cancelled = false;
  assert.equal(await readJoinBody(request([new Uint8Array(1024), new Uint8Array(1025), new Uint8Array(1024)], () => { cancelled = true; })), null);
  assert.equal(cancelled, true);
  assert.equal(await readJoinBody(new Request("https://kyoto.example", { method: "POST", headers: { "content-length": "999999" }, body: "{}" })), null);
});
