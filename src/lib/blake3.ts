import blake3 from 'blake3-bao/blake3.js';

/** Slice size for reading a File into the hasher: large enough to amortise the
 * read, small enough that the awaits between slices keep the page responsive. */
const SLICE = 8 * 1024 * 1024;

let simd: Promise<boolean> | undefined;

/** Enables blake3-bao's WASM SIMD path once; safe to call repeatedly. */
export function initBlake3(): Promise<boolean> {
  simd ??= blake3.initSimd().catch(() => false);
  return simd;
}

/** BLAKE3 digest of a File, read slice by slice. */
export async function hashFile(
  file: File,
  onProgress?: (bytesHashed: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  await initBlake3();
  const hasher = blake3.createHasher();
  for (let offset = 0; offset < file.size; offset += SLICE) {
    signal?.throwIfAborted();
    const buf = new Uint8Array(await file.slice(offset, offset + SLICE).arrayBuffer());
    hasher.update(buf);
    onProgress?.(Math.min(offset + SLICE, file.size));
  }
  return hasher.finalize();
}

/** A streaming hasher over a web ReadableStream of bytes. Returns the digest
 * and the bytes seen. */
export async function hashStream(
  stream: ReadableStream<Uint8Array>,
  onProgress?: (bytesHashed: number) => void,
): Promise<{ digest: Uint8Array; length: number }> {
  await initBlake3();
  const hasher = blake3.createHasher();
  const reader = stream.getReader();
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hasher.update(value);
    length += value.length;
    onProgress?.(length);
  }
  return { digest: hasher.finalize(), length };
}

export function hashBytes(data: Uint8Array): Uint8Array {
  return blake3.hash(data);
}
