# Plan: Capture rebuild signals (contacts, lists, forms, meta, screenshots, computed style)

**Created:** 2026-09-12
**Branch:** capture-rebuild-signals
**Status:** not started

## Context

The scraper captures an old business website; the template repo
(`C:\proyectos\web-express\templates\website_simple`, a read-only consumer of
`output/<domain>/`) rebuilds it as a modern demo to pitch back to the owner.
Recurring gaps in past rebuilds trace back to what the scraper does not
capture: phone/email contacts are dropped (`extractSectionLinks` skips
`tel:`/`mailto:`), bullet lists are flattened into `text`, `<form>`s are
stripped entirely, Wix sites yield no real brand colours/fonts (CSS regex over
hashed classes finds nothing), and there are no screenshots of the original
for a before/after.

All shapes below are settled decisions (see the cards for the verbatim JSON):

- per-section `contacts`, `listItems`, `form` + site-wide hoisted
  `structure.contacts` (same pattern as `socialLinks`)
- `pages[].meta = {title, description, canonical, og, jsonLd}` and
  `structure.site = {lang, favicon}`; `title`/`description` stay where
  `copy.md`/`manifest.json` read them today
- `mergeSections` (restructure.js) and `pickSiteFooter` (scrapeSite.js)
  rebuild sections from explicit whitelists — new fields are added to both
- render is always-on for home + every `navTree` page, one shared browser per
  run; deep pages keep plain fetch/fallback; degrade without Playwright
- `screenshots/<slug>-desktop.png` (1440) + `<slug>-mobile.png` (390) +
  `screenshots/index.json`; every capture logged to `fetch-log.jsonl` with
  `method: "screenshot"`
- `computed-style.json` with per-page `getComputedStyle` samples and a
  site-level `{fonts, colors}` aggregate reusing `colors.js` weights

Additive only: existing field values in `structure.json`/`manifest.json`/
`copy.md` are pinned by the consumer's live-fixture tests.

## Scope

- in scope
  - `src/extract/structure.js`: `contacts`, `listItems`, `form` per section
  - `src/extract/copy.js` + `src/crawler.js`: richer page meta, site meta
  - `src/scrapeSite.js`: contacts hoist, `site`, `pages[].meta`, footer
    whitelist, render hook; `src/restructure.js`: `mergeSections` whitelist
  - `src/render/`: shared browser session, nav-page screenshots,
    computed-style sampling + aggregation, graceful degrade
  - tests under `test/` (node:test, no browser launched by any test),
    fixtures `test/fixtures/structure.html`, `test/fixtures/copy.html`
  - `README.md` output table, `.ai/index.md`, `.ai/architecture.md`,
    `.ai/decisions/render-nav-pages-always-on.md`
- out of scope
  - any change in the template/consumer repo
  - new CLI flags, new dependencies (Playwright is already optional)
  - changing `site-colors.json`, `fonts.json`, `palette.json`, the LLM
    prompt (`buildSectionSummaries`), or any existing field value
  - rendering non-nav (deep) pages; capturing form field values

## How to execute

Option A — `/execute-prd capture-rebuild-signals` (orchestrator reads
`BOARD.md`, dispatches Ready cards in parallel, respects `touches`).

Option B — manual parallel sessions: pick any card in `## Ready`, set it
`in-progress` with your session id, work only the files in `touches`, run
`pnpm test`, commit as `<type>(<scope>): <title> [#Cnn]`, move it to
`## Done`, then unblock dependants. `C00` first; `C10` is `mode: hil` and
is run by a human/orchestrator, never a subagent.

Parallel lanes after C00: extraction (C01 → C02 → C03, an explicit
`depends_on` chain — all three edit `structure.js`/`extract.structure.test.js`/
`fixtures/structure.html`, so they'd otherwise collide in the same Ready
batch — then C04), meta (C05), render (C06 → C07 → C08), docs (C09).
C04/C05/C06 share `scrapeSite.js`/`crawler.js` and serialise on `touches`
only — no dependency between them (that overlap is fine: each inserts at a
different anchor point in the file, so landing order doesn't matter).

## Documentation

| Change | Documentation location |
| ------ | ---------------------- |
| New `structure.json` fields (`contacts`, `listItems`, `form`, `meta`, `site`) | `README.md` output table (C09) |
| `screenshots/`, `computed-style.json`, missing `site-colors.json` row | `README.md` output table (C09) |
| Screenshot captures logged as `method: "screenshot"` | `README.md` Guardrails (C09) |
| `render/` layer + whitelist rule | `.ai/architecture.md` (C09) |

## Knowledge Base Impact

| `.ai/` artifact | Action | What it captures |
| --------------- | ------ | ---------------- |
| `.ai/index.md` | Update | first real module rows: `extract/structure`, `extract/copy`, `render/playwrightFallback`, `render/renderNavPages`, `render/computedStyle`; cross-cutting fetch-log guardrail |
| `.ai/architecture.md` | Update | `render/` layer (only place Playwright is imported); `mergeSections`/`pickSiteFooter` whitelists must grow with every new section field |
| `.ai/decisions/render-nav-pages-always-on.md` | Create | render nav pages always-on, no flag; degrade without a browser; rejected alternatives |
