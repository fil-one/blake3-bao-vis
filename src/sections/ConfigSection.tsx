import { useEffect } from 'react';
import { Section } from '../components/Section';
import { Field, Input } from '../components/ui';
import type { S3Config } from '../lib/s3';

const STORAGE_KEY = 'blake3-bao-vis.endpoint';

/** The non-secret half of the config survives a reload; the keys stay in memory. */
export function loadSavedConfig(): Pick<S3Config, 'endpoint' | 'bucket' | 'region'> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Pick<S3Config, 'endpoint' | 'bucket' | 'region'>) : null;
  } catch {
    return null;
  }
}

export function ConfigSection({ config, onChange }: { config: S3Config; onChange: (c: S3Config) => void }) {
  useEffect(() => {
    try {
      const { endpoint, bucket, region } = config;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ endpoint, bucket, region }));
    } catch {
      // Storage unavailable: the fields just need retyping next time.
    }
  }, [config]);

  const set = (k: keyof S3Config) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...config, [k]: e.target.value });

  return (
    <Section n={1} title="Config" description="The S3 endpoint, bucket and access key the demo uploads to and reads from.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Endpoint" htmlFor="endpoint" className="sm:col-span-2">
          <Input id="endpoint" type="url" placeholder="https://s3.example.com" value={config.endpoint} onChange={set('endpoint')} autoComplete="off" />
        </Field>
        <Field label="Bucket" htmlFor="bucket">
          <Input id="bucket" type="text" placeholder="my-bucket" value={config.bucket} onChange={set('bucket')} autoComplete="off" />
        </Field>
        <Field label="Region" htmlFor="region">
          <Input id="region" type="text" value={config.region} onChange={set('region')} autoComplete="off" />
        </Field>
        <Field label="Access key ID" htmlFor="access-key-id">
          <Input id="access-key-id" type="text" value={config.accessKeyId} onChange={set('accessKeyId')} autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Secret access key" htmlFor="secret-access-key" description="Kept in memory only.">
          <Input id="secret-access-key" type="password" value={config.secretAccessKey} onChange={set('secretAccessKey')} autoComplete="off" />
        </Field>
      </div>
    </Section>
  );
}
