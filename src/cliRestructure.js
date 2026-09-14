#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createPrecomputedCaller,
  buildRestructureJobs,
  readRestructureStatus,
  resolveTargetSiteDirs,
  restructureSiteDir,
} from './restructure.js';
import { writeJson } from './images/manifest.js';
import { dropPnpmSeparator } from './utils/argv.js';

const USAGE = `Usage:
  site-scraper-restructure export [<domain-or-url>] [--out <dir>] [--fresh]
  site-scraper-restructure apply  [<domain-or-url>] [--out <dir>]

Two-step, no-API-key restructure of an already-scraped site's structure.json
into a more SEO-friendly section layout:
  "export" writes each page's classification prompt to
    <siteDir>/.restructure-work/prompts.json
  for an external orchestrator (Claude Code + subagents) to answer; "apply"
  reads back <siteDir>/.restructure-work/plans.json (one plan object per
  prompt, in the SAME ORDER as prompts.json) and deterministically merges
  sections, writing structure.restructured.json + copy.restructured.md
  alongside the original structure.json, then removes .restructure-work/.

Options:
  --out <dir>   Output directory to scan for scraped sites (default ./output)
  --fresh       (export only) Re-export sites already marked done in restructure-status.json`;

function parseArgs(argv) {
  const options = { out: './output', fresh: false };
  let subcommand = null;
  let target = null;
  argv = dropPnpmSeparator(argv);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') {
      i += 1;
      if (argv[i] === undefined) throw new Error(`Missing value for --out\n\n${USAGE}`);
      options.out = argv[i];
    } else if (arg === '--fresh') {
      options.fresh = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}\n\n${USAGE}`);
    } else if (subcommand === null) {
      subcommand = arg;
    } else if (target === null) {
      target = arg;
    }
  }

  if (subcommand !== 'export' && subcommand !== 'apply') {
    throw new Error(USAGE);
  }

  return { subcommand, target, options };
}

function logPageResult(result) {
  if (result.skipped) {
    console.log(`  ${result.url} — skipped (no sections)`);
  } else if (result.restructured) {
    console.log(`  ${result.url} — ok`);
  } else {
    console.log(`  ${result.url} — failed (${result.error})`);
  }
}

async function exportOneSite(siteDir, { fresh }) {
  if (!fresh) {
    const status = await readRestructureStatus(siteDir);
    if (status.done) {
      console.log(`skip (already restructured): ${siteDir}`);
      return;
    }
  }

  const structureJson = JSON.parse(await fs.readFile(path.join(siteDir, 'structure.json'), 'utf8'));
  const jobs = buildRestructureJobs(structureJson);

  const workDir = path.join(siteDir, '.restructure-work');
  await fs.mkdir(workDir, { recursive: true });
  const promptsPath = path.join(workDir, 'prompts.json');
  await writeJson(promptsPath, jobs);

  const plansPath = path.join(workDir, 'plans.json');
  console.log(
    `exported ${jobs.length} page prompt(s) for ${siteDir} — have your orchestrator answer them into ${plansPath}, then run: site-scraper-restructure apply ${siteDir}`,
  );
}

async function readWorkJson(filePath, missingMessage) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(missingMessage);
    throw error;
  }
}

async function applyOneSite(siteDir, { out }) {
  const workDir = path.join(siteDir, '.restructure-work');
  const promptsPath = path.join(workDir, 'prompts.json');
  const plansPath = path.join(workDir, 'plans.json');

  const jobs = await readWorkJson(
    promptsPath,
    `No exported prompts found for ${siteDir} — run "export" first for this site.`,
  );
  const plans = await readWorkJson(
    plansPath,
    `No plans found for ${siteDir} — the orchestrator hasn't written answers yet (expected ${plansPath}).`,
  );

  if (plans.length !== jobs.length) {
    throw new Error(
      `Plan count mismatch for ${siteDir}: ${jobs.length} prompt(s) exported but ${plans.length} plan(s) found — every exported prompt must have exactly one corresponding plan, in the same order.`,
    );
  }

  const callModel = createPrecomputedCaller(plans.map((plan) => JSON.stringify(plan)));
  const status = await restructureSiteDir(siteDir, {
    callModel,
    model: 'claude-code-orchestrated',
    outDir: out,
    onPageDone: logPageResult,
  });
  console.log(`  done — restructured:${status.pagesRestructured} skipped:${status.pagesSkipped} failed:${status.pagesFailed}`);

  await fs.rm(workDir, { recursive: true, force: true });
}

async function main() {
  let subcommand;
  let target;
  let options;
  try {
    ({ subcommand, target, options } = parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
    return;
  }

  try {
    const siteDirs = await resolveTargetSiteDirs(options.out, target);
    if (siteDirs.length === 0) {
      throw new Error(
        target ? `No scraped site found matching "${target}" in ${options.out}.` : `No scraped sites found in ${options.out}.`,
      );
    }

    for (const siteDir of siteDirs) {
      if (subcommand === 'export') {
        await exportOneSite(siteDir, { fresh: options.fresh });
      } else {
        await applyOneSite(siteDir, { out: options.out });
      }
    }
  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

main();
