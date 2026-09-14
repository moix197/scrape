import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCliArgs, parseBatchCliArgs } from '../src/config.js';

test('parseBatchCliArgs recognizes --concurrency', () => {
  const options = parseBatchCliArgs(['--concurrency', '5']);
  assert.equal(options.concurrency, 5);
});

test('parseBatchCliArgs recognizes --fresh', () => {
  const options = parseBatchCliArgs(['--fresh']);
  assert.equal(options.fresh, true);
});

test('parseBatchCliArgs defaults concurrency and fresh when omitted', () => {
  const options = parseBatchCliArgs([]);
  assert.equal(options.concurrency, 3);
  assert.equal(options.fresh, false);
});

test('parseBatchCliArgs recognizes --limit', () => {
  const options = parseBatchCliArgs(['--limit', '3']);
  assert.equal(options.limit, 3);
});

test('parseBatchCliArgs leaves limit undefined when omitted', () => {
  const options = parseBatchCliArgs([]);
  assert.equal(options.limit, undefined);
});

test('parseCliArgs throws when <url> is missing', () => {
  assert.throws(() => parseCliArgs(['--max-pages', '10']), /Missing required <url> argument/);
});

test('parseCliArgs parses --force-playwright', () => {
  const options = parseCliArgs(['https://example.com', '--force-playwright']);
  assert.equal(options.rootUrl, 'https://example.com');
  assert.equal(options.forcePlaywright, true);
});

test('parseCliArgs drops a leading pnpm `--` separator instead of throwing', () => {
  const options = parseCliArgs(['--', 'https://example.com']);
  assert.equal(options.rootUrl, 'https://example.com');
});

test('parseBatchCliArgs drops a leading pnpm `--` separator instead of throwing', () => {
  const options = parseBatchCliArgs(['--', '--concurrency', '5']);
  assert.equal(options.concurrency, 5);
});
