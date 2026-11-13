import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLinksFromPage } from '../src/crawler.js';

const html = `<a href="/about">About</a><a href="/index.html">Home</a>
<a href="/docs/a.pdf"> Cat\n  alog </a><a href="https://other.com/b.pdf">x</a>
<a href="/big/x.jpg" rel="lightbox"><img alt="Big"></a><a href="/z.zip">zip</a>`;

test('extractLinksFromPage splits pages, documents and linked images', () => {
  const r = extractLinksFromPage(html, 'https://example.com/', 'https://example.com');
  assert.deepEqual(r.links, ['https://example.com/about', 'https://example.com/']);
  assert.deepEqual(r.documents, [{ url: 'https://example.com/docs/a.pdf', text: 'Cat alog', page: 'https://example.com/', external: false },
    { url: 'https://other.com/b.pdf', text: 'x', page: 'https://example.com/', external: true }]);
  assert.equal(r.linkedImages[0].url, 'https://example.com/big/x.jpg');
  assert.equal(r.linkedImages[0].source, 'linked-image');
});

test('extractLinksFromPage follows onclick location.href navigations (model pickers)', () => {
  const page = `<div id="b17" onclick= "location.href='index.php?categoria=barcos&modelo=17'"> </div>
<button onclick="window.location = '/x.pdf'">pdf</button><div onclick="location.href='https://other.com/a'"></div>`;
  const r = extractLinksFromPage(page, 'http://site.com/', 'http://site.com');
  assert.deepEqual(r.links, ['http://site.com/?categoria=barcos&modelo=17']);
});
