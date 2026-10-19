const IEC_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

/** Formats a byte count in IEC units: 1536 is "1.5 KiB". */
export function formatBytes(n: number, digits = 1): string {
  if (!Number.isFinite(n) || n < 0) return '–';
  let i = 0;
  let v = n;
  while (v >= 1024 && i < IEC_UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  const s = i === 0 ? String(n) : v.toFixed(digits).replace(/\.0+$/, '');
  return `${s} ${IEC_UNITS[i]}`;
}

/** Exact byte count with thousands separators. */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** Pretty-prints an XML document with two-space indentation. */
export function formatXml(text: string): string {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(`not XML: ${err.textContent ?? 'parse error'}`);
  return formatNode(doc.documentElement, 0);
}

function formatNode(el: Element, depth: number): string {
  const pad = '  '.repeat(depth);
  const children = Array.from(el.children);
  if (children.length === 0) {
    const text = (el.textContent ?? '').trim();
    return text === '' ? `${pad}<${el.tagName}/>` : `${pad}<${el.tagName}>${text}</${el.tagName}>`;
  }
  const inner = children.map((c) => formatNode(c, depth + 1)).join('\n');
  return `${pad}<${el.tagName}>\n${inner}\n${pad}</${el.tagName}>`;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
