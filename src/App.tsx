import { useState } from 'react';
import { Toaster } from 'sonner';
import { ConfigSection, loadSavedConfig } from './sections/ConfigSection';
import { FileSection } from './sections/FileSection';
import { UploadSection } from './sections/UploadSection';
import { FullVerifySection } from './sections/FullVerifySection';
import { AttributesSection } from './sections/AttributesSection';
import { RangeVerifySection } from './sections/RangeVerifySection';
import { DEFAULT_REGION, type S3Config } from './lib/s3';
import type { Blake3Attribute, Uploaded } from './state';

function initialConfig(): S3Config {
  const saved = loadSavedConfig();
  return {
    endpoint: saved?.endpoint ?? '',
    bucket: saved?.bucket ?? '',
    region: saved?.region ?? DEFAULT_REGION,
    accessKeyId: '',
    secretAccessKey: '',
  };
}

export function App() {
  const [config, setConfig] = useState<S3Config>(initialConfig);
  const [file, setFile] = useState<File | null>(null);
  const [cid, setCid] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [uploaded, setUploaded] = useState<Uploaded | null>(null);
  const [attribute, setAttribute] = useState<Blake3Attribute | null>(null);

  // The CID the reads verify against: the file's own, or failing that the one
  // the server reported, for an object this page did not hash itself.
  const expectedCid = cid ?? attribute?.cid ?? null;
  const etag = uploaded && uploaded.key === key ? uploaded.etag : undefined;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <img src="/fil-one-logo.svg" alt="Fil One" className="h-5" />
          <span className="text-zinc-300" aria-hidden>
            /
          </span>
          <h1 className="text-sm font-medium text-zinc-900">BLAKE3 object digest</h1>
          <span className="ml-auto rounded-full bg-brand-50 px-2 py-0.5 text-meta font-medium text-brand-700">Demo</span>
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
        <p className="max-w-readable text-sm text-zinc-600">
          Every object stored through Fil One now carries a BLAKE3 digest and a Merkle tree over its blocks. A client can check a
          whole download against the <code className="font-mono text-ui">x-cid</code> header, and check any byte range against
          the Bao outboard that <code className="font-mono text-ui">GetObjectAttributes</code> returns, without downloading the rest.
        </p>
        <ConfigSection config={config} onChange={setConfig} />
        <FileSection
          file={file}
          cid={cid}
          onFile={(f, c) => {
            if (f !== file) {
              setKey(f.name);
              setUploaded(null);
              setAttribute(null);
            }
            setFile(f);
            setCid(c);
          }}
        />
        <UploadSection config={config} file={file} objectKey={key} onKeyChange={setKey} uploaded={uploaded} onUploaded={setUploaded} />
        <FullVerifySection config={config} objectKey={key} expectedCid={expectedCid} />
        <AttributesSection config={config} objectKey={key} onAttribute={setAttribute} />
        <RangeVerifySection config={config} objectKey={key} etag={etag} cid={expectedCid} fileSize={file?.size ?? null} />
      </main>
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}
