import { useState } from 'react';
import { GetObjectAttributesCommand, type ObjectAttributes } from '@aws-sdk/client-s3';
import { toast } from 'sonner';
import { Section } from '../components/Section';
import { Button, Textarea } from '../components/ui';
import { formatBytes, formatXml } from '../lib/format';
import { captureBody, configComplete, describeError, makeClient, type S3Config } from '../lib/s3';
import type { Blake3Attribute } from '../state';

export function AttributesSection({
  config,
  objectKey,
  onAttribute,
}: {
  config: S3Config;
  objectKey: string;
  onAttribute: (a: Blake3Attribute | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [xml, setXml] = useState<string>('');
  const [size, setSize] = useState<number | null>(null);

  const ready = Boolean(objectKey && configComplete(config));

  async function fetchAttributes() {
    setBusy(true);
    try {
      const client = makeClient(config);
      const command = new GetObjectAttributesCommand({
        Bucket: config.bucket,
        Key: objectKey,
        // Blake3 is an Ingot extension to the S3 API; the SDK's enum does not
        // list it but passes the string through unchanged.
        ObjectAttributes: ['ETag', 'ObjectSize', 'Blake3' as ObjectAttributes],
      });
      const raw = captureBody(command);
      // The SDK joins the attribute list as "ETag, ObjectSize, Blake3" and
      // versitygw splits it on the bare comma, so the names after the first
      // arrive with a leading space and are refused as InvalidArgument. AWS
      // tolerates the space; the Go SDK and the CLI never add one.
      command.middlewareStack.add(
        (next) => async (args) => {
          const req = args.request as { headers: Record<string, string> };
          const h = req.headers['x-amz-object-attributes'];
          if (h) req.headers['x-amz-object-attributes'] = h.replace(/,\s+/g, ',');
          return next(args);
        },
        { step: 'build', name: 'compactObjectAttributes' },
      );
      await client.send(command);
      const text = new TextDecoder().decode(raw.body ?? new Uint8Array());
      setSize(raw.body?.length ?? 0);
      setXml(formatXml(text));
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      const el = doc.querySelector('Blake3');
      if (el) {
        onAttribute({
          cid: el.querySelector('CID')?.textContent?.trim() ?? '',
          chunkLog: Number(el.querySelector('ChunkLog')?.textContent ?? NaN),
          outboard: el.querySelector('Outboard')?.textContent?.trim() ?? '',
        });
        toast.success('Blake3 attribute received');
      } else {
        onAttribute(null);
        toast.error('The response has no Blake3 element');
      }
    } catch (err) {
      toast.error(`GetObjectAttributes failed: ${describeError(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section n={5} title="Object attributes" description="GetObjectAttributes with the Blake3 attribute returns the object's CID, the block size as a chunk log, and the Bao outboard that verifies ranged reads.">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void fetchAttributes()} disabled={!ready} loading={busy}>
          {busy ? 'Fetching' : 'Get attributes'}
        </Button>
        {!ready && <p className="text-xs text-zinc-500">Needs the config and an object key.</p>}
        {size !== null && <p className="text-xs text-zinc-500">Response body {formatBytes(size)}.</p>}
      </div>
      <Textarea
        aria-label="GetObjectAttributes response"
        readOnly
        rows={14}
        value={xml}
        placeholder="The formatted XML response appears here."
        className="resize-y break-all whitespace-pre-wrap"
        spellCheck={false}
      />
    </Section>
  );
}
