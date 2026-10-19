import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Section } from '../components/Section';
import { Button, Mono, ProgressBar } from '../components/ui';
import { hashFile } from '../lib/blake3';
import { cidOf } from '../lib/cid';
import { formatBytes, formatCount } from '../lib/format';

export function FileSection({
  file,
  cid,
  onFile,
}: {
  file: File | null;
  cid: string | null;
  onFile: (file: File, cid: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  async function select(f: File) {
    onFile(f, null);
    setElapsed(null);
    setProgress(0);
    const started = performance.now();
    try {
      const digest = await hashFile(f, (n) => setProgress((n / Math.max(1, f.size)) * 100));
      const c = cidOf(digest).toString();
      setElapsed(performance.now() - started);
      onFile(f, c);
    } catch (err) {
      toast.error(`Hashing failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setProgress(null);
    }
  }

  return (
    <Section n={2} title="File" description="Pick a file. Its BLAKE3 digest is computed here in the browser and shown as a CID, the value the server will return in x-cid.">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void select(f);
            e.target.value = '';
          }}
        />
        <Button variant="ghost" onClick={() => inputRef.current?.click()} disabled={progress !== null}>
          {file ? 'Choose another file' : 'Choose file'}
        </Button>
        {file && (
          <span className="min-w-0 truncate text-sm text-zinc-700" title={file.name}>
            {file.name}
          </span>
        )}
      </div>
      {file && (
        <dl className="grid gap-4 sm:grid-cols-[auto_1fr] sm:gap-x-8">
          <dt className="text-xs font-medium text-zinc-600">Size</dt>
          <dd className="text-sm text-zinc-900">
            {formatBytes(file.size)}
            <span className="ml-2 text-xs text-zinc-500">{formatCount(file.size)} bytes</span>
          </dd>
          <dt className="text-xs font-medium text-zinc-600">Type</dt>
          <dd className="text-sm text-zinc-900">{file.type || 'unknown'}</dd>
        </dl>
      )}
      {progress !== null && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-zinc-600">Hashing {Math.round(progress)}%</p>
          <ProgressBar value={progress} label="Hashing" />
        </div>
      )}
      <Mono label="BLAKE3 CID" value={cid ?? undefined} placeholder={file ? 'Hashing' : 'Choose a file to compute its CID'} />
      {elapsed !== null && file && (
        <p className="text-xs text-zinc-500">
          Hashed {formatBytes(file.size)} in {(elapsed / 1000).toFixed(2)} s ({formatBytes(file.size / Math.max(elapsed, 1) * 1000)}/s).
        </p>
      )}
    </Section>
  );
}
