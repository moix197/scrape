async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    return null;
  }
}

// Many widgets (lazy-loaded images, and especially lazy-hydrated video players like Wix's
// VideoPlayer) only mount their real content once scrolled into view, then take a moment to
// finish fetching it. A single full-height scroll wouldn't give each one along the way a chance
// to settle, so this steps down the page instead, pausing at each step.
async function autoScrollPage(page, { steps = 10, stepDelayMs = 400, settleMs = 4000 } = {}) {
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let step = 1; step <= steps; step += 1) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.round((height * step) / steps));
    await page.waitForTimeout(stepDelayMs);
  }
  await page.waitForTimeout(settleMs);
}

export async function renderWithPlaywright(url, { timeoutMs = 20000 } = {}) {
  const playwright = await loadPlaywright();
  if (!playwright) return null;

  let browser = null;
  try {
    browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage();
    // 'networkidle' never resolves on pages with persistent background traffic (analytics,
    // polling — confirmed against a real Wix site, where it reliably hit the full timeout) —
    // domcontentloaded plus the explicit scroll/settle wait below is both safer and, for
    // lazy-hydrated widgets, more effective than networkidle ever was.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await autoScrollPage(page);
    return await page.content();
  } catch {
    return null;
  } finally {
    if (browser) await browser.close();
  }
}
