# BLAKE3 object digest demo

A single scrolling page in the style of the Fil One console that walks through
the BLAKE3 object digest work: hash a file in the browser, upload it with the
AWS SDK, verify the whole object against the `x-cid` header, fetch the Bao
outboard with `GetObjectAttributes`, and verify a byte range against it.

## Run

```sh
pnpm install
pnpm dev          # http://localhost:5173
```

The Ingot endpoint must list the page's origin in `cors_allowed_origins`
(`http://localhost:5173` for the dev server). Ingot's CORS rule already
exposes `ETag` and `x-cid`.

The access key is held in memory only; the endpoint, bucket and region are
remembered in `localStorage`.

## Rehearse without a server

`scripts/mock-s3.mjs` is an in-memory stand-in for Ingot: path-style buckets,
single and multipart uploads, `GET` with `Range` and `If-Match`, the `x-cid`
header and the `Blake3` attribute, with CORS open. Signatures are not checked.

```sh
pnpm mock         # http://localhost:9876
```

Point the config at `http://localhost:9876` with any bucket name and any
access key. A bucket whose name ends in `-corrupt` serves every `GET` with its
first byte flipped, so the whole-object check fails and a range check fails on
block 0 only.

## Verify

```sh
pnpm test         # the verifier against outboards produced by `ingot blake3 hash --bao`
pnpm typecheck
pnpm build
```

The fixtures under `test/fixtures` are random bodies with the CID, chunk log
and outboard Ingot prints for them. Set `BAO_VECTORS=<dir>` to add larger
vectors generated the same way.

## The outboard tree

Section 6 draws the outboard as an icicle: the root across the top, each row
splitting every node into its two children by byte span, the blocks along the
bottom. Every cell above the bottom row is one 64-byte outboard entry, in the
pre-order the outboard stores them. After a range verification the nodes the
walk read are painted: the parents it recomputed, the sibling values it took
from the outboard, and the blocks it hashed, against the rest of the tree it
never touched. Clicking a block sets the range to that block.

## How the range check works

`src/lib/bao.ts` mirrors Ingot's `blake3tree` package: `alignedRange` widens a
byte range to block boundaries the way `AlignedRange` does, and `verifyRange`
walks the pre-order outboard, checking each parent's chaining value against
its expected one and each fetched block's chaining value (computed with
blake3-bao's `chunkGroupCV`) against its parent entry, skipping subtrees the
range does not touch.
