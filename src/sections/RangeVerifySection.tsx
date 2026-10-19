import { useMemo, useState } from 'react';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { toast } from 'sonner';
import { Section } from '../components/Section';
import { RangeVisualization, type ByteRange } from '../components/RangeVisualization';
import { OutboardTree } from '../components/OutboardTree';
import { Button, Detail, Field, Input, Label, Mono, Textarea, Verdict, type VerdictState } from '../components/ui';
import { MAX_CHUNK_LOG, alignedRange, blockSize, parseOutboard, verifyRange, type RangeVerification } from '../lib/bao';
import { digestOf } from '../lib/cid';
import { base64ToBytes, formatBytes, formatCount } from '../lib/format';
import { captureHeaders, configComplete, describeError, makeClient, type S3Config } from '../lib/s3';

interface Result {
  contentRange: string | undefined;
  length: number;
  verification: RangeVerification;
  elapsed: number;
}

export function RangeVerifySection({
  config,
  objectKey,
  etag,
  cid,
  fileSize,
}: {
  config: S3Config;
  objectKey: string;
  /** The uploaded version's ETag, sent as If-Match so the bytes cannot change under the outboard. */
  etag: string | undefined;
  cid: string | null;
  /** The size of the file picked in section 2, to cross-check the outboard. */
  fileSize: number | null;
}) {
  const [outboardText, setOutboardText] = useState('');
  const [chunkLogText, setChunkLogText] = useState('');
  const [startText, setStartText] = useState('');
  const [endText, setEndText] = useState('');
  const [state, setState] = useState<VerdictState>('idle');
  const [result, setResult] = useState<Result | null>(null);

  // The outboard and chunk log, parsed together: the entry count ties one to
  // the other, so a mismatch is reported before any range arithmetic.
  const tree = useMemo(() => {
    if (!outboardText.trim() || chunkLogText === '') return null;
    try {
      const outboard = base64ToBytes(outboardText);
      const chunkLog = Number(chunkLogText);
      const info = parseOutboard(outboard, chunkLog);
      if (fileSize !== null && info.size !== fileSize) {
        return { error: `The outboard describes a ${formatCount(info.size)}-byte object; the file is ${formatCount(fileSize)} bytes.` };
      }
      return { outboard, chunkLog, ...info };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, [outboardText, chunkLogText, fileSize]);

  const parsed = tree && 'outboard' in tree ? tree : null;
  const treeError = tree && 'error' in tree ? tree.error : null;
  const size = parsed?.size ?? fileSize ?? 0;

  const start = startText === '' ? null : Number(startText);
  const end = endText === '' ? null : Number(endText);
  let rangeError: string | null = null;
  let requested: ByteRange | null = null;
  let fetched: ByteRange | null = null;
  if (start !== null && end !== null) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0) rangeError = 'Start and end must be whole numbers.';
    else if (end < start) rangeError = 'End must not be before start.';
    else if (size > 0 && end >= size) rangeError = `End must be below the object size (${formatCount(size)}).`;
    else {
      requested = [start, end];
      if (parsed) fetched = alignedRange(start, end, parsed.chunkLog, parsed.size);
    }
  }

  const ready = Boolean(parsed && requested && fetched && cid && objectKey && configComplete(config));

  async function verify() {
    if (!parsed || !fetched || !cid) return;
    setResult(null);
    setState('pending');
    const started = performance.now();
    try {
      const root = digestOf(cid);
      const client = makeClient(config);
      const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
        Range: `bytes=${fetched[0]}-${fetched[1]}`,
        IfMatch: etag,
      });
      const raw = captureHeaders(command);
      const res = await client.send(command);
      if (!res.Body) throw new Error('response has no body');
      const data = await res.Body.transformToByteArray();
      const r = verifyRange(parsed.outboard, parsed.chunkLog, root, data, fetched[0]);
      setResult({ contentRange: raw.headers['content-range'], length: data.length, verification: r, elapsed: performance.now() - started });
      setState(r.ok ? 'ok' : 'fail');
      if (r.ok) toast.success(`Verified ${formatBytes(data.length)} against the outboard`);
      else toast.error('The range did not verify');
    } catch (err) {
      setState('idle');
      toast.error(`Range verification failed: ${describeError(err)}`);
    }
  }

  return (
    <Section n={6} title="Partial object verify" description="A byte range is fetched with an S3 Range request and verified against the Bao outboard. Only whole blocks verify, so the request widens to block boundaries.">
      <Mono label="Object CID" value={cid ?? undefined} placeholder="Hash a file in section 2" />
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <Field label="Outboard" htmlFor="outboard" description="Paste the Outboard value from the attributes response." error={treeError}>
          <Textarea
            id="outboard"
            rows={3}
            value={outboardText}
            onChange={(e) => setOutboardText(e.target.value)}
            placeholder="AAAAAAAAAAA="
            spellCheck={false}
            invalid={Boolean(treeError)}
            className="resize-y"
          />
        </Field>
        <Field label="Chunk log" htmlFor="chunk-log" description="Block size as 2ⁿ chunks of 1 KiB.">
          <Input
            id="chunk-log"
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_CHUNK_LOG}
            step={1}
            value={chunkLogText}
            onChange={(e) => setChunkLogText(e.target.value)}
            placeholder="4"
          />
        </Field>
      </div>
      {parsed && (
        <p className="text-xs text-zinc-500">
          {formatCount(parsed.blocks)} block{parsed.blocks === 1 ? '' : 's'} of {formatBytes(1024 * 2 ** parsed.chunkLog, 0)} over {formatBytes(parsed.size)}; outboard {formatBytes(parsed.outboard.length)}.
        </p>
      )}
      {parsed && (
        <div className="flex flex-col gap-2">
          <Label>Outboard tree</Label>
          <OutboardTree
            size={parsed.size}
            chunkLog={parsed.chunkLog}
            outboard={parsed.outboard}
            result={result?.verification ?? null}
            onPickBlock={(index) => {
              const bs = blockSize(parsed.chunkLog);
              setStartText(String(index * bs));
              setEndText(String(Math.min((index + 1) * bs, parsed.size) - 1));
              setResult(null);
              setState('idle');
            }}
          />
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label>Byte range</Label>
        <RangeVisualization size={size} chunkLog={parsed?.chunkLog ?? null} requested={requested} fetched={fetched} blocks={result?.verification.blocks} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Start byte" htmlFor="range-start">
          <Input id="range-start" type="number" inputMode="numeric" min={0} max={Math.max(0, size - 1)} step={1} value={startText} onChange={(e) => setStartText(e.target.value)} placeholder="0" />
        </Field>
        <Field label="End byte (inclusive)" htmlFor="range-end" error={rangeError}>
          <Input id="range-end" type="number" inputMode="numeric" min={0} max={Math.max(0, size - 1)} step={1} value={endText} onChange={(e) => setEndText(e.target.value)} placeholder={size > 0 ? String(size - 1) : '0'} invalid={Boolean(rangeError)} />
        </Field>
      </div>
      {requested && fetched && (
        <p className="text-xs text-zinc-600">
          Requested {formatCount(requested[0])}–{formatCount(requested[1])} ({formatBytes(requested[1] - requested[0] + 1)}). Fetching {formatCount(fetched[0])}–{formatCount(fetched[1])} ({formatBytes(fetched[1] - fetched[0] + 1)}) to cover whole blocks.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void verify()} disabled={!ready} loading={state === 'pending'}>
          {state === 'pending' ? 'Fetching' : 'Fetch range and verify'}
        </Button>
        {!ready && state !== 'pending' && (
          <p className="text-xs text-zinc-500">
            {!parsed ? 'Enter the outboard and chunk log.' : !requested ? 'Enter a byte range.' : !cid ? 'Needs the object CID.' : 'Needs the config and an object key.'}
          </p>
        )}
      </div>
      {result && (
        <dl className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <Detail label="Content-Range">{result.contentRange ?? 'absent'}</Detail>
          <Detail label="Bytes fetched">{formatBytes(result.length)}</Detail>
          <Detail label="Blocks checked">
            {result.verification.blocks.length} ({result.verification.blocks.filter((b) => b.ok).length} verified)
          </Detail>
          <Detail label="Time">{(result.elapsed / 1000).toFixed(2)} s</Detail>
        </dl>
      )}
      <Verdict state={state} pendingText="Fetching and verifying" />
    </Section>
  );
}
