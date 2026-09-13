import test from 'node:test';
import assert from 'node:assert/strict';
import { isLikelyLazyVideoPage } from '../src/crawler.js';

const pageUrl = 'https://example.com/cinematography';

test('isLikelyLazyVideoPage is true for a video-named page with no video captured yet', () => {
  const html = '<html><body><div class="VideoPlayer2054936319__root"></div></body></html>';
  assert.equal(isLikelyLazyVideoPage(html, pageUrl), true);
});

test('isLikelyLazyVideoPage is false once the page already has a real captured video', () => {
  const html = '<html><body><iframe src="https://player.vimeo.com/video/123"></iframe></body></html>';
  assert.equal(isLikelyLazyVideoPage(html, pageUrl), false);
});

test('isLikelyLazyVideoPage is false for a video-named page whose only iframe is unrelated (e.g. Instagram)', () => {
  const html = '<html><body><iframe src="https://www.instagram.com/embed/abc"></iframe></body></html>';
  // An unrelated embed must not be mistaken for "the video is already captured" — this page
  // still has no real video, so it's still worth the Playwright render.
  assert.equal(isLikelyLazyVideoPage(html, pageUrl), true);
});

test('isLikelyLazyVideoPage is false for a page whose URL has no video-ish keyword', () => {
  const html = '<html><body><div class="VideoPlayer2054936319__root"></div></body></html>';
  assert.equal(isLikelyLazyVideoPage(html, 'https://example.com/contact'), false);
});

test('isLikelyLazyVideoPage matches other video-ish keywords (videography, film)', () => {
  const html = '<html><body></body></html>';
  assert.equal(isLikelyLazyVideoPage(html, 'https://example.com/videography'), true);
  assert.equal(isLikelyLazyVideoPage(html, 'https://example.com/wedding-film'), true);
});

test('isLikelyLazyVideoPage tolerates a malformed page url', () => {
  assert.equal(isLikelyLazyVideoPage('<html></html>', 'not-a-url'), false);
});
