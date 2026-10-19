import { CID } from 'multiformats/cid';
import * as Digest from 'multiformats/hashes/digest';

/** The raw codec: the CID identifies bytes, not a DAG node. */
export const RAW_CODEC = 0x55;
/** The BLAKE3 multihash code. */
export const BLAKE3_CODE = 0x1e;

/** The CID Ingot returns in x-cid for a body with this BLAKE3 digest. */
export function cidOf(digest: Uint8Array): CID {
  return CID.createV1(RAW_CODEC, Digest.create(BLAKE3_CODE, digest));
}

/** Parses a CID string and returns its 32-byte BLAKE3 digest. */
export function digestOf(cid: string): Uint8Array {
  const c = CID.parse(cid.trim());
  if (c.code !== RAW_CODEC) throw new Error(`CID codec is 0x${c.code.toString(16)}, want raw (0x55)`);
  if (c.multihash.code !== BLAKE3_CODE) {
    throw new Error(`CID multihash is 0x${c.multihash.code.toString(16)}, want BLAKE3 (0x1e)`);
  }
  if (c.multihash.digest.length !== 32) throw new Error(`digest is ${c.multihash.digest.length} bytes, want 32`);
  return c.multihash.digest;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
