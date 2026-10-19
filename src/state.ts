import type { S3Config } from './lib/s3';

export interface Blake3Attribute {
  cid: string;
  chunkLog: number;
  /** Base64, as the XML carries it. */
  outboard: string;
}

export interface Uploaded {
  key: string;
  etag?: string;
  versionId?: string;
}

export interface DemoState {
  config: S3Config;
  file: File | null;
  /** The file's CID, once hashed. */
  cid: string | null;
  /** The object key the upload and the reads use. */
  key: string;
  uploaded: Uploaded | null;
  attribute: Blake3Attribute | null;
}
