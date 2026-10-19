import { useState } from 'react';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { toast } from 'sonner';
import { Section } from '../components/Section';
import { Button, Detail, Mono, ProgressBar, Verdict, type VerdictState } from '../components/ui';
import { hashStream } from '../lib/blake3';
import { cidOf } from '../lib/cid';
import { formatBytes } from '../lib/format';
import { captureHeaders, configComplete, describeError, makeClient, type S3Config } from '../lib/s3';

interface Result {
  xcid: string | undefined;
  computed: string;
  length: number;
  elapsed: number;
}

export function FullVerifySection({ config, objectKey, expectedCid }: { config: S3Config; objectKey: string; expectedCid: string | null }) {
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [state, setState] = useState<VerdictState>('idle');

  const ready = Boolean(objectKey && configComplete(config));

  async function verify() {
    setResult(null);
    setState('pending');
    setProgress({ loaded: 0, total: 0 });
    const started = performance.now();
    try {
      const client = makeClient(config);
      const command = new GetObjectCommand({ Bucket: config.bucket, Key: objectKey });
      const raw = captureHeaders(command);
      const res = await client.send(command);
      const total = res.ContentLength ?? 0;
      if (!res.Body) throw new Error('response has no body');
      const { digest, length } = await hashStream(res.Body.transformToWebStream(), (n) => setProgress({ loaded: n, total }));
      const computed = cidOf(digest).toString();
      const xcid = raw.headers['x-cid'];
      const r: Result = { xcid, computed, length, elapsed: performance.now() - started };
      setResult(r);
      const ok = Boolean(xcid) && computed === xcid && (expectedCid === null || expectedCid === xcid);
      setState(ok ? 'ok' : 'fail');
      if (ok) toast.success('Object verified against x-cid');
      else toast.error(xcid ? 'Object did not verify' : 'No x-cid header on the response');
    } catch (err) {
      setState('idle');
      toast.error(`GetObject failed: ${describeError(err)}`);
    } finally {
      setProgress(null);
    }
  }

  return (
    <Section n={4} title="Full object verify" description="GetObject fetches the whole body. The bytes are hashed as they stream in and compared with the x-cid header the server sends.">
      <Mono label="Expected CID (from the file)" value={expectedCid ?? undefined} placeholder="Hash a file in section 2" />
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void verify()} disabled={!ready} loading={state === 'pending'}>
          {state === 'pending' ? 'Fetching' : 'Fetch and verify'}
        </Button>
        {!ready && <p className="text-xs text-zinc-500">Needs the config and an object key.</p>}
      </div>
      {progress && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-zinc-600">
            {formatBytes(progress.loaded)}
            {progress.total > 0 && ` of ${formatBytes(progress.total)}`}
          </p>
          <ProgressBar value={progress.total > 0 ? (progress.loaded / progress.total) * 100 : 0} label="Download" />
        </div>
      )}
      {result && (
        <dl className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <Detail label="x-cid header">{result.xcid ?? 'absent'}</Detail>
          <Detail label="Hash of the body">{result.computed}</Detail>
          <Detail label="Bytes">{formatBytes(result.length)}</Detail>
          <Detail label="Time">{(result.elapsed / 1000).toFixed(2)} s</Detail>
        </dl>
      )}
      <Verdict state={state} pendingText="Fetching and hashing" />
    </Section>
  );
}
