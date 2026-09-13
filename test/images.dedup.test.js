import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeByUrl, createContentDedupe, passesSizeFilter } from '../src/images/dedup.js';

test('dedupeByUrl removes duplicates preserving first-seen order', () => {
  const urls = ['a', 'b', 'a', 'c', 'b'];
  assert.deepEqual(dedupeByUrl(urls), ['a', 'b', 'c']);
});

test('dedupeByUrl handles empty array', () => {
  assert.deepEqual(dedupeByUrl([]), []);
});

test('createContentDedupe tracks seen hashes without hasHash mutating state', () => {
  const dedupe = createContentDedupe();
  assert.equal(dedupe.hasHash('abc'), false);
  assert.equal(dedupe.hasHash('abc'), false);

  dedupe.addHash('abc');
  assert.equal(dedupe.hasHash('abc'), true);
  assert.equal(dedupe.hasHash('def'), false);

  dedupe.addHash('abc');
  assert.equal(dedupe.hasHash('abc'), true);
});

test('createContentDedupe getExisting returns the stored entry for a known hash, null otherwise', () => {
  const dedupe = createContentDedupe();
  assert.equal(dedupe.getExisting('abc'), null);

  dedupe.addHash('abc', { localFilename: 'abc123.jpg', width: 100, height: 50 });
  assert.deepEqual(dedupe.getExisting('abc'), { localFilename: 'abc123.jpg', width: 100, height: 50 });
  assert.equal(dedupe.getExisting('def'), null);
});

test('passesSizeFilter accepts images meeting all minimums', () => {
  assert.equal(
    passesSizeFilter({ width: 200, height: 200, byteLength: 4096 }),
    true
  );
});

test('passesSizeFilter rejects images below minWidth or minHeight', () => {
  assert.equal(
    passesSizeFilter({ width: 50, height: 200, byteLength: 4096 }),
    false
  );
  assert.equal(
    passesSizeFilter({ width: 200, height: 50, byteLength: 4096 }),
    false
  );
});

test('passesSizeFilter rejects images below minBytes', () => {
  assert.equal(
    passesSizeFilter({ width: 200, height: 200, byteLength: 100 }),
    false
  );
});

test('passesSizeFilter does not filter on unknown width/height', () => {
  assert.equal(
    passesSizeFilter({ width: null, height: undefined, byteLength: 4096 }),
    true
  );
});

test('passesSizeFilter respects custom thresholds', () => {
  assert.equal(
    passesSizeFilter(
      { width: 10, height: 10, byteLength: 500 },
      { minWidth: 5, minHeight: 5, minBytes: 100 }
    ),
    true
  );
});
