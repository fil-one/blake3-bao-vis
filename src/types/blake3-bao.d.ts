// The subset of blake3-bao the app uses, declared against the CommonJS files
// the Vite alias points at (the package's own declarations describe its ESM
// entry points, which the browser build cannot load; see vite.config.ts).

declare module 'blake3-bao/blake3.js' {
  export interface Hasher {
    update(input: Uint8Array | string): Hasher;
    finalize(outputLen?: number): Uint8Array;
    reset(): void;
  }
  export interface Blake3 {
    hash(input: Uint8Array | string, outputLen?: number): Uint8Array;
    createHasher(): Hasher;
    initSimd(): Promise<boolean>;
    isSimdEnabled(): boolean;
  }
  const blake3: Blake3;
  export default blake3;
}

declare module 'blake3-bao/bao.js' {
  export interface Bao {
    /** Chaining value of a block of chunks starting at a chunk index. */
    chunkGroupCV(data: Uint8Array, startChunkIndex: number, isRoot: boolean): Uint8Array;
    /** Chaining value of a parent node from its children's. */
    parentCV(left: Uint8Array, right: Uint8Array, isRoot: boolean): Uint8Array;
    constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean;
    /** Whole-object verification against an outboard at a chunk group log. */
    baoVerifyIroh(outboard: Uint8Array, root: Uint8Array, data: Uint8Array, chunkGroupLog?: number): boolean;
    baoEncodeIroh(data: Uint8Array, outboard?: boolean, chunkGroupLog?: number): { encoded: Uint8Array; hash: Uint8Array };
    CHUNK_LEN: number;
    HEADER_SIZE: number;
    PARENT_SIZE: number;
    HASH_SIZE: number;
  }
  const bao: Bao;
  export default bao;
}
