import path from 'node:path';
import fs from 'node:fs/promises';
import { writeJson } from './images/manifest.js';
import { runScrape } from './scrapeSite.js';

export async function findDefaultCsv(inputDir) {
  let entries;
  try {
    entries = await fs.readdir(inputDir);
  } catch {
    return null;
  }

  const csvFiles = entries.filter((entry) => entry.toLowerCase().endsWith('.csv')).sort();
  return csvFiles.length > 0 ? path.join(inputDir, csvFiles[0]) : null;
}

export async function loadPreviousSummary(outDir) {
  try {
    const text = await fs.readFile(path.join(outDir, 'batch-summary.json'), 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function scrapeOneSite(url, { siteOptions, runScrapeFn }) {
  try {
    const result = await runScrapeFn({ rootUrl: url, ...siteOptions });
    return { url, status: 'ok', ...result };
  } catch (error) {
    return { url, status: 'error', error: error.message };
  }
}

async function resolveSiteEntry(url, index, total, { siteOptions, runScrapeFn, previousSites, onSiteStart }) {
  const previous = previousSites[url];
  if (previous?.status === 'ok') {
    return { ...previous, resumedFromPrevious: true };
  }
  onSiteStart?.(url, index, total);
  return scrapeOneSite(url, { siteOptions, runScrapeFn });
}

async function persistBatchSummary(outDir, urls, sites) {
  const completed = sites.filter(Boolean);
  const succeeded = completed.filter((s) => s.status === 'ok').length;
  const failed = completed.length - succeeded;
  await writeJson(path.join(outDir, 'batch-summary.json'), {
    generatedAt: new Date().toISOString(),
    total: urls.length,
    completed: completed.length,
    succeeded,
    failed,
    sites: completed,
  });
}

export async function runBatch({
  urls,
  siteOptions,
  outDir,
  concurrency = 1,
  runScrapeFn = runScrape,
  previousSites = {},
  onSiteStart,
  onSiteDone,
}) {
  const sites = new Array(urls.length);
  let nextIndex = 0;

  // Concurrent workers must never call fs.writeFile on batch-summary.json at the same
  // time (interleaved writes corrupt the JSON) — funnel every persist through one chain.
  let writeQueue = Promise.resolve();
  function queuePersist() {
    writeQueue = writeQueue.then(() => persistBatchSummary(outDir, urls, sites));
    return writeQueue;
  }

  async function worker() {
    while (nextIndex < urls.length) {
      const index = nextIndex++;
      const url = urls[index];
      const entry = await resolveSiteEntry(url, index, urls.length, {
        siteOptions,
        runScrapeFn,
        previousSites,
        onSiteStart,
      });
      sites[index] = entry;
      onSiteDone?.(entry);
      await queuePersist();
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, urls.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  await writeQueue;

  return JSON.parse(await fs.readFile(path.join(outDir, 'batch-summary.json'), 'utf8'));
}
