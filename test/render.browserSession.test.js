import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserSession, renderWithPlaywright } from '../src/render/playwrightFallback.js';

function makeFakePage({ content = '<html>ok</html>' } = {}) {
  const calls = { close: 0 };
  return {
    calls,
    goto: async () => {},
    evaluate: async () => 0,
    waitForTimeout: async () => {},
    content: async () => content,
    close: async () => {
      calls.close += 1;
    },
  };
}

function makeFakeLoader(fakeBrowser) {
  const calls = { launch: 0 };
  return {
    calls,
    load: async () => ({
      chromium: {
        launch: async () => {
          calls.launch += 1;
          return fakeBrowser;
        },
      },
    }),
  };
}

test('createBrowserSession with an unavailable loader resolves available:false and withPage/close are no-ops', async () => {
  const session = await createBrowserSession({ loadPlaywright: async () => null });
  assert.equal(session.available, false);

  const result = await session.withPage('https://x', { width: 1440, height: 900 }, () => 'never');
  assert.equal(result, null);

  await assert.doesNotReject(session.close());
});

test('createBrowserSession launches chromium exactly once across two withPage calls, and close() closes the browser', async () => {
  const pages = [makeFakePage(), makeFakePage()];
  let pageIndex = 0;
  const closeCalls = { count: 0 };
  const fakeBrowser = {
    newPage: async () => pages[pageIndex++],
    close: async () => {
      closeCalls.count += 1;
    },
  };
  const loader = makeFakeLoader(fakeBrowser);

  const session = await createBrowserSession({ loadPlaywright: loader.load });
  assert.equal(session.available, true);

  const first = await session.withPage('https://x', { width: 1280, height: 800 }, (page) => page.content());
  const second = await session.withPage('https://y', { width: 1280, height: 800 }, (page) => page.content());

  assert.equal(first, '<html>ok</html>');
  assert.equal(second, '<html>ok</html>');
  assert.equal(loader.calls.launch, 1, 'chromium.launch must only be called once across two withPage calls');
  assert.equal(pages[0].calls.close, 1, "each withPage's page must be closed afterwards");
  assert.equal(pages[1].calls.close, 1);

  await session.close();
  assert.equal(closeCalls.count, 1);
});

test('renderWithPlaywright resolves an object { html }, never a bare string', async () => {
  const fakePage = makeFakePage();
  const fakeBrowser = { newPage: async () => fakePage, close: async () => {} };
  const loader = makeFakeLoader(fakeBrowser);
  const session = await createBrowserSession({ loadPlaywright: loader.load });

  const rendered = await renderWithPlaywright('https://x', { session });
  assert.deepEqual(rendered, { html: '<html>ok</html>' });
});

test('a fn that throws inside withPage makes withPage resolve null, and the page is still closed', async () => {
  const fakePage = makeFakePage();
  const fakeBrowser = { newPage: async () => fakePage, close: async () => {} };
  const loader = makeFakeLoader(fakeBrowser);
  const session = await createBrowserSession({ loadPlaywright: loader.load });

  const result = await session.withPage('https://x', { width: 1280, height: 800 }, () => {
    throw new Error('boom');
  });

  assert.equal(result, null);
  assert.equal(fakePage.calls.close, 1, 'the page must still be closed when fn throws');
});
