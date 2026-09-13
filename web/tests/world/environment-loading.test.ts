import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { decodeEnvironment, loadEnvironment } from "../../lib/world/load-environment";

test("compressed city restores every byte of the verified geometry", async () => {
  const raw = await readFile(new URL("../../public/models/kyoto/kyoto_city_lod1.glb", import.meta.url));
  const gzip = await readFile(new URL("../../public/models/kyoto/kyoto_city_lod1.glb.gz", import.meta.url));
  assert.ok(gzip.length < raw.length / 4, "Transfer size should drop by more than 75%");
  const decoded = Buffer.from(await decodeEnvironment(gzip));
  assert.deepEqual(decoded, raw);
  assert.equal(createHash("sha256").update(decoded).digest("hex"), "9a81fc6fe459477544be3091b4a3f55023439fd9d5823d7285d23e6d07040169");
  // Some CDNs/browser stacks automatically decode a gzip response.
  assert.deepEqual(Buffer.from(await decodeEnvironment(raw)), raw);
});

test("incomplete or non-model downloads fail instead of leaving a loading placeholder", async () => {
  const raw = await readFile(new URL("../../public/models/kyoto/kyoto_city_lod1.glb", import.meta.url));
  await assert.rejects(decodeEnvironment(raw.subarray(0, raw.length - 1)), /incomplete/);
  await assert.rejects(decodeEnvironment(Buffer.from("<html>Sign in</html>")), /incomplete/);
  await assert.rejects(decodeEnvironment(new Uint8Array()), /incomplete/);
});

test("cancelled worlds do not start another model download", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadEnvironment("/models/kyoto/kyoto_city_lod1.glb", { signal: controller.signal }), { name: "AbortError" });
});

test("an older server without gzip falls back to raw and reports preparation", async (t) => {
  const raw = await readFile(new URL("../../public/models/kyoto/kyoto_city_lod1.glb", import.meta.url));
  const requests: string[] = [], stages: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    requests.push(url);
    return url.endsWith(".gz") ? new Response(null, {status: 404}) : new Response(raw, {headers: {"content-length": String(raw.length)}});
  });
  const model = await loadEnvironment("/models/kyoto/kyoto_city_lod1.glb", { signal: new AbortController().signal, onProgress: ({stage}) => stages.push(stage) });
  assert.deepEqual(requests, ["/models/kyoto/kyoto_city_lod1.glb.gz", "/models/kyoto/kyoto_city_lod1.glb"]);
  assert.ok(model.scene.children.length > 0);
  assert.ok(stages.includes("download")); assert.equal(stages.at(-1), "prepare");
});
