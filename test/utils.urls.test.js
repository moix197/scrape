import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveUrl, isSameOrigin, getDomainFolderName, normalizeUrl } from '../src/utils/urls.js';

test('resolveUrl resolves a relative path against a base', () => {
  assert.equal(resolveUrl('https://example.com/dir/page', '../images/x.jpg'), 'https://example.com/images/x.jpg');
});

test('resolveUrl returns the URL unchanged when already absolute', () => {
  assert.equal(resolveUrl('https://example.com/', 'https://other.com/a.jpg'), 'https://other.com/a.jpg');
});

test('resolveUrl returns null for missing or invalid input', () => {
  assert.equal(resolveUrl('https://example.com/', undefined), null);
  assert.equal(resolveUrl('https://example.com/', ''), null);
  assert.equal(resolveUrl('https://example.com/', 'http://[::1'), null);
});

test('isSameOrigin compares protocol and host', () => {
  assert.equal(isSameOrigin('https://example.com/a', 'https://example.com/b'), true);
  assert.equal(isSameOrigin('https://example.com/a', 'http://example.com/b'), false);
  assert.equal(isSameOrigin('https://sub.example.com/a', 'https://example.com/b'), false);
});

test('getDomainFolderName extracts a filesystem-safe hostname', () => {
  assert.equal(getDomainFolderName('https://www.banksstudios.com/x'), 'www.banksstudios.com');
});

test('getDomainFolderName strips unsafe path characters', () => {
  const folder = getDomainFolderName('https://example.com:8080/x');
  assert.ok(!/[:/\\]/.test(folder));
});

test('normalizeUrl strips fragments', () => {
  assert.equal(normalizeUrl('https://example.com/page#section'), 'https://example.com/page');
});

test('normalizeUrl strips trailing slash except at root', () => {
  assert.equal(normalizeUrl('https://example.com/page/'), 'https://example.com/page');
  assert.equal(normalizeUrl('https://example.com/'), 'https://example.com/');
});

test('normalizeUrl leaves query strings intact', () => {
  assert.equal(normalizeUrl('https://example.com/page?a=1'), 'https://example.com/page?a=1');
  assert.equal(normalizeUrl('https://example.com/page/?a=1'), 'https://example.com/page?a=1');
});

test('normalizeUrl folds index.html into its directory URL', () => {
  assert.equal(normalizeUrl('https://example.com/index.html'), 'https://example.com/');
  assert.equal(normalizeUrl('https://example.com/foo/index.html'), normalizeUrl('https://example.com/foo/'));
});
