import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pickVisibleMatch, readSample, aggregateSiteStyle } from '../src/render/computedStyle.js';
import { renderNavPages } from '../src/render/renderNavPages.js';

function sample(selector, { color = 'transparent', backgroundColor = 'transparent', fontFamily = 'Arial', fontWeight = '400' } = {}) {
  return { selector, color, backgroundColor, fontFamily, fontWeight };
}

test('aggregateSiteStyle: same background color on button|.btn|[role=button] across two pages sums to score 10', () => {
  const buttonSample = sample('button|.btn|[role=button]', { backgroundColor: 'rgb(255, 0, 80)' });
  const { colors } = aggregateSiteStyle([{ samples: [buttonSample] }, { samples: [buttonSample] }]);
  assert.deepEqual(colors[0], { hex: '#ff0050', score: 10, roles: ['button|.btn|[role=button]'] });
});

test('aggregateSiteStyle: transparent and rgba(0,0,0,0) never appear in colors', () => {
  const s = sample('body', { color: 'rgba(0, 0, 0, 0)', backgroundColor: 'transparent' });
  const { colors } = aggregateSiteStyle([{ samples: [s] }]);
  assert.deepEqual(colors, []);
});

test('aggregateSiteStyle: body color rgb(17,17,17) scores 3 with roles [body]', () => {
  const s = sample('body', { color: 'rgb(17, 17, 17)' });
  const { colors } = aggregateSiteStyle([{ samples: [s] }]);
  assert.deepEqual(colors[0], { hex: '#111111', score: 3, roles: ['body'] });
});

test('aggregateSiteStyle: a hex on both a and nav accumulates score 8 with roles [a, nav]', () => {
  const aSample = sample('a', { color: 'rgb(10, 20, 30)' });
  const navSample = sample('nav', { backgroundColor: 'rgb(10, 20, 30)' });
  const { colors } = aggregateSiteStyle([{ samples: [aSample, navSample] }]);
  assert.deepEqual(colors[0], { hex: '#0a141e', score: 8, roles: ['a', 'nav'] });
});

test('aggregateSiteStyle: colors capped at 8 entries, sorted by score desc', () => {
  const counts = [
    ['#111111', 9], ['#222222', 8], ['#333333', 7], ['#444444', 6],
    ['#555555', 5], ['#666666', 4], ['#777777', 3], ['#888888', 2], ['#999999', 1],
  ];
  const samples = counts.flatMap(([hex, count]) =>
    Array.from({ length: count }, () => sample('a', { color: hex })),
  );
  const { colors } = aggregateSiteStyle([{ samples }]);
  assert.equal(colors.length, 8);
  assert.deepEqual(colors.map((c) => c.hex), counts.slice(0, 8).map(([hex]) => hex));
  for (let i = 1; i < colors.length; i += 1) assert.ok(colors[i - 1].score >= colors[i].score);
});

test('aggregateSiteStyle: fonts group by family+weight, roles unique, sorted by roles.length desc', () => {
  const h1 = sample('h1', { fontFamily: '"Playfair Display", serif', fontWeight: '700' });
  const h2 = sample('h2', { fontFamily: '"Playfair Display", serif', fontWeight: '700' });
  const body = sample('body', { fontFamily: 'Arial, sans-serif', fontWeight: '400' });
  const { fonts } = aggregateSiteStyle([{ samples: [h1, h2, body] }]);
  assert.deepEqual(fonts[0], { family: 'Playfair Display', weight: '700', roles: ['h1', 'h2'] });
  assert.equal(fonts[1].family, 'Arial');
});

test('aggregateSiteStyle: empty input yields { fonts: [], colors: [] }', () => {
  assert.deepEqual(aggregateSiteStyle([]), { fonts: [], colors: [] });
});

test('pickVisibleMatch: skips a hidden element (no rects or visibility:hidden), returns first visible', () => {
  const hiddenByRects = { getClientRects: () => [] };
  const hiddenByVisibility = { getClientRects: () => [{}], _visibility: 'hidden' };
  const visible = { getClientRects: () => [{}], _visibility: 'visible' };
  const getComputedStyle = (el) => ({ visibility: el._visibility ?? 'visible' });

  const document1 = { querySelectorAll: () => [hiddenByRects, visible] };
  assert.equal(pickVisibleMatch(document1, getComputedStyle, 'a'), visible);

  const document2 = { querySelectorAll: () => [hiddenByVisibility, visible] };
  assert.equal(pickVisibleMatch(document2, getComputedStyle, 'a'), visible);

  const document3 = { querySelectorAll: () => [hiddenByRects, hiddenByVisibility] };
  assert.equal(pickVisibleMatch(document3, getComputedStyle, 'a'), null);
});

test('readSample: returns exactly the five fields with raw computed strings', () => {
  const el = {};
  const getComputedStyle = () => ({
    fontFamily: 'Arial',
    color: 'rgb(1, 2, 3)',
    backgroundColor: 'rgb(4, 5, 6)',
    fontWeight: '400',
    extra: 'ignored',
  });
  assert.deepEqual(readSample(getComputedStyle, 'body', el), {
    selector: 'body',
    fontFamily: 'Arial',
    color: 'rgb(1, 2, 3)',
    backgroundColor: 'rgb(4, 5, 6)',
    fontWeight: '400',
  });
});

async function makeTempOutputBase() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'render-computed-style-'));
}

test('renderNavPages: writes computed-style.json with pages:[] and empty site aggregate when session unavailable', async () => {
  const session = { available: false };
  const outputBase = await makeTempOutputBase();
  const targets = [{ url: 'https://a.test/', slug: 'home' }];

  await renderNavPages({ session, targets, outputBase, onFetchLogged: () => {}, rateLimiter: { throttle: async () => {} } });

  const computedStyle = JSON.parse(await fs.readFile(path.join(outputBase, 'computed-style.json'), 'utf8'));
  assert.deepEqual(computedStyle, { pages: [], site: { fonts: [], colors: [] } });
});

test('renderNavPages: one pages entry per successful desktop visit, using canned page.evaluate samples', async () => {
  const canned = [sample('body', { color: 'rgb(17, 17, 17)' })];
  const session = {
    available: true,
    withPage: async (url, viewport, fn) =>
      fn({
        screenshot: async () => Buffer.from('png'),
        evaluate: async () => canned,
      }),
  };
  const outputBase = await makeTempOutputBase();
  const targets = [
    { url: 'https://a.test/', slug: 'home' },
    { url: 'https://a.test/about', slug: 'about' },
  ];

  await renderNavPages({ session, targets, outputBase, onFetchLogged: () => {}, rateLimiter: { throttle: async () => {} } });

  const computedStyle = JSON.parse(await fs.readFile(path.join(outputBase, 'computed-style.json'), 'utf8'));
  assert.equal(computedStyle.pages.length, 2);
  assert.deepEqual(computedStyle.pages[0], { url: 'https://a.test/', slug: 'home', samples: canned });
  assert.deepEqual(computedStyle.site.colors[0], { hex: '#111111', score: 6, roles: ['body'] });
});
