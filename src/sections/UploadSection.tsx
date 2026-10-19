import { useState } from 'react';
import { Upload } from '@aws-sdk/lib-storage';
import { toast } from 'sonner';
import { Section } from '../components/Section';
import { Button, Detail, Field, Input, ProgressBar } from '../components/ui';
import { formatBytes } from '../lib/format';
import { configComplete, describeError, makeClient, type S3Config } from '../lib/s3';
import type { Uploaded } from '../state';

/** 8 MiB parts: the S3 minimum is 5 MiB, and a demo file of a few hundred
 * MiB then shows a handful of parts rather than hundreds. */
const PART_SIZE = 8 * 1024 * 1024;

export function UploadSection({
  config,
  file,
  objectKey,
  onKeyChange,
  uploaded,
  onUploaded,
}: {
  config: S3Config;
  file: File | null;
  objectKey: string;
  onKeyChange: (key: string) => void;
  uploaded: Uploaded | null;
  onUploaded: (u: Uploaded) => void;
}) {
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const ready = Boolean(file && objectKey && configComplete(config));

  async function upload() {
    if (!file) return;
    setProgress({ loaded: 0, total: file.size });
    setElapsed(null);
    const started = performance.now();
    try {
      const client = makeClient(config);
      const managed = new Upload({
        client,
        params: { Bucket: config.bucket, Key: objectKey, Body: file, ContentType: file.type || undefined },
        partSize: PART_SIZE,
        queueSize: 4,
        leavePartsOnError: false,
      });
      managed.on('httpUploadProgress', (p) => {
        setProgress({ loaded: p.loaded ?? 0, total: p.total ?? file.size });
      });
      const out = await managed.done();
      setElapsed(performance.now() - started);
      onUploaded({ key: objectKey, etag: out.ETag, versionId: out.VersionId });
      toast.success(`Uploaded ${objectKey}`);
    } catch (err) {
      toast.error(`Upload failed: ${describeError(err)}`);
    } finally {
      setProgress(null);
    }
  }

  return (
    <Section n={3} title="Upload" description="A managed multipart upload through the AWS SDK. The server records the object's BLAKE3 tree as the parts arrive.">
      <Field label="Object key" htmlFor="object-key" description="Edit it to upload the same file under another key.">
        <Input id="object-key" type="text" value={objectKey} onChange={(e) => onKeyChange(e.target.value)} placeholder="Choose a file first" spellCheck={false} autoComplete="off" />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void upload()} disabled={!ready} loading={progress !== null}>
          {progress ? 'Uploading' : 'Upload'}
        </Button>
        {!ready && <p className="text-xs text-zinc-500">{file ? 'Complete the config to upload.' : 'Choose a file to upload.'}</p>}
      </div>
      {progress && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-zinc-600">
            {formatBytes(progress.loaded)} of {formatBytes(progress.total)} ({Math.round((progress.loaded / Math.max(1, progress.total)) * 100)}%)
          </p>
          <ProgressBar value={(progress.loaded / Math.max(1, progress.total)) * 100} label="Upload" />
        </div>
      )}
      {uploaded && (
        <dl className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <Detail label="Key">{uploaded.key}</Detail>
          <Detail label="ETag">{uploaded.etag ?? '–'}</Detail>
          {uploaded.versionId && <Detail label="Version ID">{uploaded.versionId}</Detail>}
          {elapsed !== null && file && (
            <Detail label="Time">
              {(elapsed / 1000).toFixed(2)} s ({formatBytes((file.size / Math.max(elapsed, 1)) * 1000)}/s)
            </Detail>
          )}
        </dl>
      )}
    </Section>
  );
}
