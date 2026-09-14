# site-scraper

CLI that crawls a public website (same-origin, depth/page-capped) and pulls
down images, fonts, video URLs, a heuristic layout structure, a dominant
color palette, and visible copy — private reference material for building
an unpublished redesign pitch mockup.

## Install

```
pnpm install
```

Playwright is an optional dependency, used as a fallback for pages that
render their content client-side (e.g. via React/Vue) where a plain fetch
yields little or no usable markup, and to capture `screenshots/` and
`computed-style.json` for the home page and nav pages. If you need it:

```
pnpm add playwright
pnpm exec playwright install chromium
```

Without it, the tool still works — the fallback is skipped, plain-fetch
HTML is used as-is, and screenshots / computed-style are skipped.

## Usage

```
pnpm run scrape -- <url> [options]
```

Options:

| Flag | Default | Description |
| --- | --- | --- |
| `--max-pages N` | 500 | Max pages to crawl — a safety ceiling, not a target. A normal site's crawl ends naturally once every same-origin link is visited, well before this cap; it exists only to stop a pathological site (e.g. an auto-generated calendar/archive) from crawling forever |
| `--max-depth N` | 6 | Max link-hop depth from the root URL |
| `--rate N` | 1 | Requests per second (shared across pages, stylesheets) |
| `--min-width N` | 100 | Minimum image width (px) to keep |
| `--min-height N` | 100 | Minimum image height (px) to keep |
| `--min-bytes N` | 2048 | Minimum image size (bytes) to keep |
| `--out DIR` | `./output` | Output directory |
| `--force-playwright` | off | Render every page with Playwright instead of the heuristic |

Example:

```
pnpm run scrape -- https://example.com --max-pages 20 --max-depth 2 --rate 1
```

## Output structure

Written to `<out>/<domain>/`:

```
images/            downloaded, deduped, size-filtered images
screenshots/       full-page PNGs of home + every nav page, desktop (1440) and mobile (390), plus index.json
manifest.json      site url, scraped-at timestamp, pages, images (with local filenames)
fonts.json         font links + @font-face entries discovered in linked stylesheets
videos.json        video URLs discovered — <video>/<source>, YouTube/Vimeo/Wistia embeds, direct video-file links
structure.json     per-page layout breakdown for rebuilding: sections (header/nav/hero/
                   gallery/about/contact/footer/etc.) in document order, each with its
                   images/videos (in position order), headings, links, body text,
                   contacts (tel/mailto), listItems, and form (contact-form fields);
                   per-page meta (title, description, canonical, og, jsonLd);
                   site-wide logo guess, deduped social-media links, hoisted
                   contacts, and site { lang, favicon }. Heuristic, DOM-based,
                   best-effort — see "Structure extraction" below.
palette.json       dominant colors extracted from the largest downloaded images
site-colors.json   colors scored from CSS rules (button/nav/link/body/footer weighted)
computed-style.json  per-page getComputedStyle samples (body/h1/h2/p/a/button/nav/header/footer) + site-level fonts/colors aggregate
copy.md            one block per page (title, description), then one subsection per
                   structure.json section with that section's body text
fetch-log.jsonl    one JSON line per HTTP fetch (url, status, timestamp, method)
```

`screenshots/` and `computed-style.json` come from a real browser render of the
home page and every nav page, so they need Playwright — an **optional**
dependency (see "Install"). When it is not installed, or a page times out,
screenshots and computed-style are skipped for that page, the failure is
recorded as `error` in `screenshots/index.json`, and the exit code stays `0`.

After running the restructure pass (see "Restructure pass" below), a site
folder also gains:

```
structure.restructured.json   structure.json with each page's sections reorganized by an LLM
copy.restructured.md          copy.md rendered from structure.restructured.json
restructure-status.json       tracks whether/when this site's restructure pass has run
```

## Structure extraction

Every crawled page is also run through a DOM-heuristic layout analyzer
(`extract/structure.js`). It groups the page into sections — `header`, `nav`,
`hero`, `gallery`, `about`, `contact`, `services`, `blog`, `team`, `faq`,
`testimonials`, `footer`, generic `main`/`section`, or `uncategorized` for
anything outside a detected landmark — using semantic tags plus common
class/id keyword matches (e.g. `class="gallery"`, `id="hero"`). Each section
lists its images and videos in on-page order, its headings, its links
(flagged `isSocial`/`platform` when they point at a known social platform),
and its own body `text` (whitespace-normalized, script/style stripped).
It also picks a best-guess site logo (from `<header>`/`<nav>`, scored by
`logo` in alt/class/id, then by linking to the homepage) and rolls up a
deduped site-wide social-links list.

This is intentionally best-effort — sites built entirely from unlabeled
`<div>` soup will classify poorly (mostly landing in `uncategorized` or
generic `section`/`main`). Treat `structure.json` as a strong starting point
for rebuilding layout, not a guaranteed-accurate one; spot-check before
relying on it.

## Batch mode

Drop a single-column CSV of URLs (one per line, optional header row) into
`input/`, then run:

```
pnpm run scrape:batch
```

Accepts the same `--max-pages`/`--max-depth`/`--rate`/`--min-width`/
`--min-height`/`--min-bytes`/`--out`/`--force-playwright` flags as single-site
mode, applied identically to every site in the batch. Point at a specific
file with `--csv path/to/file.csv`, or a different drop folder with
`--input path/to/dir` (default `./input`).

