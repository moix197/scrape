export function createRateLimiter(requestsPerSecond) {
  const intervalMs = 1000 / requestsPerSecond;
  let nextAvailableAt = 0;

  async function throttle() {
    const now = Date.now();
    const scheduledAt = Math.max(now, nextAvailableAt);
    nextAvailableAt = scheduledAt + intervalMs;

    const waitMs = scheduledAt - now;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  return { throttle };
}
