# Render home + nav pages with the browser on every run

**Date:** 2026-09-14

**Decision:** Render the home page and every page in `navTree` with the browser
on every run, no flag. Deeper pages keep today's plain fetch, with Playwright only
as the thin-content fallback.

**Why:** The recurring gaps in rebuilds are missing before/after screenshots and
no real brand colours/fonts on client-rendered (Wix-style) sites, where the static
CSS scan sees only hashed classes. Both are signals only a rendered page can give,
and they are needed on every scrape, not just when someone remembers to ask.

**Rejected:**

- An opt-in `--screenshots` flag — gets forgotten, so the pitch ends up without
  the before/after.
- Rendering every crawled page — too slow and too rude at the 1 req/s default
  with a 500-page ceiling; home + nav is where the brand signal lives anyway.

**Degrade rule:** Playwright missing (it is an optional dependency) or a page
timing out skips that page's screenshot / style sample, records `error` in
`screenshots/index.json` and the attempt in `fetch-log.jsonl`, and the run
still exits `0`. No browser is ever a hard failure.

**Consequences (constraints it creates):**

- One shared browser instance per run; `renderWithPlaywright` returns an
  object (`{ html }`), not a bare HTML string, so callers can grow without
  another signature change.
- Aggregation and normalization are pure functions over plain data, tested
  without a browser — no test launches Playwright.
- Every capture is a network hit under the guardrails: rate-limited and logged
  to `fetch-log.jsonl` with `method: "screenshot"`.
