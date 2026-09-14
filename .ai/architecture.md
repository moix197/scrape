# Architecture

The high-level shape of the system: package boundaries, how data flows, and the
rules that keep dependencies pointing one direction. Capture the *structure and
its rationale* — not API-level detail the code already documents.

## System shape

Single CLI package, split by layer:

- `utils/` — origin-agnostic primitives: URL resolution/normalization
  (`urls.js`), robots.txt fetch+parse (`robots.js`), rate limiting
  (`rateLimiter.js`), retry/backoff (`backoff.js`), hashing (`hash.js`).
- `extract/` — pure functions over already-fetched HTML/CSS strings: copy
  (`copy.js`), images (`images.js`), font `<link>`s (`fonts.js`), video URLs
  — `<video>`/`<source>`, YouTube/Vimeo/Wistia iframe embeds (also resolved
  via `data-src`/`data-lazy-src` lazy-load fallback, same as `<img>`/
  `<video>`; a placeholder `src="about:blank"` is treated as absent too, so
  it also falls through to `data-src`/`data-lazy-src`), direct video-file
  links (`videos.js`), stylesheet URLs + `@font-face`/
  background-image parsing (`css.js`), heuristic page layout — sections,
  logo, social links, nav links (`structure.js`), Wix `<wow-image>` real-url
  resolution shared by `structure.js` and `images.js` (`wixImage.js`). No I/O.
  - Content not claimed by any landmark ("uncategorized") is no longer one
    blob scoped to the whole `<body>` (that merged unrelated content — e.g. a
    stray image at the end of the page and a stray paragraph three levels
    deep in an unrelated wrapper — into one section's `text`). Each *maximal
    unclaimed subtree* is now its own uncategorized section instead
    (`findUnclaimedRoots`): a child is taken whole once it contains no
    claimed landmark; otherwise the walk recurses into it looking for the
    unclaimed parts. Because of this, `extractSectionImages/Videos/
    Headings/Links` had to gain an `.addBack(sel)` alongside their `.find`
    (an unclaimed root can itself be a leaf tag, e.g. a bare `<img>`, not
    just a container wrapping one as a descendant — plain `.find()` only
    sees descendants).
  - `<form>` elements (and everything inside them — labels, placeholders,
    buttons, links, images) are excluded from extraction entirely, the same
    way an already-claimed landmark's nested landmark is excluded from its
    wrapper: form UI copy ("Name", "Submit") isn't page content. A bare form
    outside any landmark now produces no section at all (its content comes
    back empty and is dropped) rather than showing up as noise.
  - An explicit ARIA `role="list"` claims a landmark of type `cards` —
    framework-agnostic (Wix "repeater" components emit it, but it's a
    standard pattern, not Wix-specific), so it catches card/venue/team grids
    on sites whose markup is otherwise all hashed/generic classes with
    nothing for `KEYWORD_TYPE_MAP` to match. A `cards` section gets a
    `cards: [{ text, url, image }]` field (mirroring `navTree`'s relationship
    to `nav`), built from each `[role="listitem"]` found anywhere inside it
    (searched, not just direct children — a card's link/heading/image can
    sit several levels down).
  - Wix renders many images (card thumbnails, section backgrounds) through a
    `<wow-image>` custom element instead of `<img src>` — the inner `<img>`
    has no src/data-src at all; the real image is a bare filename in the
    wrapper's `data-image-info` JSON attribute, resolved against Wix's media
    CDN (`wixImage.js`'s `resolveWowImage`). Its JSON also carries the
    image's true intrinsic width/height, used instead of the inner `<img>`'s
    width/height attributes (which only reflect the CSS-rendered box size,
    e.g. a 490×252 crop of a 5760×3840 source — using those would
    under-report size to the min-dimension filter). Handled in both
    `structure.js` (per-section `images`/card `image`) and `images.js` (the
    sitewide download pipeline), sharing this one module rather than each
    reimplementing the JSON shape/CDN URL format.
  - Nav/header sections additionally get a hierarchical `navTree` (also
    rolled up to top-level `structure.navTree`), alongside the existing flat
    `links`/`navLinks` (unchanged, still flat and url-deduped). Built by
    walking the section's own `<ul>/<ol>` — each `<li>`'s direct `<a>`/
    `<button>` becomes `{ url, text, isSocial, platform, children? }`,
    recursing into a nested `<ul>/<ol>` for `children` (arbitrary depth; a
    leaf omits `children`). A toggle whose only `<a>` has a placeholder href
    (`#`, `javascript:...`, empty) or is a `<button>` still gets its `text`
    but resolves `url: null` — same "non-empty but not real" reasoning as
    `isPlaceholderIframeSrc` in `videos.js`. A section with no `<ul>/<ol>`
    falls back to treating direct `<a>`/`<button>` children as flat
    (non-nestable) leaves, matching prior behavior for simple navs.
  - This per-page `{sections, logo, socialLinks, navLinks, navTree}` is raw
    material, not the final structure.json shape — scrapeSite.js's
    `buildStructureOutput` consolidates the site-wide parts (nav, footer,
    social links) to the root and drops the per-page duplicates (see Data
    flow below); `extract/structure.js` itself is unaware of that and still
    returns everything per-page.
- `images/` — post-fetch image pipeline: download with timeout
  (`download.js`), URL/content dedupe + size filter (`dedup.js`), dominant
  color extraction via Jimp (`palette.js`), manifest building + JSON writing
  (`manifest.js`).
  - Content dedupe (`dedup.js`'s `createContentDedupe`, `Map`-backed) doesn't
    just drop a URL whose bytes match an already-saved image: `getExisting(hex)`
    returns that image's `{ localFilename, width, height }` so `scrapeSite.js`
    can still add a manifest row for the duplicate URL (an alias, no
    re-download/re-save) via `addImageManifestRow`; `addHash(hex, entry)`
    records the entry for later lookups.
  - Manifest rows (`manifest.js`'s `addImage`) also carry `usages:
    [{ sourcePageUrl, sectionType, sectionLabel }]` — every distinct
    page/section a given image URL occurs under, deduped, sourced from the
    undeduped per-page `structure.sections` (the crawl-level url dedupe below
    is unrelated/unchanged). The singular `sourcePageUrl`/`sectionType`/
    `sectionLabel` fields still reflect first-occurrence only, kept for
    backward compat; `isLogo` needs no such merge since it's already a
    URL-level fact (`image.url === logoUrl`).
  - Any new per-section field must be added to **both** the `mergeSections`
    whitelist (`src/restructure.js`) and the `pickSiteFooter` whitelist
    (`src/scrapeSite.js`): both rebuild sections from an explicit field list,
    so an unlisted field silently vanishes on `restructure:apply` / in the
    root-level `footer`.
- `render/` — the I/O layer that drives the browser, and the only place
  `playwright` is imported: one shared browser session per run
  (`playwrightFallback.js`, also the client-rendered-page fallback), nav-page
  rendering + screenshots (`renderNavPages.js`), computed-style sampling
  (`computedStyle.js`). Home + every `navTree` page is rendered on every run,
  no flag — see `decisions/render-nav-pages-always-on.md`. Pure aggregation /
  normalization lives in functions that take plain data, so they are tested
  without a browser. The session lazily imports `playwright` and resolves
  `null` on any failure (not installed, nav timeout, crash) so the rest of the
  pipeline never depends on it being present. The fallback navigates with `waitUntil:
  'domcontentloaded'` (not `'networkidle'` — confirmed against a real Wix
  site that `'networkidle'` can hang for the full timeout when a page has
  persistent background traffic like analytics/polling), then `autoScrollPage`
  steps down the page in increments (pausing at each) before grabbing
  `page.content()` — needed for widgets that only mount once scrolled into
  view and then take a moment to finish hydrating (e.g. Wix's `VideoPlayer`
  component, which ships an empty `<div>` with no `<iframe>` at all until
  this happens; confirmed a real Vimeo iframe appears for every widget once
  scrolled-to-and-settled).
- `crawler.js` — orchestrates `utils/` + `extract/` + `render/` into a
  same-origin BFS crawl. Owns the fetch/robots/rate-limit/backoff sequencing
  and the plain-fetch-vs-Playwright decision. Returns crawl results in
  memory; does not touch disk.
  - Playwright is also triggered (independent of the existing thin-content
    heuristic) by `isLikelyLazyVideoPage(html, pageUrl)`: the page's URL path
    contains a videography-ish keyword (`video`, `videography`,
    `cinematography`, `film`) AND `extractVideos` finds nothing yet in the
    plain HTML — reusing the real video extractor rather than a naive "has
    an iframe" check, so an unrelated embed (e.g. an Instagram iframe) on
    the same page doesn't wrongly count as "already has its video."
- `config.js` — hand-rolled CLI arg parsing (no dependency added; flag set is
  small and stable). `NUMBER_FLAGS`/`STRING_FLAGS`/`BOOLEAN_FLAGS` maps drive
  a single generic parse loop. `parseCliArgs` (single-site) and
  `parseBatchCliArgs` (batch) share one internal `parseArgs` — batch just
  skips the required-URL check.
- `scrapeSite.js` — the per-site pipeline (crawl → download/filter/manifest
  images → palette → write outputs), extracted from `cli.js` so both
  single-site and batch entry points call the identical `runScrape` function.
  Fails fast (throws) if zero pages were crawled (unreachable root URL, or
  robots.txt-disallowed) rather than silently "succeeding" with an empty
  site — this is what lets batch mode correctly mark such sites as errors.
  Returns `{ pages, images, videos }` counts.
- `csv.js` — pure CSV parsing for batch mode: one URL column per line
  (`parseCsvUrls`), tolerant of a header row, quoting, blank lines, and extra
  trailing columns; bare domains get `https://` prefixed
  (`normalizeInputUrl`). No I/O, no dependency (hand-rolled, single plain
  column — not worth a CSV library).
- `batchRunner.js` — runs a list of URLs through `runScrape` via a small
  hand-rolled capped-concurrency worker pool (shared `nextIndex` counter, no
  queue library), isolating each site's failure via try/catch so one bad
  site doesn't abort the rest. Persists `batch-summary.json` after *every*
  site finishes (not just at the end), which is what makes resume possible —
  `loadPreviousSummary` reads it back on the next run so already-`"ok"`
  sites can be skipped without re-scraping.
- `cli.js` — thin entry point: parse args, call `runScrape`.
- `cliBatch.js` — thin entry point: parse batch args, resolve/read/parse the
  CSV, call `runBatch`, print per-site progress.

## Dependency direction

`cli.js` / `cliBatch.js` → `scrapeSite.js` → `crawler.js` → (`utils/`,
`extract/`, `render/`). `scrapeSite.js` also drives `images/*` directly for
the download/filter/manifest/write steps (these are post-crawl, not
crawl-time concerns, so `crawler.js` doesn't depend on `images/`).
`cliBatch.js` → `csv.js` + `batchRunner.js` → `scrapeSite.js` (`batchRunner.js`
never imports `crawler.js`/`images/*` directly — it only calls `runScrape`).
`extract/*` depends only on `utils/urls.js`. No package depends back on
`cli.js`, `cliBatch.js`, `scrapeSite.js`, or `crawler.js` — one-way, entry
points at the top.

## Data flow

```
crawlSite (BFS, same-origin, depth/page-capped)
  → per page: fetch (rate-limited + backoff) → robots check
    → heuristic: extractImages + extractVisibleText below thresholds?
      → renderWithPlaywright (fallback; null-safe if unavailable)
    → extract copy/images/fonts/videos/structure/links from chosen HTML
      (extractPageStructure: claim header/nav/footer/keyword-matched/
      role="list" ("cards") landmarks in document order — a nested landmark
      of a *different* type (e.g. a real <nav> inside <header>, the common
      case) is claimed independently of its wrapper rather than swallowed by
      it; only nesting of the *same* type is treated as a duplicate wrapper
      and skipped → per-landmark images/videos/headings/links (excluding any
      nested landmark's own subtree and any <form>'s contents) → each
      maximal unclaimed subtree becomes its own "uncategorized" section
      (never one blob merging unrelated content, see extract/ above) → logo
      + social/nav link rollups) — attached to each page as page.structure
    → fetch same-origin linked stylesheets (same rate-limit/backoff/robots)
      → extract @font-face fonts + background-image urls from CSS
  → dedupe images/fonts/videos by url across the whole crawl (structure is
    per-page, not deduped — it rides along on crawlResult.pages; this flat
    url dedupe is unrelated to the content-hash dedupe below and was left
    as-is)
scrapeSite.js (runScrape)
  → throw if zero pages crawled (unreachable/robots-disallowed root)
  → loadPreviousImageCache(outputBase): unless `--fresh`, read this same
    site's PRIOR manifest.json (if any) into a `imageUrl -> {localFilename,
    width, height}` map (via buildManifestImageMap) — re-scraping is almost
    always iterating on this tool, not because the live site's images
    changed, so there's no reason to re-download every image over the
    network again just because the page HTML was re-fetched
  → for each image: check the previous-image cache first — if that URL has
    an entry AND the file still exists on disk at images/<localFilename>,
    read it from disk (no network fetch), hash it into the same
    content-dedupe table a fresh download would use, and treat it exactly
    like a normal successful download from there (manifest row, palette
    candidacy, counted in "saved"); a cache entry whose file has gone
    missing falls through to a real download rather than being trusted
    blindly. Otherwise: downloadImage → sha1 content-dedupe (hash already
    seen → alias manifest row at the existing localFilename/width/height, no
    re-download/re-save) → real dimensions (image-size) → passesSizeFilter,
    exempted for the detected logo AND for any image whose section is
    header/nav/footer (`ICON_EXEMPT_SECTION_TYPES` in scrapeSite.js) — chrome
    icons (social links, a secondary mark) are as legitimate as the logo and
    would otherwise be wrongly dropped by the same generic small-image filter
    → save to images/ → manifest.addImage (row also carries per-URL `usages`
    from crawlResult.pages[].structure.sections)
  → top-N largest images → extractDominantColors → palette.json
  → buildStructureOutput(pages): pick first page with a detected logo as the
    site logo, dedupe social links across all pages; also derives each page's
    `name` from the last path segment of its url (`"home"` for the root path),
    and hoists site-wide chrome to root-level `nav`/`footer` keys (siblings of
    `logo`/`socialLinks`/`pages`) — `nav` is `{navLinks, navTree}` taken from
    the first page's (consistent-across-pages, since one `<nav>` per site);
    `footer` is the first `type: "footer"` section's `{images, videos,
    headings, links, text}` found across pages, or `null` if no page has one.
    A page's own `sections[]` then has its `nav`/`footer`-type entries
    stripped (now redundant with the root fields) and its per-page
    `navLinks`/`navTree`/`socialLinks` fields dropped entirely — a page object
    in structure.json is just `{url, name, sections, logo}`. If pages'
    nav/footer content actually diverges (not expected — same site, one
    global nav/footer — but checked, not assumed), a console.warn fires and
    the first page's version still wins as the root value; nothing throws.
  → once all images are downloaded (manifest fully populated in memory):
    resolveStructureImageUrls rewrites every section image's `url`/`width`/
    `height` from the manifest row for its original remote address (via
    buildManifestImageMap, keyed by imageUrl → `{localFilename, width,
    height}`, both in `images/manifest.js`) — `url` must only ever be a local
    filename or `null`, never a remote address: an image with no manifest row
    (filtered/failed download) gets `url: null` and `width`/`height: null`
    rather than being left as a URL string with stale/unmeasured dimensions,
    so a consumer never has to sniff which kind of value it got — the
    original remote address is intentionally NOT kept anywhere once resolved
    (or not); a null `url` is the only signal a consumer needs. Same
    treatment applies to the detected logo too (`structureJson.logo` and each
    page's own `page.logo`) — a `{url, alt}` pair that lives outside any
    section's `images[]`, easy to miss — and to the root-level `footer`'s own
    `images[]` (same shape as a section, so it reuses the section image
    resolver; `nav` has no images, so it needs no handling and passes through
    via the plain object spread). This is what gets written as
    structure.json, so a site builder
    reads "which local file is this, and its real dimensions" straight off
    it instead of cross-referencing manifest.json for any of it — and
    restructure.js's merge just carries these already-resolved urls
    through unchanged, no extra work needed there.
  → write manifest.json, fonts.json, videos.json, structure.json (now with
    resolved image urls), palette.json, copy.md, fetch-log.jsonl
  → returns { pages, images, videos } counts

Batch mode (cliBatch.js)
  → read CSV → parseCsvUrls → URL list
  → loadPreviousSummary(outDir) (skipped if --fresh) → map of url → previously-"ok" entries
  → runBatch: capped worker pool (--concurrency, default 3) pulls the next
    unclaimed URL index; a URL with a cached "ok" entry is returned as-is
    (resumedFromPrevious: true, runScrape never called); otherwise
    await runScrape({ rootUrl: url, ...siteOptions }) — siteOptions forwards
    --fresh into each site's own runScrape too, so it does double duty: skip
    the whole-site resume above AND (per-site) the image-download cache
    → per-site try/catch — one site's failure never aborts the rest
    → each site still writes its own output/<domain>/ folder as above
    → batch-summary.json rewritten after every completion (crash/interrupt-safe)
  → final batch-summary.json: per-site ok/error status + counts, resumedFromPrevious flags
```

## Guardrails (baked into the design, not bolted on)

- **robots.txt**: fetched once per crawl (`fetchRobotsRules`), checked via
  `isAllowed` before every page fetch *and* every same-origin stylesheet
  fetch.
- **Same-origin only**: link discovery and stylesheet fetching both filter
  through `isSameOrigin`; cross-origin stylesheet URLs are recorded (for the
  fonts list) but never fetched.
- **Rate limiting**: one shared `createRateLimiter` instance per crawl —
  pages and stylesheets share the same throttle, so total request rate stays
  bounded regardless of fan-out.
- **Backoff**: every fetch goes through `withBackoff`; a page that still
  fails after retries (429/503/other non-2xx, or a thrown network error) is
  logged and skipped — its links are never followed and nothing is extracted
  from it.
- **Fetch log**: every fetch attempt (page or stylesheet, success or
  failure) is reported via `onFetchLogged` and written to
  `fetch-log.jsonl`, so a takedown request can be reconciled against exactly
  what was requested and when.

## Restructure pipeline (`cliRestructure.js` / `restructure.js`)

A separate, later CLI that runs *after* a scrape, one page at a time,
sequentially, over already-written `structure.json`. Two-step and no API key
of its own: `pnpm run restructure:export [site-or-url] [--fresh]` writes each
page's prompt to `.restructure-work/prompts.json` for an external orchestrator
(Claude Code) to answer into `plans.json`, then `pnpm run restructure:apply
[site-or-url]` reads those answers back and does the deterministic merge
below.

```
restructureSiteDir(siteDir)
  → read structure.json
  → per page (skip pages with 0 sections, no model call):
      buildSectionSummaries (strip to {id,type,label,headings,text} — media/
      links/selectorPath withheld) → one Claude call per page, asking it to
      regroup/relabel the page's sections into the theme's closed vocabulary
      (THEME_FAMILIES + CHROME_TYPES + "unmatched" — CHROME_TYPES is just
      `['header']`: nav/footer are already hoisted to root-level
      `structureJson.nav`/`.footer` by scrapeSite.js before restructure ever
      reads the file, so they never appear in a page's `sections[]` for the
      model to see; the root `nav`/`footer` keys themselves aren't part of
      this per-page loop at all — `restructureSite`'s `{...structureJson,
      pages}` spread carries them through to structure.restructured.json
      unchanged) → validatePlan (every
      source id covered exactly once, closed vocabulary, non-empty
      description iff "unmatched") → mergeSections (deterministic: content
      concatenation/image-reindexing/selectorPath — the model never touches
      actual text/media, only which ids group together and their new type/
      label — image urls arrive already resolved to local filenames, since
      scrapeSite.js resolves them before structure.json is even written; the
      merge just carries them through unchanged). A source section's `cards`
      array (see extract/ above) is concatenated across merged sources the
      same way `images`/`videos` are, and omitted entirely (not `[]`) when
      none of the merged sources had any — this has to be listed explicitly
      in `mergeSections`, unlike plain object-spread, or a field added to
      `extract/structure.js`'s section shape silently vanishes here even
      though the file's mtime says "restructured after this fix".
  → write structure.restructured.json, copy.restructured.md,
    restructure-status.json (site-level done/counts, no per-page resume —
    `--fresh` re-runs every page); mirrors `restructured: true` into
    batch-summary.json if present
```

> Update via the `sync-knowledge` skill when an architectural boundary, package,
> or flow is introduced or changed.
