import { S3Client } from '@aws-sdk/client-s3';
import type { MiddlewareStack } from '@smithy/types';

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export const DEFAULT_REGION = 'us-east-1';

export function configComplete(c: S3Config): boolean {
  return Boolean(c.endpoint && c.bucket && c.accessKeyId && c.secretAccessKey);
}

/** A client for an S3-compatible endpoint. Path-style addressing, since the
 * endpoint is a bare host and bucket subdomains need DNS the demo does not
 * have. */
export function makeClient(c: S3Config): S3Client {
  return new S3Client({
    endpoint: c.endpoint,
    region: c.region || DEFAULT_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
  });
}

export interface RawResponse {
  status: number;
  /** Response headers, lower-cased names. */
  headers: Record<string, string>;
  /** The raw body, when captured (see captureBody). */
  body?: Uint8Array;
}

type Command = { middlewareStack: MiddlewareStack<any, any> };

/**
 * Records the HTTP status and headers of a command's response. The SDK's
 * typed output drops headers it does not model (x-cid, Content-Range), so the
 * capture sits in the deserialize step above the deserializer, where the
 * response object is still in hand after parsing.
 */
export function captureHeaders(command: Command): RawResponse {
  const raw: RawResponse = { status: 0, headers: {} };
  command.middlewareStack.add(
    (next) => async (args) => {
      const result = await next(args);
      const response = (result as { response?: { statusCode: number; headers: Record<string, string> } }).response;
      if (response) {
        raw.status = response.statusCode;
        raw.headers = lowerKeys(response.headers);
      }
      return result;
    },
    { step: 'deserialize', priority: 'high', name: 'captureHeaders' },
  );
  return raw;
}

/**
 * Records the raw response body as well as the headers. It sits below the
 * deserializer, where the body is still unread: the bytes are collected, kept,
 * and handed back to the deserializer as a fresh Blob so the SDK's own parse
 * still runs. For responses small enough to hold in memory (XML documents).
 */
export function captureBody(command: Command): RawResponse {
  const raw = captureHeaders(command);
  command.middlewareStack.add(
    (next) => async (args) => {
      const result = await next(args);
      const response = (result as { response?: { body?: unknown } }).response;
      if (response) {
        const bytes = await collect(response.body);
        raw.body = bytes;
        response.body = new Blob([bytes as BlobPart]);
      }
      return result;
    },
    { step: 'deserialize', priority: 'low', name: 'captureBody' },
  );
  return raw;
}

async function collect(body: unknown): Promise<Uint8Array> {
  if (body == null) return new Uint8Array();
  if (body instanceof Uint8Array) return body;
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof ReadableStream) {
    const chunks: Uint8Array[] = [];
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        chunks.push(value);
        length += value.length;
      }
      if (done) break;
    }
    const out = new Uint8Array(length);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
  throw new Error('unsupported response body type');
}

function lowerKeys(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}

/** The S3 error message to show for a failed request. */
export function describeError(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    const status = e.$metadata?.httpStatusCode;
    const name = e.name && e.name !== 'Error' ? e.name : undefined;
    const parts = [name, e.message].filter(Boolean);
    const text = parts.join(': ') || String(err);
    return status ? `${text} (HTTP ${status})` : text;
  }
  return String(err);
}
