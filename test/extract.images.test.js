import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractImages } from '../src/extract/images.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(__dirname, 'fixtures/images.html'), 'utf8');
const pageUrl = 'https://example.com/page';

test('extractImages finds plain img src', () => {
  const images = extractImages(html, pageUrl);
  const hero = images.find((img) => img.url === 'https://example.com/images/hero.jpg');
  assert.ok(hero);
  assert.equal(hero.source, 'img-src');
  assert.equal(hero.alt, 'Hero banner');
  assert.equal(hero.width, 800);
  assert.equal(hero.height, 400);
});

test('extractImages parses img srcset entries', () => {
  const images = extractImages(html, pageUrl);
  const small = images.find((img) => img.url === 'https://example.com/images/small.jpg');
  const large = images.find((img) => img.url === 'https://example.com/images/large.jpg');
  assert.ok(small);
  assert.ok(large);
  assert.equal(small.source, 'srcset');
  assert.equal(large.source, 'srcset');
});

test('extractImages parses picture source srcset', () => {
  const images = extractImages(html, pageUrl);
  const picSmall = images.find((img) => img.url === 'https://example.com/images/pic-small.webp');
  assert.ok(picSmall);
  assert.equal(picSmall.source, 'picture-source');
});

test('extractImages picks up data-src and data-lazy-src', () => {
  const images = extractImages(html, pageUrl);
  const lazy = images.find((img) => img.url === 'https://example.com/images/lazy.jpg');
  const lazy2 = images.find((img) => img.url === 'https://example.com/images/lazy2.jpg');
  assert.ok(lazy);
  assert.equal(lazy.source, 'data-src');
  assert.ok(lazy2);
  assert.equal(lazy2.source, 'data-lazy-src');
});

test('extractImages drops data: URIs', () => {
  const images = extractImages(html, pageUrl);
  assert.ok(!images.some((img) => img.url.startsWith('data:')));
});

test('extractImages defaults missing width/height to null', () => {
  const images = extractImages(html, pageUrl);
  const lazy = images.find((img) => img.url === 'https://example.com/images/lazy.jpg');
  assert.equal(lazy.width, null);
  assert.equal(lazy.height, null);
});

test('extractImages resolves a Wix <wow-image>\'s real url and intrinsic size from data-image-info, not the rendered <img>\'s box size', () => {
  const images = extractImages(html, pageUrl);
  const wix = images.find((img) => img.url === 'https://static.wixstatic.com/media/89d44b_wix~mv2_d_5760_3840.jpg');
  assert.ok(wix);
  assert.equal(wix.source, 'wow-image');
  assert.equal(wix.alt, 'Wix background');
  assert.equal(wix.width, 5760);
  assert.equal(wix.height, 3840);
});

test('extractImages finds image string literals in inline scripts, in order, resolved against the page', () => {
  const html = `<script>var g = new fadeSlideShow({ wrapperid: "show", imagearray: [["imagenes/a.jpg"], ['imagenes/b.png'] ] })</script>`;
  const urls = extractImages(html, 'http://example.com/bajos.html').map((i) => i.url);
  assert.deepEqual(urls, ['http://example.com/imagenes/a.jpg', 'http://example.com/imagenes/b.png']);
});
