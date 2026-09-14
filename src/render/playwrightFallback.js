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

async function launchBrowser(playwright) {
  return await playwright.chromium.launch({ headless: true });
}

async function openPage(browser, { width, height }) {
  return await browser.newPage({ viewport: { width, height } });
}

async function runOnPage(page, url, timeoutMs, fn) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
    await autoScrollPage(page);
    return await fn(page);
  } catch {
    return null;
  } finally {
    await page.close();
  }
}

// One browser per scrape run (rather than one per page) so C07's screenshots and C08's
// computed-style sampling can share it with this render fallback. Chromium is launched lazily
// on the first withPage() call, so a run whose pages never need rendering never pays for it.
export async function createBrowserSession({ timeoutMs = 20000, loadPlaywright: load = loadPlaywright } = {}) {
  const playwright = await load();
  const available = playwright !== null;

  let browserPromise = null;
  function ensureBrowser() {
    if (!browserPromise) browserPromise = launchBrowser(playwright);
    return browserPromise;
  }

  async function withPage(url, viewport, fn) {
    if (!available) return null;
    try {
      const browser = await ensureBrowser();
      const page = await openPage(browser, viewport);
      return await runOnPage(page, url, timeoutMs, fn);
    } catch {
      return null;
    }
  }

  async function close() {
    if (!browserPromise) return;
    const browser = await browserPromise;
    await browser.close();
  }

  return { available, withPage, close };
}

export async function renderWithPlaywright(url, { session, timeoutMs = 20000 } = {}) {
  const ownSession = session ?? (await createBrowserSession({ timeoutMs }));
  try {
    const html = await ownSession.withPage(url, { width: 1280, height: 800 }, (page) => page.content());
    return html === null ? null : { html };
  } finally {
    if (!session) await ownSession.close();
  }
}
