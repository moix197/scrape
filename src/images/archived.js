import { downloadImage } from './download.js';

// A dead logo (aguapelodge.com: every /images/ file answers 404, its logo too) is fetched from the Wayback Machine's
// closest snapshot, raw (the `if_` mode serves the archived bytes without the archive's toolbar): the business's own
// mark, never a guessed one. Only the detected logo goes this way; no snapshot means no logo, as before.
const AVAILABILITY_API = 'https://archive.org/wayback/available?url=';

/** The raw-bytes URL of a snapshot page URL ("…/web/20240721051840/http://x/logo.png" -> "…/web/20240721051840if_/http://x/logo.png"). */
export function rawSnapshotUrl(snapshotUrl) {
  return snapshotUrl.replace(/\/web\/(\d+)\//, '/web/$1if_/');
}

export async function downloadArchivedImage(url, { userAgent, timeoutMs = 15000 } = {}) {
  try {
    const response = await fetch(`${AVAILABILITY_API}${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const snapshot = (await response.json())?.archived_snapshots?.closest;
    if (!snapshot?.available || snapshot.status !== '200' || !snapshot.url) return null;
    return await downloadImage(rawSnapshotUrl(snapshot.url), { userAgent, timeoutMs });
  } catch {
    return null;
  }
}
