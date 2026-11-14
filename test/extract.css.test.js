import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  extractLinkedStylesheetUrls,
  extractBackgroundImagesFromCss,
  extractLogoBackgroundFromCss,
  extractFontsFromCss,
} from '../src/extract/css.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(__dirname, 'fixtures/css.html'), 'utf8');
const css = readFileSync(path.join(__dirname, 'fixtures/styles.css'), 'utf8');
const pageUrl = 'https://example.com/page';

test('extractLinkedStylesheetUrls resolves link[rel=stylesheet] hrefs', () => {
  const urls = extractLinkedStylesheetUrls(html, pageUrl);
  assert.deepEqual(urls, ['https://example.com/css/main.css']);
});

test('extractBackgroundImagesFromCss finds background and background-image urls', () => {
  const urls = extractBackgroundImagesFromCss(css, pageUrl);
  assert.ok(urls.includes('https://example.com/images/hero-bg.jpg'));
  assert.ok(urls.includes('https://example.com/images/banner-bg.png'));
});

test('extractBackgroundImagesFromCss ignores non-background url() declarations', () => {
  const urls = extractBackgroundImagesFromCss(css, pageUrl);
  assert.ok(!urls.includes('https://example.com/not-a-background.png'));
});

test('extractBackgroundImagesFromCss skips data: URIs and dedupes', () => {
  const urls = extractBackgroundImagesFromCss(css, pageUrl);
  assert.ok(!urls.some((u) => u.startsWith('data:')));
  assert.equal(urls.length, new Set(urls).size);
});

test('extractFontsFromCss parses multiple src entries with formats', () => {
  const fonts = extractFontsFromCss(css, pageUrl);
  const woff2 = fonts.find((f) => f.url === 'https://example.com/fonts/brand-sans.woff2');
  const woff = fonts.find((f) => f.url === 'https://example.com/fonts/brand-sans.woff');
  assert.ok(woff2);
  assert.equal(woff2.format, 'woff2');
  assert.equal(woff2.fontFamily, 'Brand Sans');
  assert.ok(woff);
  assert.equal(woff.format, 'woff');
});

test('extractFontsFromCss handles missing format', () => {
  const fonts = extractFontsFromCss(css, pageUrl);
  const ttf = fonts.find((f) => f.url === 'https://example.com/fonts/brand-serif.ttf');
  assert.ok(ttf);
  assert.equal(ttf.format, null);
  assert.equal(ttf.fontFamily, 'Brand Serif');
});

test('extractLogoBackgroundFromCss picks the #logo background, ignoring comments and decorative backgrounds', () => {
  const css = `body { background: url(fondo.gif) }
    #logo { width: 194px; background:url('imagenes/logo.gif') top left no-repeat; }
    #logo a:link { /* background:url('x.gif') */ display:block }`;
  assert.deepEqual(extractLogoBackgroundFromCss(css, 'http://example.com/estilos.css'), {
    url: 'http://example.com/imagenes/logo.gif',
    selector: '#logo',
  });
  assert.equal(extractLogoBackgroundFromCss('#footer { background:url(pie.gif) }', 'http://example.com/a.css'), null);
});

test('extractLogoBackgroundFromCss picks the home link inside #logo (image replacement), not other descendants or hover', () => {
  // kraft-liner.com.ar: <h1 id="logo"><a href="index.html"></a></h1>, the logo on the link.
  const css = `h1#logo { display:inline-block; }
    h1#logo span { background:url(../images/swoosh.png) }
    h1#logo a:hover { background:url(../images/bg-logo-hover.png) }
    h1#logo a { display:block; text-indent:-9999px; background:url(../images/bg-logo.png) left top no-repeat; }`;
  assert.deepEqual(extractLogoBackgroundFromCss(css, 'http://kraft-liner.com.ar/css/styles.css'), {
    url: 'http://kraft-liner.com.ar/images/bg-logo.png',
    selector: 'h1#logo a',
  });
});
