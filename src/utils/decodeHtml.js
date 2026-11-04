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

export async function readResponseHtml(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  return new TextDecoder(pickCharset(response.headers.get('content-type'), bytes)).decode(bytes);
}
