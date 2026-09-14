import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  deriveScreenshotSlug,
  buildRenderTargets,
  renderNavPages,
} from '../src/render/renderNavPages.js';

function makeFakeRateLimiter() {
  const calls = { throttle: 0 };
  return { calls, throttle: async () => { calls.throttle += 1; } };
}

function makeFakeLogger() {
  const entries = [];
  return { entries, onFetchLogged: (entry) => entries.push(entry) };
}

function makeAvailableSession() {
  const calls = { withPage: [] };
  return {
    available: true,
    calls,
    withPage: async (url, viewport, fn) => {
      calls.withPage.push({ url, viewport });
      return fn({
        screenshot: async (options) => {
          calls.withPage[calls.withPage.length - 1].screenshotOptions = options;
          return Buffer.from('png');
        },
      });
    },
  };
}

async function makeTempOutputBase() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'render-nav-pages-'));
}

test('deriveScreenshotSlug: home for root, single segment, __-joined for nested', () => {
  assert.equal(deriveScreenshotSlug('https://a.test/'), 'home');
  assert.equal(deriveScreenshotSlug('https://a.test/about'), 'about');
  assert.equal(deriveScreenshotSlug('https://a.test/services/weddings/'), 'services__weddings');
});

test('buildRenderTargets: home first, dedupes, drops off-origin and non-crawled, walks nested children', () => {
  const navTree = [
    { url: 'https://a.test/about', text: 'About' },
    {
      url: null,
      text: 'Services',
      children: [
        { url: 'https://a.test/services/weddings', text: 'Weddings' },
        { url: 'https://other.test/evil', text: 'Off-origin' },
        { url: 'https://a.test/services/weddings', text: 'Duplicate' },
      ],
    },
    { url: 'https://a.test/not-crawled', text: 'Missing' },
  ];
  const targets = buildRenderTargets({
    rootUrl: 'https://a.test/',
    navTree,
    crawledUrls: ['https://a.test/', 'https://a.test/about', 'https://a.test/services/weddings'],
  });

  assert.deepEqual(
    targets.map((t) => t.url),
    ['https://a.test/', 'https://a.test/about', 'https://a.test/services/weddings'],
  );
  assert.equal(targets[0].slug, 'home');
  assert.equal(targets[2].slug, 'services__weddings');
});

test('renderNavPages with an available session writes PNGs and an index.json entry per target', async () => {
  const session = makeAvailableSession();
  const rateLimiter = makeFakeRateLimiter();
  const logger = makeFakeLogger();
  const outputBase = await makeTempOutputBase();
  const targets = [{ url: 'https://a.test/', slug: 'home' }];

  const entries = await renderNavPages({ session, targets, outputBase, onFetchLogged: logger.onFetchLogged, rateLimiter });

  const desktopBuffer = await fs.readFile(path.join(outputBase, 'screenshots', 'home-desktop.png'));
  const mobileBuffer = await fs.readFile(path.join(outputBase, 'screenshots', 'home-mobile.png'));
  assert.equal(desktopBuffer.toString(), 'png');
  assert.equal(mobileBuffer.toString(), 'png');

  const indexJson = JSON.parse(await fs.readFile(path.join(outputBase, 'screenshots', 'index.json'), 'utf8'));
  assert.deepEqual(indexJson, entries);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].error, null);
  assert.equal(entries[0].desktop, 'screenshots/home-desktop.png');
  assert.equal(entries[0].mobile, 'screenshots/home-mobile.png');
  assert.match(entries[0].capturedAt, /^\d{4}-\d{2}-\d{2}T/);

  assert.equal(logger.entries.length, 2);
  for (const entry of logger.entries) {
    assert.equal(entry.method, 'screenshot');
    assert.equal(entry.status, 200);
  }
  assert.equal(rateLimiter.calls.throttle, 2);
});

test('renderNavPages: desktop viewport is 1440x900, mobile is 390x844, both fullPage png', async () => {
  const session = makeAvailableSession();
  const outputBase = await makeTempOutputBase();
  const targets = [{ url: 'https://a.test/', slug: 'home' }];

  await renderNavPages({
    session,
    targets,
    outputBase,
    onFetchLogged: () => {},
    rateLimiter: makeFakeRateLimiter(),
  });

  const [desktopCall, mobileCall] = session.calls.withPage;
  assert.deepEqual(desktopCall.viewport, { width: 1440, height: 900 });
  assert.deepEqual(desktopCall.screenshotOptions, { fullPage: true, type: 'png' });
  assert.deepEqual(mobileCall.viewport, { width: 390, height: 844 });
  assert.deepEqual(mobileCall.screenshotOptions, { fullPage: true, type: 'png' });
});

test('renderNavPages with an unavailable session degrades: no PNGs, error set, never throws, status 0', async () => {
  const session = { available: false };
  const rateLimiter = makeFakeRateLimiter();
  const logger = makeFakeLogger();
  const outputBase = await makeTempOutputBase();
  const targets = [{ url: 'https://a.test/', slug: 'home' }];

  const entries = await renderNavPages({ session, targets, outputBase, onFetchLogged: logger.onFetchLogged, rateLimiter });

  await assert.rejects(fs.readFile(path.join(outputBase, 'screenshots', 'home-desktop.png')));
  await assert.rejects(fs.readFile(path.join(outputBase, 'screenshots', 'home-mobile.png')));

  assert.equal(entries.length, 1);
  assert.equal(entries[0].error, 'playwright unavailable');
  assert.equal(entries[0].desktop, null);
  assert.equal(entries[0].mobile, null);

  assert.equal(logger.entries.length, 2);
  for (const entry of logger.entries) assert.equal(entry.status, 0);
  assert.equal(rateLimiter.calls.throttle, 2);
});

test('renderNavPages: a withPage call resolving null degrades that target with "render failed", other targets unaffected', async () => {
  const session = {
    available: true,
    withPage: async (url, viewport, fn) => {
      if (url === 'https://a.test/broken') return null;
      return fn({ screenshot: async () => Buffer.from('png') });
    },
  };
  const outputBase = await makeTempOutputBase();
  const targets = [
    { url: 'https://a.test/', slug: 'home' },
    { url: 'https://a.test/broken', slug: 'broken' },
  ];

  const entries = await renderNavPages({
    session,
    targets,
    outputBase,
    onFetchLogged: () => {},
    rateLimiter: makeFakeRateLimiter(),
  });

  assert.equal(entries[0].error, null);
  assert.equal(entries[1].error, 'render failed');
  assert.equal(entries[1].desktop, null);
  assert.equal(entries[1].mobile, null);
});
