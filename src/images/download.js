function isImageContentType(contentType) {
  return typeof contentType === 'string' && contentType.startsWith('image/');
}

export async function downloadImage(url, { timeoutMs = 15000, userAgent } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = userAgent ? { 'User-Agent': userAgent } : undefined;
    const response = await fetch(url, { signal: controller.signal, headers });

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    if (!isImageContentType(contentType)) return null;

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return { buffer, contentType, byteLength: buffer.length };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export { isImageContentType };
