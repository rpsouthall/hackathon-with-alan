import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export type EnvironmentProgress = { stage: "download" | "prepare"; loaded: number; total: number };
type LoadOptions = { signal: AbortSignal; onProgress?: (progress: EnvironmentProgress) => void };
const COMPRESSED_BYTES = 3_010_267;
const MAX_BYTES = 64 * 1024 * 1024;

/** The compressed file is lossless: the geometry and collision contract stay intact. */
export async function decodeEnvironment(bytes: Uint8Array): Promise<ArrayBuffer> {
  let data = bytes;
  if (data[0] === 0x1f && data[1] === 0x8b) {
    const compressed = new Blob([new Uint8Array(data)]).stream();
    data = new Uint8Array(await new Response(compressed.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  }
  const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 12 || header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== data.length) {
    throw new Error("The city download was incomplete. Please try again.");
  }
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

async function download(url: string, options: LoadOptions, expected: number) {
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal.reason);
  options.signal.addEventListener("abort", abort, { once: true });
  let idle: ReturnType<typeof setTimeout>;
  const resetIdle = () => { clearTimeout(idle); idle = setTimeout(() => controller.abort(new Error("The city download paused. Please try again.")), 25_000); };
  const deadline = setTimeout(() => controller.abort(new Error("The city is taking too long to download. Please try again.")), 120_000);
  resetIdle();
  try {
    options.signal.throwIfAborted();
    const response = await fetch(url, { signal: controller.signal, credentials: "same-origin" });
    if (!response.ok) throw Object.assign(new Error(`City download failed (${response.status}).`), { status: response.status });
    const total = Number(response.headers.get("content-length")) || expected;
    let loaded = 0;
    const chunks: Uint8Array[] = [];
    options.onProgress?.({ stage: "download", loaded, total });
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          loaded += value.length;
          if (loaded > MAX_BYTES) throw new Error("The city download is unexpectedly large.");
          chunks.push(value); resetIdle();
          options.onProgress?.({ stage: "download", loaded, total });
        }
      } finally { reader.releaseLock(); }
    } else {
      const data = new Uint8Array(await response.arrayBuffer());
      loaded = data.length; chunks.push(data);
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } finally {
    controller.abort(); clearTimeout(idle!); clearTimeout(deadline);
    options.signal.removeEventListener("abort", abort);
  }
}

export async function loadEnvironment(url: string, options: LoadOptions) {
  const compressed = typeof DecompressionStream !== "undefined" && /\/kyoto_city_lod1\.glb(?:\?|$)/.test(url);
  const compressedUrl = url.replace(/kyoto_city_lod1\.glb(?=\?|$)/, "kyoto_city_lod1.glb.gz");
  let bytes: Uint8Array;
  try {
    bytes = await download(compressed ? compressedUrl : url, options, compressed ? COMPRESSED_BYTES : 0);
  } catch (error) {
    // A partial deployment or an older asset server may only have the original.
    if (!options.signal.aborted && compressed && [404, 415].includes((error as { status?: number }).status ?? 0)) {
      bytes = await download(url, options, 0);
    } else throw error;
  }
  options.signal.throwIfAborted();
  options.onProgress?.({ stage: "prepare", loaded: bytes.length, total: bytes.length });
  const buffer = await decodeEnvironment(bytes);
  options.signal.throwIfAborted();
  const base = new URL(".", new URL(url, globalThis.location?.href ?? "http://localhost/")).href;
  return new GLTFLoader().parseAsync(buffer, base);
}
