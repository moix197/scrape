#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs/promises';
import { parseBatchCliArgs } from './config.js';
import { parseCsvUrls } from './csv.js';
import { findDefaultCsv, runBatch, loadPreviousSummary } from './batchRunner.js';

async function resolveCsvPath(options) {
  if (options.csv) return options.csv;

  const inputDir = options.input || './input';
  const csvPath = await findDefaultCsv(inputDir);
  if (csvPath === null) {
    throw new Error(`No CSV found in ${inputDir}. Drop a .csv file there or pass --csv <path>.`);
  }
  return csvPath;
}

async function loadUrls(options) {
  const csvPath = await resolveCsvPath(options);
  const csvText = await fs.readFile(csvPath, 'utf8');
  const allUrls = parseCsvUrls(csvText);
  if (allUrls.length === 0) {
    throw new Error(`No URLs found in ${csvPath}.`);
  }

  const urls = options.limit ? allUrls.slice(0, options.limit) : allUrls;
  console.log(
    options.limit
      ? `Batch: ${urls.length} of ${allUrls.length} site(s) from ${csvPath} (--limit ${options.limit})`
      : `Batch: ${urls.length} site(s) from ${csvPath}`,
  );
  return urls;
}

function buildSiteOptions(options) {
  const { maxPages, maxDepth, rate, minWidth, minHeight, minBytes, out, forcePlaywright, fresh } = options;
  return { maxPages, maxDepth, rate, minWidth, minHeight, minBytes, out, forcePlaywright, fresh };
}

async function loadPreviousOkSites(outDir, fresh) {
  if (fresh) return {};
  const previous = await loadPreviousSummary(outDir);
  if (!previous) return {};
  return Object.fromEntries(previous.sites.filter((s) => s.status === 'ok').map((s) => [s.url, s]));
}

async function main() {
  let options;
  try {
    options = parseBatchCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
    return;
  }

  try {
    const urls = await loadUrls(options);
    const previousSites = await loadPreviousOkSites(options.out, options.fresh);
    if (Object.keys(previousSites).length > 0) {
      console.log(`Resuming: ${Object.keys(previousSites).length} site(s) already completed, will be skipped.`);
    }

    const summary = await runBatch({
      urls,
      siteOptions: buildSiteOptions(options),
      outDir: options.out,
      concurrency: options.concurrency,
      previousSites,
      onSiteStart: (url, index, total) => console.log(`\n[${index + 1}/${total}] ${url}`),
      onSiteDone: (entry) => {
        if (entry.resumedFromPrevious) {
          console.log(`  skipped (already done) — pages:${entry.pages} images:${entry.images} videos:${entry.videos}`);
        } else {
          console.log(
            entry.status === 'ok'
              ? `  ok — pages:${entry.pages} images:${entry.images} videos:${entry.videos}`
              : `  error — ${entry.error}`,
          );
        }
      },
    });

    console.log(
      `\nBatch done. ${summary.succeeded}/${summary.total} succeeded. Summary: ${path.join(options.out, 'batch-summary.json')}`,
    );
  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

main();
