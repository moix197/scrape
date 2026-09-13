import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractVideos } from '../src/extract/videos.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(__dirname, 'fixtures/videos.html'), 'utf8');
const pageUrl = 'https://example.com/page';

test('extractVideos captures video src attribute with poster', () => {
  const videos = extractVideos(html, pageUrl);
  const heroVideo = videos.find((v) => v.url === 'https://example.com/media/hero.mp4');
  assert.ok(heroVideo);
  assert.equal(heroVideo.source, 'video-src');
  assert.equal(heroVideo.type, null);
  assert.equal(heroVideo.poster, 'https://example.com/media/hero-poster.jpg');
});

test('extractVideos captures source children of video with type and inherited poster', () => {
  const videos = extractVideos(html, pageUrl);
  const webm = videos.find((v) => v.url === 'https://example.com/media/reel.webm');
  const mp4 = videos.find((v) => v.url === 'https://example.com/media/reel.mp4');
  assert.ok(webm);
  assert.ok(mp4);
  assert.equal(webm.source, 'video-source');
  assert.equal(webm.type, 'video/webm');
  assert.equal(webm.poster, 'https://example.com/media/reel-poster.jpg');
  assert.equal(mp4.type, 'video/mp4');
});

test('extractVideos captures lazy-load data-src and data-lazy-src attributes', () => {
  const videos = extractVideos(html, pageUrl);
  const lazy = videos.find((v) => v.url === 'https://example.com/media/lazy.mp4');
  const lazyAlt = videos.find((v) => v.url === 'https://example.com/media/lazy-alt.mp4');
  assert.ok(lazy);
  assert.ok(lazyAlt);
  assert.equal(lazy.source, 'video-data-src');
  assert.equal(lazyAlt.source, 'video-data-src');
});

test('extractVideos skips data: URI video sources', () => {
  const videos = extractVideos(html, pageUrl);
  assert.ok(!videos.some((v) => v.url.startsWith('data:')));
});

test('extractVideos classifies youtube, vimeo, and wistia iframe embeds', () => {
  const videos = extractVideos(html, pageUrl);
  const youtube = videos.find((v) => v.url.includes('youtube.com'));
  const vimeo = videos.find((v) => v.url.includes('vimeo.com'));
  const wistia = videos.find((v) => v.url.includes('wistia.net'));
  assert.ok(youtube);
  assert.equal(youtube.source, 'youtube-embed');
  assert.equal(youtube.type, null);
  assert.equal(youtube.poster, null);
  assert.ok(vimeo);
  assert.equal(vimeo.source, 'vimeo-embed');
  assert.ok(wistia);
  assert.equal(wistia.source, 'wistia-embed');
});

test('extractVideos excludes unrelated iframe embeds like maps', () => {
  const videos = extractVideos(html, pageUrl);
  assert.ok(!videos.some((v) => v.url.includes('google.com/maps')));
});

test('extractVideos captures lazy-loaded iframe embeds via data-src fallback', () => {
  const videos = extractVideos(html, pageUrl);
  const lazyIframe = videos.find((v) => v.url === 'https://player.vimeo.com/video/999');
  assert.ok(lazyIframe);
  assert.equal(lazyIframe.source, 'vimeo-embed-data-src');
});

test('extractVideos treats iframe src="about:blank" as a placeholder and falls back to data-src', () => {
  const videos = extractVideos(html, pageUrl);
  const blankIframe = videos.find((v) => v.url === 'https://player.vimeo.com/video/54321');
  assert.ok(blankIframe);
  assert.equal(blankIframe.source, 'vimeo-embed-data-src');
});

test('extractVideos captures direct video-file links, ignoring query string', () => {
  const videos = extractVideos(html, pageUrl);
  const promo = videos.find((v) => v.url === 'https://example.com/downloads/promo.mp4');
  const promoMov = videos.find((v) => v.url.startsWith('https://example.com/downloads/promo.mov'));
  assert.ok(promo);
  assert.equal(promo.source, 'link-video-file');
  assert.equal(promo.type, null);
  assert.equal(promo.poster, null);
  assert.ok(promoMov);
  assert.equal(promoMov.source, 'link-video-file');
});

test('extractVideos excludes non-video links', () => {
  const videos = extractVideos(html, pageUrl);
  assert.ok(!videos.some((v) => v.url.includes('/about')));
});
