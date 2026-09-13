const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export function normalizeInputUrl(raw) {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  if (URL_SCHEME.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function extractFirstColumn(line) {
  const beforeComma = line.split(',')[0].trim();
  const quoted = /^(["'])(.*)\1$/.exec(beforeComma);
  return (quoted ? quoted[2] : beforeComma).trim();
}

function looksLikeHeader(value) {
  return !value.includes('.');
}

export function parseCsvUrls(csvText) {
  const lines = csvText.split('\n').map((line) => line.replace(/\r$/, ''));
  const urls = [];
  let sawFirstRow = false;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    const value = extractFirstColumn(trimmedLine);
    if (!value) continue;

    const isFirstRow = !sawFirstRow;
    sawFirstRow = true;
    if (isFirstRow && looksLikeHeader(value)) continue;

    const normalized = normalizeInputUrl(value);
    if (normalized === null) continue;

    urls.push(normalized);
  }

  return [...new Set(urls)];
}