| Flag | Default | Description |
| --- | --- | --- |
| `--concurrency N` | 3 | Sites scraped at once (a capped worker queue, not per-site unlimited) |
| `--fresh` | off | Ignore any existing `batch-summary.json` and rescrape every site |
| `--limit N` | all | Only scrape the first N URLs from the CSV — useful for a quick test run |

One site failing (bad domain, network error, robots-blocked, etc.) never
stops the rest of the batch — it's recorded as `status: "error"` and the
queue moves on.

**Resume/checkpoint**: `batch-summary.json` is rewritten after every single
site finishes (not just at the end), so killing the batch mid-run still
leaves an accurate partial summary on disk. Re-running the same command
(same `--out`) automatically resumes: sites already recorded `"ok"` are
skipped (logged as `skipped (already done)`), and sites that previously
`"error"`'d are retried. Pass `--fresh` to ignore all prior progress and
rescrape everything from scratch.

Each site still gets its own `output/<domain>/` folder exactly as in
single-site mode, plus one `output/batch-summary.json` listing every site's
status (`ok`/`error`), page/image/video counts, and (on a resumed run)
`resumedFromPrevious: true` for skipped entries.

## Restructure pass

Scraping and restructuring are decoupled on purpose: scrape many sites now
(single or batch mode), then run the restructure pass on any of them later,
whenever you're ready to build. Classification is done in two steps by an
external orchestrator (Claude Code + subagents), not by Node code calling an
LLM API directly — no API key needed.

```
site-scraper-restructure export [<domain-or-url>] [--out <dir>] [--fresh]
site-scraper-restructure apply  [<domain-or-url>] [--out <dir>]
```

```
pnpm run restructure:export                   # every scraped site under ./output not yet restructured
pnpm run restructure:export example.com       # one site, by its output/<domain> folder name
pnpm run restructure:export -- --fresh        # re-export sites already marked done
# ... an orchestrator (Claude Code + subagents) answers <siteDir>/.restructure-work/prompts.json,
# writing <siteDir>/.restructure-work/plans.json in the same order ...
pnpm run restructure:apply example.com        # merge sections using the answered plans
```

`export` writes each page's classification prompt (its `structure.json`
sections, skipping pages with no sections) to
`<siteDir>/.restructure-work/prompts.json` for the orchestrator to answer.
`apply` reads back `<siteDir>/.restructure-work/plans.json` — one plan object
per prompt, in the same order as `prompts.json` — and deterministically merges
those plans into the site's sections: reorder, relabel, and merge *existing*
sections into a cleaner, more SEO-friendly layout. It never invents, drops, or
edits any section's text, headings, images, videos, or links — it only
regroups whole sections; a page whose plan fails validation (or isn't valid
JSON) keeps its original sections untouched and is recorded as failed for
that page, without blocking the rest of the site. `apply` removes
`.restructure-work/` once it's done merging.

**Output `type` is a closed vocabulary**, not a free-form relabel, so restructured
output slots straight into the `website_simple`/freelo theme with no manual
mapping step: the 15 theme section families (`hero`, `about`, `services`,
`process`, `faq`, `contact`, `location`, `testimonials`, `logos`, `gallery`,
`stats`, `pricing`, `cta-band`, `team`, `news`), plus the theme-chrome types
`header`/`nav`/`footer` (never relabeled into/out of a family). Content that
genuinely matches none of those gets `type: "unmatched"` with a mandatory,
non-empty `description` explaining what it actually is — the model is
instructed not to force-fit content into the wrong family just to avoid this
fallback, and a plan violating any of this (bad type, or `unmatched` without a
description) fails validation like any other malformed response.

Output goes to new files (`structure.restructured.json`,
`copy.restructured.md`) alongside the originals — `structure.json`/`copy.md`
are never overwritten. `restructure-status.json` in each site folder records
`done`, `at` (timestamp), and per-page `pagesRestructured`/`pagesSkipped`/
`pagesFailed` counts; a site already marked `done` is skipped by `export` on
the next run unless `--fresh`. In batch mode, a `restructured: true` flag is
also mirrored onto that site's entry in `batch-summary.json`.

| Flag | Default | Description |
| --- | --- | --- |
| `--out <dir>` | `./output` | Output directory to scan for scraped sites |
| `--fresh` | off | Re-export sites already marked done |

## Guardrails

Images and content pulled by this tool are private reference material for
building an unpublished redesign pitch. Never republish, resell, or ship them
live — swap in licensed imagery before anything goes public. Public pages
only, respects robots.txt, rate-limited. Every fetch is logged in
`fetch-log.jsonl` so a takedown request from the site owner can be honored
immediately.

Concretely, the crawler:

- stays same-origin (never follows links off the starting domain)
- fetches and honors `robots.txt` before requesting any URL
- rate-limits every request (pages and same-origin stylesheets alike)
- backs off and retries on `429`/`503` before giving up on a page
- logs every fetch attempt (url, status, timestamp, method) to `fetch-log.jsonl`
- treats screenshot captures (home + nav pages) as requests like any other:
  rate-limited the same way and logged to `fetch-log.jsonl` with
  `method: "screenshot"`
