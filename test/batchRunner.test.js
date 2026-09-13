import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { findDefaultCsv, runBatch } from '../src/batchRunner.js';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function makeTmpDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('findDefaultCsv finds a .csv file in the directory', async () => {
  const tmpDir = await makeTmpDir('site-scraper-test-');
  try {
    await fs.writeFile(path.join(tmpDir, 'sites.csv'), 'https://example.com');
    assert.equal(await findDefaultCsv(tmpDir), path.join(tmpDir, 'sites.csv'));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('findDefaultCsv returns null for an empty directory', async () => {
  const tmpDir = await makeTmpDir('site-scraper-test-');
  try {
    assert.equal(await findDefaultCsv(tmpDir), null);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('findDefaultCsv returns null for a nonexistent directory', async () => {
  assert.equal(await findDefaultCsv(path.join(os.tmpdir(), 'site-scraper-does-not-exist-xyz')), null);
});

function fakeRunScrape({ rootUrl }) {
  if (rootUrl.includes('good')) return Promise.resolve({ pages: 1, images: 2, videos: 0 });
  if (rootUrl.includes('bad')) return Promise.reject(new Error('boom'));
  throw new Error(`unexpected url in fake: ${rootUrl}`);
}

test('runBatch runs sequentially, isolates failures, and writes a summary', async () => {
  const outDir = await makeTmpDir('site-scraper-test-out-');
  try {
    const urls = ['https://good-one.com', 'https://bad-one.com', 'https://good-two.com'];
    const starts = [];
    const dones = [];

    const summary = await runBatch({
      urls,
      siteOptions: {},
      outDir,
      runScrapeFn: fakeRunScrape,
      onSiteStart: (url, index, total) => starts.push({ url, index, total }),
      onSiteDone: (entry) => dones.push(entry),
    });

    assert.equal(summary.total, 3);
    assert.equal(summary.succeeded, 2);
    assert.equal(summary.failed, 1);
    assert.deepEqual(
      summary.sites.map((s) => s.status),
      ['ok', 'error', 'ok'],
    );
    assert.equal(summary.sites[1].error, 'boom');
    assert.deepEqual(summary.sites[0], { url: urls[0], status: 'ok', pages: 1, images: 2, videos: 0 });

    assert.equal(starts.length, 3);
    assert.equal(dones.length, 3);
    assert.deepEqual(starts.map((s) => s.url), urls);

    const written = JSON.parse(await fs.readFile(path.join(outDir, 'batch-summary.json'), 'utf8'));
    assert.deepEqual(written, summary);
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test('runBatch overlaps work up to the concurrency cap and preserves URL order', async () => {
  const outDir = await makeTmpDir('site-scraper-test-concurrency-');
  try {
    let active = 0;
    let maxActive = 0;
    const concurrentRunScrape = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await wait(20);
      active -= 1;
      return { pages: 1, images: 1, videos: 0 };
    };

    const urls = ['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com'];
    const summary = await runBatch({
      urls,
      siteOptions: {},
      outDir,
      concurrency: 2,
      runScrapeFn: concurrentRunScrape,
    });

    assert.ok(maxActive >= 2, `expected overlap of at least 2, got ${maxActive}`);
    assert.equal(summary.succeeded, 4);
    assert.equal(summary.sites.length, 4);
    assert.deepEqual(
      summary.sites.map((s) => s.url),
      urls,
    );
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test('runBatch resumes from a previous summary, skipping ok sites and retrying failed ones', async () => {
  const outDir = await makeTmpDir('site-scraper-test-resume-');
  try {
    const urls = ['https://good.com', 'https://bad.com'];

    const firstResult = await runBatch({
      urls,
      siteOptions: {},
      outDir,
      runScrapeFn: fakeRunScrape,
    });

    assert.deepEqual(
      firstResult.sites.map((s) => s.status),
      ['ok', 'error'],
    );

    const previousSites = Object.fromEntries(
      firstResult.sites.filter((s) => s.status === 'ok').map((s) => [s.url, s]),
    );

    const secondRunScrape = ({ rootUrl }) => {
      if (rootUrl.includes('good')) throw new Error(`should not re-scrape ${rootUrl}`);
      if (rootUrl.includes('bad')) return Promise.resolve({ pages: 3, images: 4, videos: 1 });
      throw new Error(`unexpected url in fake: ${rootUrl}`);
    };

    const secondResult = await runBatch({
      urls,
      siteOptions: {},
      outDir,
      runScrapeFn: secondRunScrape,
      previousSites,
    });

    assert.equal(secondResult.sites[0].url, urls[0]);
    assert.equal(secondResult.sites[0].status, 'ok');
    assert.equal(secondResult.sites[0].resumedFromPrevious, true);

    assert.equal(secondResult.sites[1].url, urls[1]);
    assert.equal(secondResult.sites[1].status, 'ok');
    assert.equal(secondResult.sites[1].resumedFromPrevious, undefined);
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});
