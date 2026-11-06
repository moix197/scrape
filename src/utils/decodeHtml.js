const DECLARED_CHARSET_PATTERN = /charset\s*=\s*["']?\s*([\w.:-]+)/i;
const SNIFF_BYTES = 4096;

function isSupportedCharset(label) {
  try {
    new TextDecoder(label);
    return true;
  } catch {
    return false;
  }
}

function charsetFromContentType(contentType) {
  const label = DECLARED_CHARSET_PATTERN.exec(contentType ?? '')?.[1];
  return label && isSupportedCharset(label) ? label : null;
}

function charsetFromMeta(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, SNIFF_BYTES));
  const metaTags = head.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const label = DECLARED_CHARSET_PATTERN.exec(tag)?.[1];
    if (label && isSupportedCharset(label)) return label;
  }
  return null;
}

function decodesCleanly(label, bytes) {
  try {
    new TextDecoder(label, { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

// Servers often send a UTF-8 header for Latin-1 bytes (or vice versa), so a declared charset
// only wins if the bytes actually decode under it; otherwise try the next candidate.
export function pickCharset(contentType, bytes) {
  const candidates = [charsetFromContentType(contentType), charsetFromMeta(bytes), 'utf-8'].filter(Boolean);
  return candidates.find((label) => decodesCleanly(label, bytes)) ?? 'windows-1252';
}

const HTML_MEDIA_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const MEDIA_TYPE_PATTERN = /^[\w.+-]+\/[\w.+-]+$/;
const BINARY_MAGIC = ['%PDF', 'PK\x03\x04', 'GIF8', '\x89PNG', 'Rar!', '\x1f\x8b', '\xff\xd8\xff'];

function looksBinary(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, SNIFF_BYTES));
  return head.includes('\0') || BINARY_MAGIC.some((magic) => head.startsWith(magic));
}

// Old PHP sites send e.g. "Content-Type: charset=utf-8" with no media type; treat that like a
// missing header rather than a non-HTML one.
function declaredMediaType(contentType) {
  const mediaType = (contentType ?? '').split(';')[0].trim().toLowerCase();
  return MEDIA_TYPE_PATTERN.test(mediaType) ? mediaType : null;
}

// Trust a declared media type; when the header has none, sniff the bytes instead.
export function isHtmlPayload(contentType, bytes) {
  if (looksBinary(bytes)) return false;
  const mediaType = declaredMediaType(contentType);
  return mediaType ? HTML_MEDIA_TYPES.has(mediaType) : true;
}

export async function readResponseHtml(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get('content-type');
  if (!isHtmlPayload(contentType, bytes)) return null;
  return new TextDecoder(pickCharset(contentType, bytes)).decode(bytes);
}
