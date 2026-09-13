import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractFontLinks } from '../src/extract/fonts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(__dirname, 'fixtures/fonts.html'), 'utf8');
const pageUrl = 'https://example.com/page';

test('extractFontLinks classifies google fonts stylesheet links', () => {
  const links = extractFontLinks(html, pageUrl);
  const googleFont = links.find((l) => l.url.includes('fonts.googleapis.com'));
  assert.ok(googleFont);
  assert.equal(googleFont.kind, 'google-fonts');
});

test('extractFontLinks classifies preload font links', () => {
  const links = extractFontLinks(html, pageUrl);
  const preload = links.find((l) => l.url === 'https://example.com/fonts/brand-sans.woff2');
  assert.ok(preload);
  assert.equal(preload.kind, 'preload-font');
});

test('extractFontLinks classifies other stylesheet links', () => {
  const links = extractFontLinks(html, pageUrl);
  const stylesheet = links.find((l) => l.url === 'https://example.com/css/main.css');
  assert.ok(stylesheet);
  assert.equal(stylesheet.kind, 'stylesheet');
});

test('extractFontLinks ignores unrelated link rels', () => {
  const links = extractFontLinks(html, pageUrl);
  assert.ok(!links.some((l) => l.url.includes('favicon.ico')));
});
