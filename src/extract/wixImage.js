// Wix (and Wix-derived) sites render backgrounds/lazy images through a <wow-image> custom
// element instead of a plain <img src>: the inner <img> carries no src/data-src at all, and the
// real image lives in the wrapper's `data-image-info` JSON attribute as a bare filename (e.g.
// "89d44b_...~mv2_d_5760_3840_s_4_2.jpg") that resolves through Wix's media CDN. Site builders
// like this are common among the small-business sites this scraper targets, so both the
// per-section extractor (structure.js) and the sitewide image-discovery pass (images.js) need
// this — kept here once so neither reimplements the JSON shape or the CDN URL format.
const WIX_MEDIA_BASE = 'https://static.wixstatic.com/media/';

// Returns the real (full-resolution) image behind a <wow-image>, plus its intrinsic
// width/height from the same JSON — the wrapped <img>'s own width/height attributes only
// reflect the CSS-rendered box size (e.g. a 490x252 thumbnail crop of a 5760x3840 source), so
// they'd under-report size to the min-dimension filter if used instead.
export function resolveWowImage(dataImageInfo) {
  if (!dataImageInfo) return null;
  let parsed;
  try {
    parsed = JSON.parse(dataImageInfo);
  } catch {
    return null;
  }
  const { uri, width, height } = parsed?.imageData ?? {};
  if (typeof uri !== 'string' || !uri) return null;
  return { url: `${WIX_MEDIA_BASE}${uri}`, width: width ?? null, height: height ?? null };
}
