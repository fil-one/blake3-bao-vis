// A stand-in for Ingot's S3 endpoint, for rehearsing the demo page without a
// server: path-style buckets, single and multipart PUT, GET with Range and
// If-Match, the x-cid header, GetObjectAttributes with the Blake3 attribute
// (outboard built with blake3-bao at Ingot's chunk log), and CORS. Objects
// live in memory. Signatures are not checked.
//
//   node scripts/mock-s3.mjs [port]      (default 9876)
//
// A bucket whose name ends in "-corrupt" serves every GET with its first
// byte flipped, to show a verification failing.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { CID } from 'multiformats/cid';
import * as Digest from 'multiformats/hashes/digest';

const require = createRequire(import.meta.url);
const blake3 = require('blake3-bao/blake3');
const bao = require('blake3-bao/bao');

const port = Number(process.argv[2] ?? 9876);
const objects = new Map(); // "bucket/key" -> { data, etag, type }
const uploads = new Map(); // uploadId -> { bucket, key, type, parts: Map }

/** Ingot's block-size rule: see blake3tree.ChunkLog. */
function chunkLog(size) {
  let c = 4;
  while (c < 24 && size > 2 ** (2 * c + 15)) c++;
  while (c + 10 + 15 < 63 && size > 32768 * 2 ** (c + 10)) c++;
  return c;
}

function cidOf(data) {
  return CID.createV1(0x55, Digest.create(0x1e, blake3.hash(data))).toString();
}

function etagOf(data) {
  return `"${blake3.toHex(blake3.hash(data)).slice(0, 32)}"`;
}

function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, PUT, POST, DELETE');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? '*');
  res.setHeader('Access-Control-Expose-Headers', 'ETag, x-cid, Content-Range, x-amz-request-id, x-amz-version-id');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('x-amz-request-id', Math.random().toString(16).slice(2));
}

function xml(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/xml', ...headers });
  res.end(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`);
}

function error(res, status, code, message) {
  xml(res, status, `<Error><Code>${code}</Code><Message>${message}</Message></Error>`);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
  });
}

createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  const [, bucket, ...rest] = url.pathname.split('/');
  const key = decodeURIComponent(rest.join('/'));
  const id = `${bucket}/${key}`;
  const log = (status, extra = '') => console.log(`${req.method} ${url.pathname}${url.search} -> ${status} ${extra}`);

  if (!bucket) return error(res, 400, 'InvalidRequest', 'no bucket');
  if (!key) {
    // ListObjects and friends are out of scope; answer the bucket exists.
    log(200);
    return xml(res, 200, '<ListBucketResult/>');
  }

  if (req.method === 'POST' && url.searchParams.has('uploads')) {
    const uploadId = Math.random().toString(36).slice(2);
    uploads.set(uploadId, { bucket, key, type: req.headers['content-type'], parts: new Map() });
    await readBody(req);
    log(200, `upload ${uploadId}`);
    return xml(res, 200, `<InitiateMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${key}</Key><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`);
  }

  if (req.method === 'PUT' && url.searchParams.has('uploadId')) {
    const u = uploads.get(url.searchParams.get('uploadId'));
    if (!u) return error(res, 404, 'NoSuchUpload', 'no such upload');
    const n = Number(url.searchParams.get('partNumber'));
    const data = await readBody(req);
    const etag = etagOf(data);
    u.parts.set(n, { data, etag });
    log(200, `part ${n} ${data.length} bytes`);
    res.writeHead(200, { ETag: etag });
    return res.end();
  }

  if (req.method === 'POST' && url.searchParams.has('uploadId')) {
    const uploadId = url.searchParams.get('uploadId');
    const u = uploads.get(uploadId);
    if (!u) return error(res, 404, 'NoSuchUpload', 'no such upload');
    await readBody(req);
    const ordered = [...u.parts.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p.data);
    const data = new Uint8Array(Buffer.concat(ordered.map((d) => Buffer.from(d))));
    const etag = `"${blake3.toHex(blake3.hash(data)).slice(0, 32)}-${ordered.length}"`;
    objects.set(id, { data, etag, type: u.type });
    uploads.delete(uploadId);
    log(200, `complete ${data.length} bytes, ${ordered.length} parts`);
    return xml(res, 200, `<CompleteMultipartUploadResult><Location>http://${req.headers.host}${url.pathname}</Location><Bucket>${bucket}</Bucket><Key>${key}</Key><ETag>${etag}</ETag></CompleteMultipartUploadResult>`);
  }

  if (req.method === 'PUT') {
    const data = await readBody(req);
    const etag = etagOf(data);
    objects.set(id, { data, etag, type: req.headers['content-type'] });
    log(200, `${data.length} bytes`);
    res.writeHead(200, { ETag: etag });
    return res.end();
  }

  const obj = objects.get(id);
  if (!obj) {
    log(404);
    return error(res, 404, 'NoSuchKey', 'The specified key does not exist.');
  }

  if (req.method === 'GET' && url.searchParams.has('attributes')) {
    const cl = chunkLog(obj.data.length);
    const { encoded } = bao.baoEncodeIroh(obj.data, true, cl);
    log(200, `attributes chunk log ${cl}, outboard ${encoded.length} bytes`);
    return xml(
      res,
      200,
      `<GetObjectAttributesOutput><ETag>${obj.etag.replace(/"/g, '')}</ETag><ObjectSize>${obj.data.length}</ObjectSize><Blake3><CID>${cidOf(obj.data)}</CID><ChunkLog>${cl}</ChunkLog><Outboard>${Buffer.from(encoded).toString('base64')}</Outboard></Blake3></GetObjectAttributesOutput>`,
      { 'Last-Modified': new Date().toUTCString() },
    );
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (req.headers['if-match'] && req.headers['if-match'] !== obj.etag) {
      log(412);
      return error(res, 412, 'PreconditionFailed', 'At least one of the pre-conditions you specified did not hold');
    }
    let data = obj.data;
    if (bucket.endsWith('-corrupt') && data.length > 0) {
      data = new Uint8Array(data);
      data[0] ^= 0x01;
    }
    const headers = {
      ETag: obj.etag,
      'x-cid': cidOf(obj.data),
      'Content-Type': obj.type ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Last-Modified': new Date().toUTCString(),
    };
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      const a = Number(range[1]);
      const b = range[2] === '' ? data.length - 1 : Math.min(Number(range[2]), data.length - 1);
      if (a >= data.length || b < a) {
        log(416);
        res.writeHead(416, { 'Content-Range': `bytes */${data.length}` });
        return res.end();
      }
      const slice = data.subarray(a, b + 1);
      log(206, `bytes ${a}-${b}`);
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${a}-${b}/${data.length}`, 'Content-Length': slice.length });
      return res.end(req.method === 'HEAD' ? undefined : Buffer.from(slice));
    }
    log(200, `${data.length} bytes`);
    res.writeHead(200, { ...headers, 'Content-Length': data.length });
    return res.end(req.method === 'HEAD' ? undefined : Buffer.from(data));
  }

  if (req.method === 'DELETE') {
    objects.delete(id);
    log(204);
    res.writeHead(204);
    return res.end();
  }

  error(res, 405, 'MethodNotAllowed', req.method);
}).listen(port, () => console.log(`mock S3 listening on http://localhost:${port} (buckets are created on first use)`));
