import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractVisibleText, extractPageMeta, extractSiteMeta } from '../src/extract/copy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(__dirname, 'fixtures/copy.html'), 'utf8');

test('extractVisibleText strips script/style/noscript/template content', () => {
  const text = extractVisibleText(html);
  assert.ok(!text.includes('noise'));
  assert.ok(!text.includes('not appear in visible text'));
  assert.ok(!text.includes('Enable JavaScript'));
  assert.ok(!text.includes('hidden template content'));
});

test('extractVisibleText collapses whitespace and trims', () => {
  const text = extractVisibleText(html);
  assert.ok(text.includes('This is some visible copy.'));
  assert.equal(text, text.trim());
  assert.ok(!/\s{2,}/.test(text));
});

test('extractVisibleText keeps visible content', () => {
  const text = extractVisibleText(html);
  assert.ok(text.includes('Welcome'));
});

test('extractPageMeta reads trimmed title and description', () => {
  const meta = extractPageMeta(html, 'https://acme.test/x/');
  assert.equal(meta.title, 'Copy Fixture');
  assert.equal(meta.description, 'A page about testing copy extraction.');
});

test('extractPageMeta defaults to empty strings when absent', () => {
  const meta = extractPageMeta('<html><head></head><body></body></html>', 'https://acme.test/x/');
  assert.equal(meta.title, '');
  assert.equal(meta.description, '');
});

test('extractPageMeta resolves canonical, og, and jsonLd, skipping invalid JSON-LD', () => {
  const meta = extractPageMeta(html, 'https://acme.test/x/');
  assert.deepEqual(meta, {
    title: 'Copy Fixture',
    description: 'A page about testing copy extraction.',
    canonical: 'https://acme.test/about/',
    og: { title: 'OG Title', description: 'OG desc', image: 'https://acme.test/img/og.jpg' },
    jsonLd: [{ '@type': 'LocalBusiness', name: 'Acme' }],
  });
});

test('extractPageMeta defaults canonical/og/jsonLd when absent', () => {
  const meta = extractPageMeta('<html><head><title>t</title></head></html>', 'https://acme.test/x/');
  assert.equal(meta.canonical, null);
  assert.deepEqual(meta.og, { title: null, description: null, image: null });
  assert.deepEqual(meta.jsonLd, []);
});

test('extractSiteMeta reads html lang and resolves favicon', () => {
  const site = extractSiteMeta(html, 'https://acme.test/');
  assert.deepEqual(site, { lang: 'en-GB', favicon: 'https://acme.test/favicon.ico' });
});

test('extractSiteMeta defaults to null when lang/favicon absent', () => {
  const site = extractSiteMeta('<html><head><title>t</title></head></html>', 'https://acme.test/');
  assert.deepEqual(site, { lang: null, favicon: null });
});
