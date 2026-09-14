import path from 'node:path';
import fs from 'node:fs/promises';
import { writeJson } from '../images/manifest.js';
import { isSameOrigin } from '../utils/urls.js';

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

// Query/hash are intentionally ignored: nav pages rarely differ by query string, and any
// collision just overwrites the same PNG rather than needing a distinct slug.
export function deriveScreenshotSlug(url) {
  const segments = new URL(url).pathname.split('/').filter(Boolean);
  return segments.length ? segments.join('__') : 'home';
}

function collectNavTreeUrls(navTree) {
  const urls = [];
  for (const node of navTree ?? []) {
    if (node.url) urls.push(node.url);
    if (node.children?.length) urls.push(...collectNavTreeUrls(node.children));
  }
  return urls;
}

export function buildRenderTargets({ rootUrl, navTree, crawledUrls }) {
  const originUrl = new URL(rootUrl).origin;
  const crawledSet = new Set(crawledUrls);
  const candidateUrls = [rootUrl, ...collectNavTreeUrls(navTree)];

  const seen = new Set();
  const targets = [];
  for (const url of candidateUrls) {
    if (seen.has(url) || !isSameOrigin(url, originUrl) || !crawledSet.has(url)) continue;
    seen.add(url);
    targets.push({ url, slug: deriveScreenshotSlug(url) });
  }
  return targets;
}

async function saveScreenshotBuffer(outputBase, filename, buffer) {
  const screenshotsDir = path.join(outputBase, 'screenshots');
  await fs.mkdir(screenshotsDir, { recursive: true });
  await fs.writeFile(path.join(screenshotsDir, filename), buffer);
}

// A write failure (e.g. an invalid path character, or an over-long path) must degrade the
// same as a missing buffer, not propagate — one bad target's disk write should never abort
// captureViewport for the rest of the run.
async function tryWriteScreenshot(outputBase, filename, buffer) {
  try {
    await saveScreenshotBuffer(outputBase, filename, buffer);
    // Always forward-slash: this path lands in a JSON file read by tooling that may run on
    // any OS, regardless of what path.join produced for the actual on-disk write above.
    return `screenshots/${filename}`;
  } catch {
    return null;
  }
}

// Every capture (success or failure) is a logged network hit, same as a plain fetch — so
// throttle/onFetchLogged run unconditionally here, before checking whether a buffer came back.
// session.available is checked explicitly rather than delegated to withPage, since an
// unavailable session need not expose a callable withPage at all.
async function captureViewport(session, target, name, viewport, { outputBase, rateLimiter, onFetchLogged }) {
  await rateLimiter.throttle();
  const buffer = session.available
    ? await session.withPage(target.url, viewport, (page) => page.screenshot({ fullPage: true, type: 'png' }))
    : null;

  const filename = `${target.slug}-${name}.png`;
  const relativePath = buffer !== null ? await tryWriteScreenshot(outputBase, filename, buffer) : null;

  onFetchLogged?.({ url: target.url, status: relativePath !== null ? 200 : 0, timestamp: new Date().toISOString(), method: 'screenshot' });
  return relativePath;
}

function buildIndexEntry(target, { desktopPath, mobilePath, sessionAvailable }) {
  const failed = desktopPath === null || mobilePath === null;
  const error = failed ? (sessionAvailable ? 'render failed' : 'playwright unavailable') : null;
  return {
    url: target.url,
    slug: target.slug,
    desktop: desktopPath,
    mobile: mobilePath,
    capturedAt: new Date().toISOString(),
    error,
  };
}

export async function renderNavPages({ session, targets, outputBase, onFetchLogged, rateLimiter }) {
  const entries = [];
  for (const target of targets) {
    const captureOptions = { outputBase, rateLimiter, onFetchLogged };
    const desktopPath = await captureViewport(session, target, 'desktop', DESKTOP_VIEWPORT, captureOptions);
    const mobilePath = await captureViewport(session, target, 'mobile', MOBILE_VIEWPORT, captureOptions);
    entries.push(buildIndexEntry(target, { desktopPath, mobilePath, sessionAvailable: session.available }));
  }

  await writeJson(path.join(outputBase, 'screenshots', 'index.json'), entries);
  return entries;
}
