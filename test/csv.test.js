import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvUrls, normalizeInputUrl } from '../src/csv.js';

test('parseCsvUrls skips a header row', () => {
  const csv = 'url\nhttps://example.com\nhttps://example.org';
  assert.deepEqual(parseCsvUrls(csv), ['https://example.com', 'https://example.org']);
});

test('parseCsvUrls skips a "website" header row', () => {
  const csv = 'website\nhttps://example.com';
  assert.deepEqual(parseCsvUrls(csv), ['https://example.com']);
});

test('parseCsvUrls skips blank lines', () => {
  const csv = 'https://example.com\n\n\nhttps://example.org\n';
  assert.deepEqual(parseCsvUrls(csv), ['https://example.com', 'https://example.org']);
});

test('parseCsvUrls strips quotes around a value', () => {
  const csv = '"https://example.com"\n\'https://example.org\'';
  assert.deepEqual(parseCsvUrls(csv), ['https://example.com', 'https://example.org']);
});

test('parseCsvUrls ignores extra trailing comma-separated columns', () => {
  const csv = 'https://example.com,notes,more notes';
  assert.deepEqual(parseCsvUrls(csv), ['https://example.com']);
});

test('parseCsvUrls prefixes a bare domain with https://', () => {
  const csv = 'example.com';
  assert.deepEqual(parseCsvUrls(csv), ['https://example.com']);
});

test('parseCsvUrls dedupes while preserving first-seen order', () => {
  const csv = 'https://b.com\nhttps://a.com\nhttps://b.com';
  assert.deepEqual(parseCsvUrls(csv), ['https://b.com', 'https://a.com']);
});

test('parseCsvUrls treats a domain-looking first row as data, not a header', () => {
  const csv = 'example.com\nhttps://example.org';
  assert.deepEqual(parseCsvUrls(csv), ['https://example.com', 'https://example.org']);
});

test('normalizeInputUrl leaves an already-schemed URL alone', () => {
  assert.equal(normalizeInputUrl('https://example.com'), 'https://example.com');
});

test('normalizeInputUrl returns null for an empty string', () => {
  assert.equal(normalizeInputUrl(''), null);
  assert.equal(normalizeInputUrl('   '), null);
});
