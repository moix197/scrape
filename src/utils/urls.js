export function resolveUrl(baseUrl, maybeRelativeUrl) {
  if (!maybeRelativeUrl || typeof maybeRelativeUrl !== 'string') return null;
  try {
    return new URL(maybeRelativeUrl, baseUrl).toString();
  } catch {
    return null;
  }
}

export function isSameOrigin(url, originUrl) {
  try {
    const a = new URL(url);
    const b = new URL(originUrl);
    return a.protocol === b.protocol && a.host === b.host;
  } catch {
    return false;
  }
}

export function getDomainFolderName(url) {
  const hostname = new URL(url).hostname;
  return hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
}

export function normalizeUrl(url) {
  const parsed = new URL(url);
  parsed.hash = '';
  // "/index.html" and "/foo/index.html" are the same page as "/" and "/foo/".
  parsed.pathname = parsed.pathname.replace(/\/index\.(?:html?|php)$/i, '/');
  if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  }
  return parsed.toString();
}
