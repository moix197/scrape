export function dedupeByUrl(urls) {
  return [...new Set(urls)];
}

export function createContentDedupe() {
  const hashes = new Map();
  return {
    hasHash(hex) {
      return hashes.has(hex);
    },
    addHash(hex, entry = null) {
      hashes.set(hex, entry);
    },
    getExisting(hex) {
      return hashes.get(hex) ?? null;
    },
  };
}

function meetsMinDimension(value, min) {
  return value === null || value === undefined || value >= min;
}

export function passesSizeFilter(
  { width, height, byteLength },
  { minWidth = 100, minHeight = 100, minBytes = 2048 } = {}
) {
  return (
    meetsMinDimension(width, minWidth) &&
    meetsMinDimension(height, minHeight) &&
    byteLength >= minBytes
  );
}
