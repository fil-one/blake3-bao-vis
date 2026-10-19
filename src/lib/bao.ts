import bao from 'blake3-bao/bao.js';

const { chunkGroupCV, parentCV, constantTimeEqual } = bao;

/** BLAKE3's chunk: the unit a chunk log counts. */
export const CHUNK_SIZE = 1024;
/** The outboard's size prefix: the body size as 8 little-endian bytes. */
export const HEADER_SIZE = 8;
/** One parent entry: the chaining values of its two children. */
export const PARENT_SIZE = 64;
/** The largest chunk log whose block size is a safe integer here. */
export const MAX_CHUNK_LOG = 42;

/** Block size in bytes for a chunk log (a base-2 exponent of chunks). */
export function blockSize(chunkLog: number): number {
  return CHUNK_SIZE * 2 ** chunkLog;
}

/** Number of blocks a body of this size has at a chunk log; an empty body has one. */
export function blocksIn(size: number, chunkLog: number): number {
  return Math.max(1, Math.ceil(size / blockSize(chunkLog)));
}

/** Byte offsets at which blocks start, after the first: the interior boundaries. */
export function blockBoundaries(size: number, chunkLog: number): number[] {
  const bs = blockSize(chunkLog);
  const out: number[] = [];
  for (let off = bs; off < size; off += bs) out.push(off);
  return out;
}

export interface OutboardInfo {
  /** The body size the outboard's prefix records. */
  size: number;
  /** Blocks the body has at the chunk log. */
  blocks: number;
}

/** Checks an outboard against the chunk log it is claimed to be at: the size
 * prefix must be followed by exactly one 64-byte parent entry per block but
 * one. Mirrors Ingot's blake3tree.OutboardBlocks. */
export function parseOutboard(outboard: Uint8Array, chunkLog: number): OutboardInfo {
  if (!Number.isInteger(chunkLog) || chunkLog < 0 || chunkLog > MAX_CHUNK_LOG) {
    throw new Error(`chunk log ${chunkLog} is not an integer between 0 and ${MAX_CHUNK_LOG}`);
  }
  if (outboard.length < HEADER_SIZE || (outboard.length - HEADER_SIZE) % PARENT_SIZE !== 0) {
    throw new Error(
      `${outboard.length} bytes is not an 8-byte size prefix plus 64-byte parent entries`,
    );
  }
  const view = new DataView(outboard.buffer, outboard.byteOffset, outboard.byteLength);
  const size64 = view.getBigUint64(0, true);
  if (size64 > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`outboard size prefix ${size64} is too large`);
  const size = Number(size64);
  const blocks = blocksIn(size, chunkLog);
  const parents = (outboard.length - HEADER_SIZE) / PARENT_SIZE;
  if (parents !== blocks - 1) {
    throw new Error(
      `outboard has ${parents} parent entries but a ${size}-byte body at chunk log ${chunkLog} has ${blocks} blocks`,
    );
  }
  return { size, blocks };
}

/** Widens the inclusive byte range [a, b] to the block-aligned inclusive range
 * a verifier needs: down to a block boundary and up to one, or to the body's
 * end. Mirrors Ingot's blake3tree.AlignedRange. */
export function alignedRange(a: number, b: number, chunkLog: number, size: number): [number, number] {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < a) {
    throw new Error(`range ${a}-${b} is not ascending`);
  }
  if (a >= size) throw new Error(`range starts at ${a} but the body is ${size} bytes`);
  const bs = blockSize(chunkLog);
  const start = Math.floor(a / bs) * bs;
  const endBlocks = Math.floor(b / bs) + 1;
  const end = endBlocks >= blocksIn(size, chunkLog) ? size - 1 : endBlocks * bs - 1;
  return [start, end];
}

export interface BlockResult {
  index: number;
  offset: number;
  length: number;
  ok: boolean;
}

/** A node of the tree over the blocks: the half-open block range it covers. */
export interface TreeNode {
  /** First block under the node. */
  lo: number;
  /** One past the last block under the node. */
  hi: number;
  /** Rows below the root. */
  depth: number;
  /** The node's parent entry index in the outboard, in pre-order; null for a block. */
  entry: number | null;
  /** The byte span the node covers, end exclusive. */
  start: number;
  end: number;
}

/** The key a node is referred to by in a trace. */
export function nodeKey(lo: number, hi: number): string {
  return `${lo}-${hi}`;
}

/**
 * What a range verification read: the parents whose hash it recomputed, the
 * nodes whose chaining value it took from a parent entry without descending
 * (the proof's siblings), and the parents that failed to chain. Blocks it
 * hashed are the BlockResults. Keys are nodeKey(lo, hi).
 */
export interface VerificationTrace {
  checked: string[];
  trusted: string[];
  failed: string[];
}

export interface RangeVerification {
  ok: boolean;
  blocks: BlockResult[];
  trace: VerificationTrace;
}

/** The number of blocks in the left subtree of a tree over `count` blocks:
 * the largest power of two strictly less than the count. */
function leftCount(count: number): number {
  let l = 1;
  while (l * 2 < count) l *= 2;
  return l;
}

/**
 * The tree over a body's blocks, row by row from the root, in the shape the
 * outboard is laid out in: every node above the bottom row is one 64-byte
 * entry, numbered in pre-order, and the bottom row is the blocks.
 */
