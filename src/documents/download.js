import fs from 'node:fs/promises';
import path from 'node:path';
import { sha1Hex } from '../utils/hash.js';

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

function localDocumentName(url) {
  const { pathname } = new URL(url);
  const base = path.posix.basename(pathname).replace(/[^a-zA-Z0-9._-]/g, '_') || 'document';
  return `${sha1Hex(url).slice(0, 8)}-${base}`;
}

async function fetchDocumentBuffer(url, { userAgent, timeoutMs = 30000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': userAgent } });
    if (!response.ok) return { status: `http-${response.status}` };
    const declared = Number(response.headers.get('content-length'));
    if (declared > MAX_DOCUMENT_BYTES) return { status: 'too-large', size: declared };
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_DOCUMENT_BYTES) return { status: 'too-large', size: buffer.length };
    return { status: 'ok', buffer };
  } catch {
    return { status: 'error' };
  } finally {
    clearTimeout(timeout);
  }
}

// One row per document: { url, file, text, page, external, size, status }. `file` is a path relative to the
// scrape folder (docs/<name>) or null when the download failed (originals may 404) or was too large.
export async function downloadDocuments(documents, { outputBase, userAgent }) {
  const rows = [];
  for (const doc of documents) {
    const result = await fetchDocumentBuffer(doc.url, { userAgent });
    let file = null;
    if (result.buffer) {
      file = `docs/${localDocumentName(doc.url)}`;
      await fs.mkdir(path.join(outputBase, 'docs'), { recursive: true });
      await fs.writeFile(path.join(outputBase, file), result.buffer);
    }
    rows.push({ url: doc.url, file, text: doc.text, page: doc.page, external: doc.external, size: result.buffer?.length ?? result.size ?? null, status: result.status });
  }
  return rows;
}
