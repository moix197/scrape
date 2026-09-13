#!/usr/bin/env node
import { parseCliArgs } from './config.js';
import { runScrape } from './scrapeSite.js';

async function main() {
  let cliOptions;
  try {
    cliOptions = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
    return;
  }

  try {
    await runScrape(cliOptions);
  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

main();