export function layoutTree(size: number, chunkLog: number): TreeNode[][] {
  const bs = blockSize(chunkLog);
  const blocks = blocksIn(size, chunkLog);
  const rows: TreeNode[][] = [];
  let entry = 0;
  const visit = (lo: number, hi: number, depth: number) => {
    const count = hi - lo;
    const node: TreeNode = {
      lo,
      hi,
      depth,
      entry: count > 1 ? entry++ : null,
      start: lo * bs,
      end: Math.min(hi * bs, size),
    };
    (rows[depth] ??= []).push(node);
    if (count > 1) {
      const mid = lo + leftCount(count);
      visit(lo, mid, depth + 1);
      visit(mid, hi, depth + 1);
    }
  };
  visit(0, blocks, 0);
  return rows;
}

/**
 * Verifies `data`, which starts at `offset` in the body, block by block
 * against the Bao outboard and the body's root. The offset must be a
 * multiple of the block size and the data must hold whole blocks, except
 * that it may end at the body's end. The outboard is walked in its
 * pre-order layout, checking each parent against its expected chaining
 * value on the way down and skipping subtrees the data does not touch.
 * Mirrors the contract of Ingot's blake3tree.VerifyBlocks.
 */
export function verifyRange(
  outboard: Uint8Array,
  chunkLog: number,
  root: Uint8Array,
  data: Uint8Array,
  offset: number,
): RangeVerification {
  const { size, blocks } = parseOutboard(outboard, chunkLog);
  const bs = blockSize(chunkLog);
  const chunksPerBlock = 2 ** chunkLog;
  if (root.length !== 32) throw new Error(`root is ${root.length} bytes, want 32`);
  if (!Number.isInteger(offset) || offset < 0 || offset % bs !== 0) {
    throw new Error(`offset ${offset} is not a non-negative multiple of the block size ${bs}`);
  }
  if (offset + data.length > size) {
    throw new Error(`data runs ${offset + data.length - size} bytes past the body's end`);
  }
  if (data.length === 0 && size > 0) throw new Error('no data to verify');
  if (data.length % bs !== 0 && offset + data.length !== size) {
    throw new Error(
      `data ends ${data.length % bs} bytes into a block; a verifiable range holds whole blocks or ends at the body's end (${size})`,
    );
  }

  const firstBlock = Math.floor(offset / bs);
  const lastBlock = data.length === 0 ? firstBlock : Math.floor((offset + data.length - 1) / bs);
  const results: BlockResult[] = [];
  const trace: VerificationTrace = { checked: [], trusted: [], failed: [] };

  const blockCV = (index: number, isRoot: boolean): Uint8Array => {
    const start = index * bs - offset;
    const end = Math.min(start + bs, data.length);
    return chunkGroupCV(data.subarray(start, end), index * chunksPerBlock, isRoot);
  };

  // Single-block body: no parents, the block is the root.
  if (blocks === 1) {
    const ok = constantTimeEqual(blockCV(0, true), root);
    results.push({ index: 0, offset: 0, length: data.length, ok });
    return { ok, blocks: results, trace };
  }

  let pos = HEADER_SIZE;
  const walk = (lo: number, hi: number, expected: Uint8Array, isRoot: boolean): boolean => {
    const count = hi - lo;
    if (count === 1) {
      const ok = constantTimeEqual(blockCV(lo, isRoot), expected);
      results.push({ index: lo, offset: lo * bs, length: Math.min(bs, size - lo * bs), ok });
      return ok;
    }
    const left = outboard.subarray(pos, pos + 32);
    const right = outboard.subarray(pos + 32, pos + PARENT_SIZE);
    pos += PARENT_SIZE;
    if (!constantTimeEqual(parentCV(left, right, isRoot), expected)) {
      // The subtree's parent does not chain to the root: every wanted block
      // under it fails, whatever its bytes.
      trace.failed.push(nodeKey(lo, hi));
      for (let i = Math.max(lo, firstBlock); i <= Math.min(hi - 1, lastBlock); i++) {
        results.push({ index: i, offset: i * bs, length: Math.min(bs, size - i * bs), ok: false });
      }
      pos += PARENT_SIZE * (count - 2);
      return false;
    }
    trace.checked.push(nodeKey(lo, hi));
    const mid = lo + leftCount(count);
    let ok = true;
    if (mid - 1 >= firstBlock && lo <= lastBlock) {
      ok = walk(lo, mid, left, false) && ok;
    } else {
      trace.trusted.push(nodeKey(lo, mid));
      pos += PARENT_SIZE * (mid - lo - 1);
    }
    if (hi - 1 >= firstBlock && mid <= lastBlock) {
      ok = walk(mid, hi, right, false) && ok;
    } else {
      trace.trusted.push(nodeKey(mid, hi));
      pos += PARENT_SIZE * (hi - mid - 1);
    }
    return ok;
  };

  const ok = walk(0, blocks, root, true);
  results.sort((a, b) => a.index - b.index);
  return { ok, blocks: results, trace };
}

/** Whole-object verification: the data must be the entire body. */
export function verifyWhole(outboard: Uint8Array, chunkLog: number, root: Uint8Array, data: Uint8Array): boolean {
  return bao.baoVerifyIroh(outboard, root, data, chunkLog);
}
