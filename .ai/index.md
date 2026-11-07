# Knowledge Index

The map agents read first. One row per module/package: its single responsibility,
where it lives, and links to any decision or pattern doc. Keep rows terse —
this is a lookup table, not documentation. Retire rows that no longer point
anywhere real.

## Modules

| Module / package | Responsibility (one line) | Path | Decisions / patterns |
| ---------------- | ------------------------- | ---- | -------------------- |
| `extract/structure` | page sections + per-section `contacts` (links + "Tel ..."/email in text) / `listItems` / `form`, multi-line `text`, table-cell image `caption`, tab panels as labelled sections, inline-script slideshow images | `src/extract/structure.js` | [html-charset-decoding](decisions/html-charset-decoding.md) (section text, keywords, captions) |
| `extract/css` + `extract/images` | CSS backgrounds, fonts, `#logo`/`.logo` CSS-background logo (overrides the `<img>` guess); inline-script image literals (slideshow `imagearray`) | `src/extract/css.js`, `src/extract/images.js` | |
| `extract/copy` | page meta (title, description, canonical, og, jsonLd) + site meta (lang, favicon) | `src/extract/copy.js` | |
| `utils/decodeHtml` | byte-level HTML charset detection + decode | `src/utils/decodeHtml.js` | [html-charset-decoding](decisions/html-charset-decoding.md) |
| `render/playwrightFallback` | one shared browser session per run; the only Playwright import | `src/render/playwrightFallback.js` | [render-nav-pages-always-on](decisions/render-nav-pages-always-on.md) |
| `render/renderNavPages` | screenshots (desktop/mobile PNG) + `screenshots/index.json` for home + nav pages | `src/render/renderNavPages.js` | [render-nav-pages-always-on](decisions/render-nav-pages-always-on.md) |
| `render/computedStyle` | getComputedStyle samples per page + site-level fonts/colors aggregate | `src/render/computedStyle.js` | [render-nav-pages-always-on](decisions/render-nav-pages-always-on.md) |

## Cross-cutting

| Concern | Where it's handled | Notes |
| ------- | ------------------ | ----- |
| fetch-log guardrail | `src/crawler.js` `fetchUrlWithLog` + `src/render/renderNavPages.js` | every network hit incl. screenshots logs `{url, status, timestamp, method}` |

> Update via the `sync-knowledge` skill — don't hand-edit drift in.
