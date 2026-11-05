# HTML charset: bytes must validate against the declared charset

- **Where**: `src/utils/decodeHtml.js` (`readResponseHtml`, used by `crawler.js` fetch path; Playwright path returns an already-decoded string).
- **Decision**: decode from raw bytes, trying Content-Type charset, then `<meta charset>`/`http-equiv` (first 4KB), then UTF-8; the first candidate that decodes without errors wins, else windows-1252.
- **Why**: `response.text()` forces UTF-8. Real sites (bellevue.com.ar) send `charset=UTF-8` headers on Latin-1 bytes, so trusting the header alone still yields U+FFFD.
- **Rejected**: iconv-lite (native `TextDecoder` covers windows-1252/iso-8859-1).

# Section text: document order, full text content

`extractSectionText` (`src/extract/structure.js`) walks text nodes in document order, including inline elements; non-inline tags (br, p, li, div, td...) add a line break, and source-HTML newlines are plain whitespace; lines are trimmed and empty ones dropped. Why: CVs and multi-line captions arrived as one flat string. Never build cheerio selectors from node tag names (`tagWithNthSuffix` filters siblings by `tagName`) because malformed markup yields invalid selectors that abort the crawl.

# Only HTML responses are parsed as pages

`readResponseHtml` returns null unless Content-Type is text/html or xhtml (or header missing and bytes don't look binary: NUL, %PDF, zip/png/gif/jpeg magic). Why: the windows-1252 fallback "decodes" any bytes, so a crawled PDF/image became 6MB of garbage in structure.json. `crawler.js` also skips links with binary extensions.

# Landmark keywords match whole class/id words

`classifyByKeyword` splits each class/id token on - and _ and drops trailing digits; a word matches a keyword exactly or with an s/us suffix (testimonials2, aboutus). A keyword preceded in the same token by a component word (card, modal, widget, cookie, ...) is a component part. Why: substring matching made Mobirise team cards (`card-footer`) site footers, so portraits arrived unplaced; `newsletter` also matched news.

# Table-cell image captions

`findTableCellCaption` adds an optional `caption` to a section image inside a `<td>`/`<th>` holding exactly one image: the cell's own text, else the same column (colspan-aware) of the next row when the image row holds only images. Cells with nested tables or > 300 chars never caption. Why: table-built galleries (bellevue /fotos, cuchillos el chaja) lost the image/caption pairing. Additive field; `alt` is untouched.
