import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { alignedRange, blockBoundaries, blockSize, blocksIn, layoutTree, nodeKey, parseOutboard, verifyRange, verifyWhole } from '../src/lib/bao';
import { hashBytes } from '../src/lib/blake3';
import { cidOf, digestOf } from '../src/lib/cid';

const FIXTURES = path.join(__dirname, 'fixtures');

interface Vector {
  name: string;
  data: Uint8Array;
  cid: string;
  chunkLog: number;
  outboard: Uint8Array;
}

/** Loads a fixture produced by `ingot blake3 hash --bao`. */
function load(dir: string, bin: string, bao: string): Vector {
  const data = new Uint8Array(readFileSync(path.join(dir, bin)));
  const text = readFileSync(path.join(dir, bao), 'utf8');
  const field = (k: string) => {
    const m = text.match(new RegExp(`^${k} (.*)$`, 'm'));
    if (!m) throw new Error(`${bao}: no ${k}`);
    return m[1].trim();
  };
  return {
    name: bao,
    data,
    cid: field('CID'),
    chunkLog: Number(field('ChunkLog')),
    outboard: new Uint8Array(Buffer.from(field('Outboard'), 'base64')),
  };
}

const small = [
  ['f0.bin', 'f0.bao'],
  ['f1.bin', 'f1.bao'],
  ['f1024.bin', 'f1024.bao'],
  ['f1025.bin', 'f1025.bao'],
  ['f16384.bin', 'f16384.bao'],
  ['f16385.bin', 'f16385.bao'],
  ['f50000.bin', 'f50000.bao'],
  ['f50000.bin', 'f50000.cl0.bao'],
  ['f65536.bin', 'f65536.bao'],
  ['f65536.bin', 'f65536.cl2.bao'],
].map(([bin, bao]) => load(FIXTURES, bin, bao));

// Larger vectors generated into the session scratchpad, when present.
const SCRATCH = process.env.BAO_VECTORS;
const large =
  SCRATCH && existsSync(SCRATCH)
    ? [
        ['f1000000.bin', 'f1000000.bao'],
        ['f9000000.bin', 'f9000000.bao'],
        ['f9000000.bin', 'f9000000.cl1.bao'],
      ].map(([bin, bao]) => load(SCRATCH, bin, bao))
    : [];

const vectors = [...small, ...large];

describe('CID', () => {
  it.each(vectors.map((v) => [v.name, v]))('%s: blake3-bao digest matches ingot', (_, v) => {
    expect(cidOf(hashBytes(v.data)).toString()).toBe(v.cid);
    expect(Buffer.from(digestOf(v.cid))).toEqual(Buffer.from(hashBytes(v.data)));
  });
});

describe('outboard', () => {
  it.each(vectors.map((v) => [v.name, v]))('%s: parses with the right block count', (_, v) => {
    const info = parseOutboard(v.outboard, v.chunkLog);
    expect(info.size).toBe(v.data.length);
    expect(info.blocks).toBe(blocksIn(v.data.length, v.chunkLog));
  });

  it('rejects a chunk log that disagrees with the entry count', () => {
    const v = small.find((x) => x.name === 'f50000.bao')!;
    expect(() => parseOutboard(v.outboard, 3)).toThrow(/parent entries/);
  });
});

describe('whole-object verification', () => {
  it.each(vectors.map((v) => [v.name, v]))('%s: verifies', (_, v) => {
    const root = digestOf(v.cid);
    expect(verifyWhole(v.outboard, v.chunkLog, root, v.data)).toBe(true);
    const r = verifyRange(v.outboard, v.chunkLog, root, v.data, 0);
    expect(r.ok).toBe(true);
    expect(r.blocks.length).toBe(blocksIn(v.data.length, v.chunkLog));
    expect(r.blocks.every((b) => b.ok)).toBe(true);
  });
});

