import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { blockSize, blocksIn, type BlockResult } from '../lib/bao';
import { formatBytes } from '../lib/format';

export type ByteRange = [number, number];

/** Pixels each boundary label needs, so labels never overlap. */
const LABEL_WIDTH = 64;
/** Beyond this many blocks, only the labelled boundaries get a tick. */
const MAX_TICKS = 512;

/**
 * The object as a bar: block boundaries as vertical ticks labelled with their
 * byte offset, the requested byte range as a solid bar, and the block-aligned
 * range that must be fetched as a lighter bar behind it. Verified blocks are
 * tinted once a verification has run.
 */
export function RangeVisualization({
  size,
  chunkLog,
  requested,
  fetched,
  blocks,
}: {
  size: number;
  chunkLog: number | null;
  requested: ByteRange | null;
  fetched: ByteRange | null;
  blocks?: BlockResult[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pct = (n: number) => `${(n / Math.max(size, 1)) * 100}%`;
  const span = (r: ByteRange) => ({ left: pct(r[0]), width: `max(2px, ${pct(r[1] - r[0] + 1)})` });

  // Boundaries: every block start after the first. Labels go on every
  // `stride`th boundary, the smallest power of two that keeps them apart.
  const ticks: { offset: number; labelled: boolean }[] = [];
  if (chunkLog !== null && size > 0) {
    const bs = blockSize(chunkLog);
    const n = blocksIn(size, chunkLog);
    const maxLabels = Math.max(1, Math.floor(width / LABEL_WIDTH));
    let stride = 1;
    while (n / stride > maxLabels) stride *= 2;
    for (let i = 1; i < n; i++) {
      const offset = i * bs;
      // A label within a label's width of either end would collide with the
      // "0" and size captions, so those boundaries keep their tick only.
      const x = (offset / size) * width;
      const labelled = i % stride === 0 && x > LABEL_WIDTH / 2 && width - x > LABEL_WIDTH;
      if (labelled || i % stride === 0 || n <= MAX_TICKS) ticks.push({ offset, labelled });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div ref={ref} className="relative h-14 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {size === 0 && <p className="absolute inset-0 flex items-center justify-center text-xs text-zinc-400">Empty object</p>}
        {fetched && <div className="absolute inset-y-0 bg-brand-100" style={span(fetched)} aria-hidden />}
        {blocks?.map((b) => (
          <div
            key={b.index}
            className={clsx('absolute inset-y-0', b.ok ? 'bg-green-500/25' : 'bg-red-500/30')}
            style={span([b.offset, b.offset + b.length - 1])}
            title={`Block ${b.index}: ${b.ok ? 'verified' : 'failed'}`}
          />
        ))}
        {ticks.map((t) => (
          <div
            key={t.offset}
            className={clsx('absolute inset-y-0 w-px', t.labelled ? 'bg-zinc-400' : 'bg-zinc-200')}
            style={{ left: pct(t.offset) }}
            aria-hidden
          />
        ))}
        {requested && (
          <div className="absolute top-4 bottom-4 rounded-sm bg-brand-600" style={span(requested)} title={`Requested ${requested[0]}–${requested[1]}`} />
        )}
      </div>
      <div className="relative h-4">
        <span className="absolute left-0 text-meta text-zinc-500">0</span>
        {ticks
          .filter((t) => t.labelled)
          .map((t) => (
            <span
              key={t.offset}
              className="absolute -translate-x-1/2 whitespace-nowrap text-meta text-zinc-500"
              style={{ left: pct(t.offset) }}
            >
              {formatBytes(t.offset, 0)}
            </span>
          ))}
        <span className="absolute right-0 text-meta text-zinc-500">{formatBytes(size)}</span>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-zinc-600">
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-sm bg-brand-600" /> <span>Requested range</span>
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-sm bg-brand-100" /> <span>Fetched (block-aligned)</span>
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-px bg-zinc-400" /> <span>Block boundary</span>
          {chunkLog !== null && <span className="text-zinc-400">({formatBytes(blockSize(chunkLog), 0)} blocks)</span>}
        </li>
        {blocks && blocks.length > 0 && (
          <li className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-sm bg-green-500/25" /> <span>Verified block</span>
          </li>
        )}
      </ul>
    </div>
  );
}
