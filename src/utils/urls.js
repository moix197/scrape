export function resolveUrl(baseUrl, maybeRelativeUrl) {
  if (!maybeRelativeUrl || typeof maybeRelativeUrl !== 'string') return null;
  try {
    return new URL(maybeRelativeUrl, baseUrl).toString();
  } catch {
    return null;
  }
}

// www.example.com and example.com are one site: a WordPress menu can link the bare host while the start URL has www
// (estancialaestela.com.ar's Actividades and Eventos were never crawled).
const siteHost = (host) => host.toLowerCase().replace(/^www\./, '');

export function isSameOrigin(url, originUrl) {
  try {
    const a = new URL(url);
    const b = new URL(originUrl);
    return a.protocol === b.protocol && siteHost(a.host) === siteHost(b.host);
  } catch {
    return false;
  }
}

/** The same-site URL on the origin's own host, so www and bare-host links to one page are crawled once. */
export function onOriginHost(url, originUrl) {
  const parsed = new URL(url);
  parsed.host = new URL(originUrl).host;
  return parsed.toString();
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
