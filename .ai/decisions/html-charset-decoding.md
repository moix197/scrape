# HTML charset: bytes must validate against the declared charset

- **Where**: `src/utils/decodeHtml.js` (`readResponseHtml`, used by `crawler.js` fetch path; Playwright path returns an already-decoded string).
- **Decision**: decode from raw bytes, trying Content-Type charset, then `<meta charset>`/`http-equiv` (first 4KB), then UTF-8; the first candidate that decodes without errors wins, else windows-1252.
- **Why**: `response.text()` forces UTF-8. Real sites (bellevue.com.ar) send `charset=UTF-8` headers on Latin-1 bytes, so trusting the header alone still yields U+FFFD.
- **Rejected**: iconv-lite (native `TextDecoder` covers windows-1252/iso-8859-1).

# Section text: document order, full text content

`extractSectionText` (`src/extract/structure.js`) walks text nodes in document order, including inline elements; only non-inline tags add a space boundary. Never build cheerio selectors from node tag names (`tagWithNthSuffix` filters siblings by `tagName`) because malformed markup yields invalid selectors that abort the crawl.