describe('range verification', () => {
  const multi = vectors.filter((v) => blocksIn(v.data.length, v.chunkLog) > 1);

  it.each(multi.map((v) => [v.name, v]))('%s: every aligned range verifies', (_, v) => {
    const root = digestOf(v.cid);
    const bs = blockSize(v.chunkLog);
    const blocks = blocksIn(v.data.length, v.chunkLog);
    // Every single block, plus a few multi-block spans.
    const spans: [number, number][] = [];
    for (let i = 0; i < blocks; i++) spans.push([i, i]);
    spans.push([0, blocks - 1], [1, blocks - 1], [0, Math.max(0, blocks - 2)]);
    if (blocks > 3) spans.push([1, blocks - 2], [Math.floor(blocks / 2), Math.floor(blocks / 2) + 1]);
    for (const [a, b] of spans) {
      const start = a * bs;
      const end = Math.min((b + 1) * bs, v.data.length);
      const r = verifyRange(v.outboard, v.chunkLog, root, v.data.subarray(start, end), start);
      expect(r.ok, `${v.name} blocks ${a}-${b}`).toBe(true);
      expect(r.blocks.map((x) => x.index)).toEqual(Array.from({ length: b - a + 1 }, (_, i) => a + i));
    }
  });

  it.each(multi.map((v) => [v.name, v]))('%s: a flipped byte fails only its block', (_, v) => {
    const root = digestOf(v.cid);
    const bs = blockSize(v.chunkLog);
    const blocks = blocksIn(v.data.length, v.chunkLog);
    const corrupt = new Uint8Array(v.data);
    const victim = Math.min(1, blocks - 1);
    corrupt[victim * bs] ^= 0x01;
    const r = verifyRange(v.outboard, v.chunkLog, root, corrupt, 0);
    expect(r.ok).toBe(false);
    expect(r.blocks.filter((b) => !b.ok).map((b) => b.index)).toEqual([victim]);
  });

  it('a wrong root fails every block', () => {
    const v = small.find((x) => x.name === 'f50000.bao')!;
    const root = digestOf(v.cid);
    root[0] ^= 0xff;
    const r = verifyRange(v.outboard, v.chunkLog, root, v.data, 0);
    expect(r.ok).toBe(false);
    expect(r.blocks.every((b) => !b.ok)).toBe(true);
  });

  it('a tampered outboard entry fails', () => {
    const v = small.find((x) => x.name === 'f50000.cl0.bao')!;
    const root = digestOf(v.cid);
    const ob = new Uint8Array(v.outboard);
    ob[8 + 64 * 5 + 3] ^= 0x01;
    expect(verifyRange(ob, v.chunkLog, root, v.data, 0).ok).toBe(false);
  });

  it('rejects an unaligned offset or a short block', () => {
    const v = small.find((x) => x.name === 'f50000.bao')!;
    const root = digestOf(v.cid);
    expect(() => verifyRange(v.outboard, v.chunkLog, root, v.data.subarray(1, 16385), 1)).toThrow(/multiple/);
    expect(() => verifyRange(v.outboard, v.chunkLog, root, v.data.subarray(0, 100), 0)).toThrow(/whole blocks/);
  });
});

describe('aligned range', () => {
  // Expected values from `ingot blake3 range --chunk-log 4` over a 50,000-byte body.
  it('matches ingot', () => {
    expect(alignedRange(20000, 30000, 4, 50000)).toEqual([16384, 32767]);
    expect(alignedRange(0, 49999, 4, 50000)).toEqual([0, 49999]);
    expect(alignedRange(49000, 49999, 4, 50000)).toEqual([32768, 49999]);
    expect(alignedRange(0, 0, 4, 50000)).toEqual([0, 16383]);
    expect(alignedRange(16384, 16384, 4, 50000)).toEqual([16384, 32767]);
  });
  it('rejects a bad range', () => {
    expect(() => alignedRange(5, 4, 4, 50000)).toThrow(/ascending/);
    expect(() => alignedRange(50000, 50001, 4, 50000)).toThrow(/body is/);
  });
  it('lists interior boundaries', () => {
    expect(blockBoundaries(50000, 4)).toEqual([16384, 32768, 49152]);
    expect(blockBoundaries(16384, 4)).toEqual([]);
    expect(blockBoundaries(0, 4)).toEqual([]);
  });
});

describe('tree layout', () => {
  it('numbers parent entries in pre-order, left subtree first', () => {
    // 50,000 bytes at 16 KiB blocks: 4 blocks, 3 parents.
    const rows = layoutTree(50000, 4);
    expect(rows.map((r) => r.map((n) => [n.lo, n.hi, n.entry]))).toEqual([
      [[0, 4, 0]],
      [[0, 2, 1], [2, 4, 2]],
      [[0, 1, null], [1, 2, null], [2, 3, null], [3, 4, null]],
    ]);
    expect(rows[2].map((n) => [n.start, n.end])).toEqual([[0, 16384], [16384, 32768], [32768, 49152], [49152, 50000]]);
  });

  it('splits an uneven count with the largest power of two on the left', () => {
    const rows = layoutTree(5 * 16384, 4);
    expect(rows[1].map((n) => [n.lo, n.hi])).toEqual([[0, 4], [4, 5]]);
  });

  it('has one row holding the single block of a one-block body', () => {
    expect(layoutTree(100, 4)).toEqual([[{ lo: 0, hi: 1, depth: 0, entry: null, start: 0, end: 100 }]]);
  });
});

describe('verification trace', () => {
  it('records the spine, the siblings it trusted, and the blocks it hashed', () => {
    const v = small.find((x) => x.name === 'f50000.bao')!;
    const root = digestOf(v.cid);
    const bs = blockSize(v.chunkLog);
    // Block 2 of 4: the walk checks the root and the right parent, trusts the
    // left subtree's CV and block 3's CV, and hashes block 2.
    const r = verifyRange(v.outboard, v.chunkLog, root, v.data.subarray(2 * bs, 3 * bs), 2 * bs);
    expect(r).toMatchObject({
      ok: true,
      blocks: [{ index: 2, ok: true }],
      trace: { checked: [nodeKey(0, 4), nodeKey(2, 4)], trusted: [nodeKey(0, 2), nodeKey(3, 4)], failed: [] },
    });
  });

  it('records a parent that does not chain as failed', () => {
    const v = small.find((x) => x.name === 'f50000.bao')!;
    const root = digestOf(v.cid);
    root[0] ^= 0xff;
    const r = verifyRange(v.outboard, v.chunkLog, root, v.data, 0);
    expect(r.trace).toEqual({ checked: [], trusted: [], failed: [nodeKey(0, 4)] });
  });
});
