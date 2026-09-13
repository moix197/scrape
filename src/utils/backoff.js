const RETRYABLE_STATUSES = new Set([429, 503]);

function delayFor(attempt, baseDelayMs) {
  const ms = baseDelayMs * 2 ** attempt;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withBackoff(fn, { maxRetries = 5, baseDelayMs = 1000 } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const result = await fn();
      if (!RETRYABLE_STATUSES.has(result.status)) return result;
      if (attempt === maxRetries - 1) return result;
      await delayFor(attempt, baseDelayMs);
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries - 1) await delayFor(attempt, baseDelayMs);
    }
  }

  if (lastError) throw lastError;
  return fn();
}
