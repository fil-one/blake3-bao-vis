import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { HEADER_SIZE, PARENT_SIZE, blocksIn, layoutTree, nodeKey, type RangeVerification, type TreeNode } from '../lib/bao';
import { formatBytes, formatCount } from '../lib/format';

/** Row height and the gap between rows, in pixels. */
const ROW = 14;
const GAP = 2;
/** A cell narrower than this is not drawn unless the verification touched it. */
const MIN_CELL = 1.5;

type Role = 'skipped' | 'checked' | 'trusted' | 'failed' | 'hashed-ok' | 'hashed-fail';

const ROLE_CLASS: Record<Role, string> = {
  skipped: 'bg-zinc-200',
  checked: 'bg-brand-600',
  trusted: 'bg-brand-200',
  failed: 'bg-red-300',
  'hashed-ok': 'bg-green-500',
  'hashed-fail': 'bg-red-500',
};

const ROLE_LABEL: Record<Role, string> = {
  skipped: 'not needed',
  checked: 'parent checked: hash recomputed from its children',
  trusted: 'chaining value taken from the parent entry',
  failed: 'parent does not chain to the root',
  'hashed-ok': 'block hashed and verified',
  'hashed-fail': 'block hashed; does not match',
};

/**
 * The outboard as an icicle: the root across the top, each row below
 * splitting every node into its two children by byte span, the blocks along
 * the bottom. Every cell above the bottom row is one 64-byte outboard entry.
 * After a verification the nodes the walk read are painted by role, which
 * shows how little of the tree a ranged read touches.
 */
export function OutboardTree({
  size,
  chunkLog,
  outboard,
  result,
  onPickBlock,
}: {
  size: number;
  chunkLog: number;
  outboard: Uint8Array;
  result: RangeVerification | null;
  onPickBlock?: (index: number) => void;
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

  const rows = useMemo(() => layoutTree(size, chunkLog), [size, chunkLog]);
  const blocks = blocksIn(size, chunkLog);

  const roles = useMemo(() => {
    const m = new Map<string, Role>();
    if (!result) return m;
    for (const k of result.trace.checked) m.set(k, 'checked');
    for (const k of result.trace.trusted) m.set(k, 'trusted');
    for (const k of result.trace.failed) m.set(k, 'failed');
    for (const b of result.blocks) m.set(nodeKey(b.index, b.index + 1), b.ok ? 'hashed-ok' : 'hashed-fail');
    return m;
  }, [result]);

  const roleOf = (n: TreeNode): Role => roles.get(nodeKey(n.lo, n.hi)) ?? 'skipped';
  const pct = (bytes: number) => (bytes / Math.max(size, 1)) * 100;

  const hex = (off: number, n: number) =>
    Array.from(outboard.subarray(off, off + n), (b) => b.toString(16).padStart(2, '0')).join('');
  const describe = (n: TreeNode): string => {
    const span = `${formatCount(n.start)}–${formatCount(n.end - 1)} (${formatBytes(n.end - n.start)})`;
    const role = ROLE_LABEL[roleOf(n)];
    if (n.entry === null) return `Block ${n.lo}: bytes ${span}\n${role}`;
    const off = HEADER_SIZE + n.entry * PARENT_SIZE;
    const what = n.depth === 0 ? 'Root' : `Node`;
    return `${what}: blocks ${n.lo}–${n.hi - 1}, bytes ${span}\nOutboard entry ${n.entry} at byte ${off}\nleft CV ${hex(off, 4)}… right CV ${hex(off + 32, 4)}…\n${role}`;
  };

  const read = result ? result.trace.checked.length + result.trace.failed.length : 0;
  const parents = Math.max(0, blocks - 1);
  const hashedBytes = result ? result.blocks.reduce((a, b) => a + b.length, 0) : 0;

  return (
    <div className="flex flex-col gap-2">
      <div ref={ref} className="flex flex-col" style={{ gap: GAP }}>
        {rows.map((row, depth) => {
          const collapsed = row.some((n) => pct(n.end - n.start) * width / 100 < MIN_CELL);
          return (
            <div key={depth} className="relative" style={{ height: ROW }}>
              {collapsed && <div className="absolute inset-0 rounded-sm bg-zinc-100" aria-hidden />}
              {row.map((n) => {
                const w = (pct(n.end - n.start) * width) / 100;
                const role = roleOf(n);
                if (w < MIN_CELL && role === 'skipped') return null;
                const leaf = n.entry === null;
                return (
                  <div
                    key={n.lo}
                    role={leaf && onPickBlock ? 'button' : undefined}
                    tabIndex={leaf && onPickBlock ? 0 : undefined}
                    title={describe(n)}
                    onClick={leaf && onPickBlock ? () => onPickBlock(n.lo) : undefined}
                    onKeyDown={
                      leaf && onPickBlock
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') onPickBlock(n.lo);
                          }
                        : undefined
                    }
                    className={clsx(
                      'absolute inset-y-0 overflow-hidden rounded-sm text-meta leading-none',
                      role === 'skipped' ? 'text-zinc-600' : 'text-white',
                      ROLE_CLASS[role],
                      leaf && onPickBlock && 'cursor-pointer hover:brightness-95',
                    )}
                    style={{ left: `${pct(n.start)}%`, width: `max(${MIN_CELL}px, calc(${pct(n.end - n.start)}% - 1px))` }}
                  >
                    {depth === 0 && w > 60 && <span className="px-1.5 leading-[14px]">root</span>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-zinc-600">
        {result ? (
          <>
            Read {formatCount(read)} of {formatCount(parents)} outboard entries ({formatBytes(read * PARENT_SIZE)} of{' '}
            {formatBytes(outboard.length)}), hashed {formatCount(result.blocks.length)} of {formatCount(blocks)} blocks (
            {formatBytes(hashedBytes)}).
          </>
        ) : (
          <>
            {formatCount(rows.length)} rows: the root, {formatCount(parents)} parent entries below it, and {formatCount(blocks)} block
            {blocks === 1 ? '' : 's'} along the bottom.{onPickBlock && ' Click a block to choose it as the range.'}
          </>
        )}
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-zinc-600">
        {(['checked', 'trusted', 'hashed-ok', 'skipped'] as Role[]).map((r) => (
          <li key={r} className="flex items-center gap-1.5">
            <span className={clsx('inline-block h-2.5 w-4 rounded-sm', ROLE_CLASS[r])} />
            <span>
              {r === 'checked' ? 'Parent checked' : r === 'trusted' ? 'Sibling value from the outboard' : r === 'hashed-ok' ? 'Block hashed' : 'Not needed'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
