const USAGE = `Usage: site-scraper <url> [options]

Options:
  --max-pages <n>      Max pages to crawl (default 500 — a safety ceiling, not a target; a normal
                       site's crawl ends naturally once every discovered same-origin link is visited)
  --max-depth <n>      Max link-hop depth (default 6)
  --rate <n>           Requests per second (default 1)
  --min-width <n>      Minimum image width in px (default 100)
  --min-height <n>     Minimum image height in px (default 100)
  --min-bytes <n>      Minimum image size in bytes (default 2048)
  --out <dir>          Output directory (default ./output)
  --force-playwright   Render every page with Playwright instead of the heuristic
  --fresh              Ignore any images already downloaded by a prior scrape of this site and
                       re-download everything (default: reuse them by URL, skipping the network
                       fetch entirely)`;

const BATCH_USAGE = `Usage: site-scraper-batch [options]

Options:
  --csv <path>         CSV file of URLs to scrape (default: first .csv in --input dir)
  --input <dir>        Directory to look for a CSV in (default ./input)
  --limit <n>          Only scrape the first n URLs from the CSV (default: all)
  --max-pages <n>      Max pages to crawl per site (default 500 — a safety ceiling, not a target;
                       a normal site's crawl ends naturally once every same-origin link is visited)
  --max-depth <n>      Max link-hop depth per site (default 6)
  --rate <n>           Requests per second (default 1)
  --min-width <n>      Minimum image width in px (default 100)
  --min-height <n>     Minimum image height in px (default 100)
  --min-bytes <n>      Minimum image size in bytes (default 2048)
  --out <dir>          Output directory (default ./output)
  --force-playwright   Render every page with Playwright instead of the heuristic
  --concurrency <n>    Number of sites to scrape at once (default 3)
  --fresh              Ignore any existing batch-summary.json (rescrape every site) and any images
                       already downloaded by a prior scrape of a given site (re-download everything)`;

const DEFAULTS = {
  maxPages: 500,
  maxDepth: 6,
  rate: 1,
  minWidth: 100,
  minHeight: 100,
  minBytes: 2048,
  out: './output',
  concurrency: 3,
  forcePlaywright: false,
  fresh: false,
};

const NUMBER_FLAGS = {
  '--max-pages': 'maxPages',
  '--max-depth': 'maxDepth',
  '--rate': 'rate',
  '--min-width': 'minWidth',
  '--min-height': 'minHeight',
  '--min-bytes': 'minBytes',
  '--concurrency': 'concurrency',
  '--limit': 'limit',
};

const STRING_FLAGS = {
  '--out': 'out',
  '--csv': 'csv',
  '--input': 'input',
};

const BOOLEAN_FLAGS = {
  '--force-playwright': 'forcePlaywright',
  '--fresh': 'fresh',
};

function parseNumberFlag(flag, rawValue) {
  const value = Number(rawValue);
  if (rawValue === undefined || Number.isNaN(value)) {
    throw new Error(`Invalid value for ${flag}: ${rawValue}\n\n${USAGE}`);
  }
  return value;
}

function parseArgs(args) {
  const options = { ...DEFAULTS };
  let rootUrl = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg in BOOLEAN_FLAGS) {
      options[BOOLEAN_FLAGS[arg]] = true;
    } else if (arg in STRING_FLAGS) {
      i += 1;
      if (args[i] === undefined) throw new Error(`Missing value for ${arg}\n\n${USAGE}`);
      options[STRING_FLAGS[arg]] = args[i];
    } else if (arg in NUMBER_FLAGS) {
      i += 1;
      options[NUMBER_FLAGS[arg]] = parseNumberFlag(arg, args[i]);
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}\n\n${USAGE}`);
    } else if (rootUrl === null) {
      rootUrl = arg;
    }
  }

  return { rootUrl, options };
}

export function parseCliArgs(argv) {
  const { rootUrl, options } = parseArgs(argv);
  if (!rootUrl) {
    throw new Error(`Missing required <url> argument.\n\n${USAGE}`);
  }
  return { rootUrl, ...options };
}

export function parseBatchCliArgs(argv) {
  const { options } = parseArgs(argv);
  return options;
}

export { USAGE, BATCH_USAGE };
