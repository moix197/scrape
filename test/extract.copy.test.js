import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractVisibleText, extractPageMeta } from '../src/extract/copy.js';

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
  const meta = extractPageMeta(html);
  assert.equal(meta.title, 'Copy Fixture');
  assert.equal(meta.description, 'A page about testing copy extraction.');
});

test('extractPageMeta defaults to empty strings when absent', () => {
  const meta = extractPageMeta('<html><head></head><body></body></html>');
  assert.equal(meta.title, '');
  assert.equal(meta.description, '');
});
