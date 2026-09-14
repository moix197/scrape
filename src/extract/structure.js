import * as cheerio from 'cheerio';
import { resolveUrl } from '../utils/urls.js';
import { resolveWowImage } from './wixImage.js';

const KEYWORD_TYPE_MAP = [
  ['gallery', 'gallery'],
  ['portfolio', 'gallery'],
  ['hero', 'hero'],
  ['banner', 'hero'],
  ['testimonial', 'testimonials'],
  ['contact', 'contact'],
  ['about', 'about'],
  ['service', 'services'],
  ['blog', 'blog'],
  ['news', 'blog'],
  ['team', 'team'],
  ['faq', 'faq'],
  ['footer', 'footer'],
];

const TAG_TYPE_MAP = { header: 'header', nav: 'nav', footer: 'footer', main: 'main', section: 'section' };

const IFRAME_VIDEO_HOSTS = [
  { hosts: ['youtube.com', 'youtube-nocookie.com', 'youtu.be'], source: 'youtube-embed' },
  { hosts: ['vimeo.com'], source: 'vimeo-embed' },
  { hosts: ['wistia.com', 'wistia.net'], source: 'wistia-embed' },
];

const SOCIAL_DOMAINS = [
  ['facebook.com', 'facebook'],
  ['instagram.com', 'instagram'],
  ['twitter.com', 'twitter'],
  ['x.com', 'twitter'],
  ['linkedin.com', 'linkedin'],
  ['pinterest.com', 'pinterest'],
  ['tiktok.com', 'tiktok'],
  ['youtube.com', 'youtube'],
  ['youtu.be', 'youtube'],
  ['threads.net', 'threads'],
  ['vimeo.com', 'vimeo'],
  ['snapchat.com', 'snapchat'],
  ['yelp.com', 'yelp'],
];

function isUsableUrl(url) {
  return url !== null && !url.startsWith('data:');
}

function classifyByKeyword($, el) {
  const classAndId = `${$(el).attr('class') || ''} ${$(el).attr('id') || ''}`.toLowerCase();
  const match = KEYWORD_TYPE_MAP.find(([keyword]) => classAndId.includes(keyword));
  return match ? match[1] : null;
}

function classifyByTag(el) {
  const tag = el.tagName ? el.tagName.toLowerCase() : '';
  return TAG_TYPE_MAP[tag] || null;
}

// An explicit ARIA role="list" is a framework-agnostic signal for a repeated-card grid (Wix
// "repeater" components use it, but it's a standard pattern, not a Wix-specific one) — unlike
// KEYWORD_TYPE_MAP, it doesn't depend on the site author using a recognizable class/id, so it
// catches card grids on sites that build their markup entirely from hashed/generic classes.
function classifyByRole($, el) {
  return $(el).attr('role') === 'list' ? 'cards' : null;
}

function isDescendantOfClaimed($, el, claimedEls) {
  return claimedEls.some((claimedEl) => $.contains(claimedEl, el));
}

// The reverse of isDescendantOfClaimed: true when el is an ancestor of something already
// claimed. Used to stop a generic main/section wrapper from being claimed once a more
// specific landmark nested inside it (e.g. a real <section>, or a keyword-matched div) has
// already been claimed — otherwise the wrapper would swallow that landmark's content too.
function containsAnyClaimed($, el, claimedEls) {
  return claimedEls.some((claimedEl) => $.contains(el, claimedEl));
}

function elementDepth($, el) {
  return $(el).parents().length;
}

// A real <nav> is very often nested inside a <header> (semantic HTML5, and virtually every
// site builder's markup) rather than a sibling of it — the two are still distinct landmarks
// (restructure.js's chrome types treat "header" and "nav" separately), so nesting must not
// make the inner one lose its claim the way a duplicate wrapper (e.g. a "gallery" div wrapping
// another "gallery" div) should. Only a nested landmark of the SAME resulting type is treated
// as a duplicate wrapper and skipped; different priority types (header > nav, header > footer,
// etc.) are each claimed independently — buildSection's excludeInside then keeps the outer
// landmark's own content from double-counting the inner one.
function claimPriorityLandmarks($, allEls) {
  const claimed = [];
  const claimedEls = [];
  for (const el of allEls) {
    const keywordType = classifyByKeyword($, el);
    const tagType = classifyByTag(el);
    const roleType = classifyByRole($, el);
    const isPriority = keywordType !== null || tagType === 'header' || tagType === 'nav' || tagType === 'footer' || roleType !== null;
    if (!isPriority) continue;
    const type = keywordType || roleType || tagType;
    const isDuplicateNesting = claimed.some((landmark) => landmark.type === type && $.contains(landmark.el, el));
    if (isDuplicateNesting) continue;
    claimed.push({ el, type });
    claimedEls.push(el);
  }
  return { claimed, claimedEls };
}

// Processes main/section candidates deepest-first (rather than document order) so a real
// nested <section> gets claimed before its wrapping <main>/<section> is even considered —
// document order alone would let the outer wrapper claim first and bury its own children.
function claimGenericLandmarks($, allEls, priorityClaimedEls) {
  const candidates = allEls.filter((el) => {
    if (classifyByKeyword($, el) !== null) return false;
    const tagType = classifyByTag(el);
    return tagType === 'main' || tagType === 'section';
  });
  const deepestFirst = [...candidates].sort((a, b) => elementDepth($, b) - elementDepth($, a));

  const claimed = [];
  const claimedEls = [...priorityClaimedEls];
  for (const el of deepestFirst) {
    if (isDescendantOfClaimed($, el, claimedEls)) continue;
    if (containsAnyClaimed($, el, claimedEls)) continue;
    claimed.push({ el, type: classifyByTag(el) });
    claimedEls.push(el);
  }
  return claimed;
}

function claimLandmarks($) {
  const allEls = $('body *').toArray();
  const { claimed: priorityClaimed, claimedEls: priorityClaimedEls } = claimPriorityLandmarks($, allEls);
  const genericClaimed = claimGenericLandmarks($, allEls, priorityClaimedEls);
  return sortByDocumentOrder($, allEls, [...priorityClaimed, ...genericClaimed]);
}

function sortByDocumentOrder($, allEls, landmarks) {
  const positions = new Map(allEls.map((el, index) => [el, index]));
  return [...landmarks].sort((a, b) => positions.get(a.el) - positions.get(b.el));
}

function firstSrcsetUrl(srcset) {
  if (!srcset) return null;
  const first = srcset.split(',')[0]?.trim();
  return first ? first.split(/\s+/)[0] : null;
}

function resolveImageUrl($, el, pageUrl) {
  const $el = $(el);
  const raw = $el.attr('src') || $el.attr('data-src') || $el.attr('data-lazy-src') || firstSrcsetUrl($el.attr('srcset'));
  if (!raw) return null;
  const resolved = resolveUrl(pageUrl, raw);
  return isUsableUrl(resolved) ? resolved : null;
}

function isExcluded($, el, excludeInside) {
  return excludeInside.some((excluded) => excluded === el || $.contains(excluded, el));
}

// `.addBack(sel)` re-includes scopeEl itself when it matches sel — needed because an
// unclaimed root (see findUnclaimedRoots) can itself be a leaf tag like <img>, not just a
// container wrapping one as a descendant, and plain `.find()` only looks at descendants.
function extractWowImages($, scopeEl, excludeInside, images) {
  $(scopeEl)
    .find('wow-image[data-image-info]')
    .addBack('wow-image[data-image-info]')
    .each((_, el) => {
      if (isExcluded($, el, excludeInside)) return;
      const resolved = resolveWowImage($(el).attr('data-image-info'));
      if (!resolved) return;
      images.push({ url: resolved.url, alt: $(el).find('img').first().attr('alt') || '', order: images.length });
    });
}

function extractSectionImages($, scopeEl, pageUrl, excludeInside) {
  const images = [];
  $(scopeEl)
    .find('img')
    .addBack('img')
    .each((_, el) => {
      if (isExcluded($, el, excludeInside)) return;
      const url = resolveImageUrl($, el, pageUrl);
      if (!url) return;
      images.push({ url, alt: $(el).attr('alt') || '', order: images.length });
    });
  extractWowImages($, scopeEl, excludeInside, images);
  return images;
}

function resolveVideoTagUrl($, el, pageUrl) {
  const $el = $(el);
  const raw = $el.attr('src') || $el.find('source').first().attr('src');
  const resolved = raw ? resolveUrl(pageUrl, raw) : null;
  return isUsableUrl(resolved) ? { url: resolved, source: 'video' } : null;
}

// `about:blank` is a common lazy-load placeholder (e.g. `<iframe src="about:blank"
// data-src="...">`) — a non-empty `src` that still means "no real src yet", so it must not
// win over data-src/data-lazy-src the way a real src would.
function isPlaceholderIframeSrc(src) {
  return typeof src === 'string' && src.trim().toLowerCase() === 'about:blank';
}

function resolveIframeVideoUrl($, el, pageUrl) {
  const $el = $(el);
  const src = $el.attr('src');
  const dataSrc = $el.attr('data-src') || $el.attr('data-lazy-src');
  const realSrc = src && !isPlaceholderIframeSrc(src) ? src : null;
  const resolved = resolveUrl(pageUrl, realSrc || dataSrc || src);
  if (!isUsableUrl(resolved)) return null;
  const lowerUrl = resolved.toLowerCase();
  const match = IFRAME_VIDEO_HOSTS.find(({ hosts }) => hosts.some((host) => lowerUrl.includes(host)));
  return match ? { url: resolved, source: match.source } : null;
}

function classifySectionVideo($, el, pageUrl) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'video') return resolveVideoTagUrl($, el, pageUrl);
  if (tag === 'iframe') return resolveIframeVideoUrl($, el, pageUrl);
  return null;
}

function extractSectionVideos($, scopeEl, pageUrl, excludeInside) {
  const videos = [];
  $(scopeEl)
    .find('video, iframe')
    .addBack('video, iframe')
    .each((_, el) => {
      if (isExcluded($, el, excludeInside)) return;
      const video = classifySectionVideo($, el, pageUrl);
      if (!video) return;
      videos.push({ ...video, order: videos.length });
    });
  return videos;
}

function extractSectionHeadings($, scopeEl, excludeInside) {
  const headings = [];
  $(scopeEl)
    .find('h1, h2, h3, h4')
    .addBack('h1, h2, h3, h4')
    .each((_, el) => {
      if (isExcluded($, el, excludeInside)) return;
      const text = $(el).text().trim();
      if (!text) return;
      headings.push({ level: Number(el.tagName[1]), text });
    });
  return headings;
}

const NON_TEXT_TAGS = new Set(['script', 'style', 'noscript', 'template']);

function extractSectionText($, scopeEl, excludeInside) {
  const parts = [];
  $(scopeEl)
    .find('*')
    .addBack()
    .each((_, el) => {
      if (NON_TEXT_TAGS.has(el.tagName?.toLowerCase())) return;
      if (isExcluded($, el, excludeInside)) return;
      $(el)
        .contents()
        .each((__, node) => {
          if (node.type === 'text' && node.data.trim()) parts.push(node.data.trim());
        });
    });
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

// Flattens one top-level list's items: a nested ul/ol inside an <li> is not its own entry —
// its items are appended, in document order, right after that <li>'s own text. Item text is
// gathered with extractSectionText, scoped per-<li> and excluding that <li>'s own nested lists
// (so a list item's text never duplicates its own nested list's items) plus whatever the caller
// already excludes, so a claimed/excluded landmark nested inside an <li> doesn't leak its text.
function collectListItemTexts($, listEl, excludeInside) {
  const items = [];
  $(listEl)
    .children('li')
    .each((_, li) => {
      const nestedLists = $(li).find('ul, ol').toArray();
      const ownText = extractSectionText($, li, [...excludeInside, ...nestedLists]);
      if (ownText) items.push(ownText);
      $(li)
        .children('ul, ol')
        .each((__, nestedList) => items.push(...collectListItemTexts($, nestedList, excludeInside)));
    });
  return items;
}

// Scoped counterpart to isExcluded, for detecting a nested (non-top-level) list: true when el
// has a ul/ol ancestor that itself lives inside sectionEl. parents('ul, ol') can surface
// ancestors entirely outside sectionEl (e.g. the section sitting inside some larger page list)
// — those must not count toward "nested within this section".
function hasListAncestorWithinSection($, el, sectionEl) {
  return $(el)
    .parents('ul, ol')
    .toArray()
    .some((ancestor) => ancestor === sectionEl || $.contains(sectionEl, ancestor));
}

function extractSectionListItems($, sectionEl, excludeInside) {
  const listItems = [];
  $(sectionEl)
    .find('ul, ol')
    .addBack('ul, ol')
    .each((_, el) => {
      if (isExcluded($, el, excludeInside)) return;
      if (hasListAncestorWithinSection($, el, sectionEl)) return;
      listItems.push({ ordered: el.tagName.toLowerCase() === 'ol', items: collectListItemTexts($, el, excludeInside) });
    });
  return listItems;
}

function classifySocialLink(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const match = SOCIAL_DOMAINS.find(([domain]) => hostname.includes(domain));
  return match ? match[1] : null;
}

function extractSectionLinks($, scopeEl, pageUrl, excludeInside) {
  const links = [];
  $(scopeEl)
    .find('a[href]')
    .addBack('a[href]')
    .each((_, el) => {
      if (isExcluded($, el, excludeInside)) return;
      const href = $(el).attr('href');
      if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      const resolved = resolveUrl(pageUrl, href);
      if (!isUsableUrl(resolved)) return;
      const platform = classifySocialLink(resolved);
      links.push({ url: resolved, text: $(el).text().trim(), isSocial: platform !== null, platform });
    });
  return links;
}

function classifyContactHref(href) {
  if (href.startsWith('tel:')) return 'tel';
  if (href.startsWith('mailto:')) return 'mailto';
  return null;
}

function normalizeTelValue(href) {
  const raw = href.slice('tel:'.length);
  const digits = raw.replace(/\D/g, '');
  return raw.trim().startsWith('+') ? `+${digits}` : digits;
}

function normalizeMailtoValue(href) {
  const address = href.slice('mailto:'.length).split('?')[0];
  return address.trim().toLowerCase();
}

function extractSectionContacts($, scopeEl, excludeInside) {
  const contacts = new Map();
  $(scopeEl)
    .find('a[href]')
    .addBack('a[href]')
    .each((_, el) => {
      if (isExcluded($, el, excludeInside)) return;
      const href = $(el).attr('href');
      const type = classifyContactHref(href);
      if (!type) return;
      const value = type === 'tel' ? normalizeTelValue(href) : normalizeMailtoValue(href);
      const key = `${type}:${value}`;
      if (contacts.has(key)) return;
      const label = $(el).text().trim();
      contacts.set(key, { type, value, label: label || value });
    });
  return [...contacts.values()];
}

// A dropdown/submenu toggle is often an <a> with no real destination (`href="#"`,
// `href="javascript:void(0)"`, or empty) — same idea as `isPlaceholderIframeSrc` for iframes:
// a non-empty attribute that still means "nothing real here", so it must not be treated as a
// usable link.
function isPlaceholderHref(href) {
  if (typeof href !== 'string') return true;
  const trimmed = href.trim().toLowerCase();
  return trimmed === '' || trimmed === '#' || trimmed.startsWith('javascript:');
}

function resolveNavItemUrl($, labelEl, pageUrl) {
  if (!labelEl || labelEl.tagName?.toLowerCase() !== 'a') return null;
  const href = $(labelEl).attr('href');
  if (isPlaceholderHref(href)) return null;
  const resolved = resolveUrl(pageUrl, href);
  return isUsableUrl(resolved) ? resolved : null;
}

// A nav item's label comes from its own direct <a>/<button> — never from something inside its
// nested submenu, which would otherwise get picked up as a descendant.
function findNavItemLabelEl($, itemEl) {
  const anchor = $(itemEl).children('a').first();
  if (anchor.length) return anchor.get(0);
  const button = $(itemEl).children('button').first();
  return button.length ? button.get(0) : null;
}

// Falls back to the <li>'s own text (minus any nested submenu) when it has neither an <a> nor a
// <button> label of its own — e.g. a bare toggle wrapped only in plain text.
function findNavItemText($, itemEl, labelEl) {
  if (labelEl) return $(labelEl).text().trim();
  return $(itemEl).clone().children('ul, ol').remove().end().text().trim();
}

function buildNavItem($, itemEl, pageUrl, excludeInside) {
  const labelEl = findNavItemLabelEl($, itemEl);
  const text = findNavItemText($, itemEl, labelEl);
  const url = resolveNavItemUrl($, labelEl, pageUrl);
  const platform = url ? classifySocialLink(url) : null;
  const nestedList = $(itemEl).children('ul, ol').first();
  const children = nestedList.length ? buildNavItems($, nestedList.get(0), pageUrl, excludeInside) : [];
  const item = { url, text, isSocial: platform !== null, platform };
  return children.length ? { ...item, children } : item;
}

function buildNavItems($, listEl, pageUrl, excludeInside) {
  return $(listEl)
    .children('li')
    .toArray()
    .filter((li) => !isExcluded($, li, excludeInside))
    .map((li) => buildNavItem($, li, pageUrl, excludeInside));
}

// No wrapping <ul>/<ol> at all (e.g. a handful of bare <a> siblings directly in <nav>) — those
// can't nest further, so each is its own leaf, same shape as a list-derived item minus `children`.
function buildFlatNavItems($, scopeEl, pageUrl, excludeInside) {
  return $(scopeEl)
    .children('a, button')
    .toArray()
    .filter((el) => !isExcluded($, el, excludeInside))
    .map((el) => {
      const url = resolveNavItemUrl($, el, pageUrl);
      const platform = url ? classifySocialLink(url) : null;
      return { url, text: $(el).text().trim(), isSocial: platform !== null, platform };
    });
}

// Hierarchy-aware counterpart to `extractSectionLinks`, used only for nav/header-type sections
// (see `buildSection`) — general sections keep the flat `links` extraction unchanged.
function buildNavTree($, scopeEl, pageUrl, excludeInside) {
  const topList = $(scopeEl).children('ul, ol').first();
  return topList.length
    ? buildNavItems($, topList.get(0), pageUrl, excludeInside)
    : buildFlatNavItems($, scopeEl, pageUrl, excludeInside);
}

// Card-grid counterpart to `buildNavTree`, used only for role="list"-type sections (see
// `buildSection`) — a card's link/heading/image can sit at any depth inside its listitem
// (e.g. a wrapping button/link several levels below the heading), unlike nav's shallow <li>
// structure, so this searches the whole listitem rather than assuming direct children.
function findCardLinkUrl($, itemEl, pageUrl) {
  const linkEl = $(itemEl)
    .find('a[href]')
    .toArray()
    .find((a) => !isPlaceholderHref($(a).attr('href')));
  if (!linkEl) return null;
  const resolved = resolveUrl(pageUrl, $(linkEl).attr('href'));
  return isUsableUrl(resolved) ? resolved : null;
}

function findCardImageUrl($, itemEl, pageUrl) {
  const wowImageEl = $(itemEl).find('wow-image[data-image-info]').get(0);
  const resolvedWow = wowImageEl ? resolveWowImage($(wowImageEl).attr('data-image-info')) : null;
  if (resolvedWow) return resolvedWow.url;
  const imgEl = $(itemEl).find('img').get(0);
  return imgEl ? resolveImageUrl($, imgEl, pageUrl) : null;
}

function buildCardItem($, itemEl, pageUrl) {
  const heading = $(itemEl).find('h1, h2, h3, h4, h5, h6').first();
  const text = (heading.length ? heading.text() : $(itemEl).text()).trim().replace(/\s+/g, ' ');
  return { text, url: findCardLinkUrl($, itemEl, pageUrl), image: findCardImageUrl($, itemEl, pageUrl) };
}

function buildCards($, scopeEl, pageUrl, excludeInside) {
  return $(scopeEl)
    .find('[role="listitem"]')
    .toArray()
    .filter((el) => !isExcluded($, el, excludeInside))
    .map((el) => buildCardItem($, el, pageUrl));
}

// A <form>'s visible text is labels/placeholders/button copy ("Name", "Submit", "Select an
// option") — it reads like marketing copy once flattened into a section's text but isn't, so
// forms (and everything inside them) are excluded from extraction entirely, the same way an
// already-claimed landmark is excluded from its wrapper. `.addBack('form')` covers scopeEl
// itself being a <form> (e.g. a keyword-matched "contact" section, or an unclaimed form root).
function collectFormEls($, scopeEl) {
  return $(scopeEl).find('form').addBack('form').toArray();
}

function extractSectionContent($, scopeEl, pageUrl, { excludeInside = [] } = {}) {
  const excludeAll = [...excludeInside, ...collectFormEls($, scopeEl)];
  return {
    images: extractSectionImages($, scopeEl, pageUrl, excludeAll),
    videos: extractSectionVideos($, scopeEl, pageUrl, excludeAll),
    headings: extractSectionHeadings($, scopeEl, excludeAll),
    links: extractSectionLinks($, scopeEl, pageUrl, excludeAll),
    contacts: extractSectionContacts($, scopeEl, excludeAll),
    text: extractSectionText($, scopeEl, excludeAll),
    listItems: extractSectionListItems($, scopeEl, excludeAll),
  };
}

function tagWithNthSuffix($, node) {
  const tag = node.tagName.toLowerCase();
  if (!node.parent) return tag;
  const siblingsOfType = $(node.parent).children(tag).toArray();
  return siblingsOfType.length > 1 ? `${tag}:nth-of-type(${siblingsOfType.indexOf(node) + 1})` : tag;
}

function buildSelectorPath($, el) {
  const chain = [...$(el).parents().toArray().reverse(), el];
  const bodyIndex = chain.findIndex((node) => node.tagName === 'body');
  const relevant = bodyIndex >= 0 ? chain.slice(bodyIndex) : chain;
  return relevant.map((node) => tagWithNthSuffix($, node)).join(' > ');
}

function buildSection($, { el, type }, pageUrl, order, excludeInside) {
  const content = extractSectionContent($, el, pageUrl, { excludeInside });
  const firstHeading = content.headings[0];
  const navFields = type === 'nav' ? { navTree: buildNavTree($, el, pageUrl, excludeInside) } : {};
  const cardFields = type === 'cards' ? { cards: buildCards($, el, pageUrl, excludeInside) } : {};
  return {
    type,
    label: firstHeading ? firstHeading.text : type,
    order,
    selectorPath: buildSelectorPath($, el),
    ...content,
    ...navFields,
    ...cardFields,
  };
}

// Landmarks are claimed to be non-overlapping (see claimGenericLandmarks), but this stays
// defensive: a section's own content should never double-count another claimed landmark
// that happens to be nested inside it.
function nestedClaimedEls($, el, allLandmarkEls) {
  return allLandmarkEls.filter((other) => other !== el && $.contains(el, other));
}

function buildSections($, landmarks, pageUrl) {
  const allEls = landmarks.map((landmark) => landmark.el);
  return landmarks.map((landmark, order) =>
    buildSection($, landmark, pageUrl, order, nestedClaimedEls($, landmark.el, allEls)),
  );
}

// Content not claimed by any landmark can live anywhere in the DOM tree (a stray image at the
// end of <body>, a stray paragraph nested deep inside an unrelated wrapper) — treating it as one
// flat "uncategorized" blob scoped to the whole <body> merged unrelated page content together.
// Instead, each maximal unclaimed subtree becomes its own section, so a section's text only ever
// contains content that's actually its own. A child is taken whole once it contains no claimed
// landmark; otherwise we recurse into it looking for the unclaimed parts inside.
function findUnclaimedRoots($, containerEl, claimedEls) {
  const roots = [];
  $(containerEl)
    .children()
    .each((_, child) => {
      if (isExcluded($, child, claimedEls)) return;
      if (containsAnyClaimed($, child, claimedEls)) {
        roots.push(...findUnclaimedRoots($, child, claimedEls));
      } else {
        roots.push(child);
      }
    });
  return roots;
}

function buildUncategorizedSection($, root, pageUrl, order) {
  const content = extractSectionContent($, root, pageUrl, {});
  const isEmpty = Object.values(content).every((list) => list.length === 0);
  if (isEmpty) return null;
  const firstHeading = content.headings[0];
  return {
    type: 'uncategorized',
    label: firstHeading ? firstHeading.text : 'uncategorized',
    order,
    selectorPath: buildSelectorPath($, root),
    ...content,
  };
}

function scoreLogoCandidate($, el, pageUrl, origin) {
  const $el = $(el);
  const text = `${$el.attr('alt') || ''} ${$el.attr('class') || ''} ${$el.attr('id') || ''}`.toLowerCase();
  if (text.includes('logo')) return 2;
  const anchorHref = $el.closest('a').attr('href');
  const resolvedHref = anchorHref ? resolveUrl(pageUrl, anchorHref) : null;
  return resolvedHref && (resolvedHref === origin || resolvedHref === `${origin}/`) ? 1 : 0;
}

function detectLogo($, pageUrl) {
  const withLandmarks = $('header, nav');
  const scope = withLandmarks.length ? withLandmarks : $('body');
  const origin = new URL(pageUrl).origin;

  let best = null;
  let bestScore = -1;
  scope.find('img').each((_, el) => {
    const url = resolveImageUrl($, el, pageUrl);
    if (!url) return;
    const score = scoreLogoCandidate($, el, pageUrl, origin);
    if (score > bestScore) {
      bestScore = score;
      best = { url, alt: $(el).attr('alt') || '' };
    }
  });
  return best;
}

function collectSocialLinks(sections) {
  const socialLinks = sections.flatMap((section) => section.links).filter((link) => link.isSocial);
  const seen = new Map();
  for (const link of socialLinks) {
    if (!seen.has(link.url)) seen.set(link.url, { url: link.url, platform: link.platform });
  }
  return [...seen.values()];
}

function collectNavLinks(sections) {
  const navLinks = sections.filter((section) => section.type === 'nav').flatMap((section) => section.links);
  const seen = new Map();
  for (const link of navLinks) {
    if (!seen.has(link.url)) seen.set(link.url, { url: link.url, text: link.text });
  }
  return [...seen.values()];
}

// Hierarchical counterpart to `collectNavLinks`: same nav-section source, but preserves
// parent/children nesting instead of flattening. Unlike `collectNavLinks`, this is not deduped
// by url — a placeholder-toggle parent's `url` is `null`, so dedup-by-url would collapse
// unrelated dropdown parents into one.
function collectNavTree(sections) {
  return sections.filter((section) => section.type === 'nav').flatMap((section) => section.navTree ?? []);
}

export function extractPageStructure(html, pageUrl) {
  const $ = cheerio.load(html);
  const landmarks = claimLandmarks($);
  const sections = buildSections($, landmarks, pageUrl);

  const claimedEls = landmarks.map((landmark) => landmark.el);
  const uncategorizedRoots = findUnclaimedRoots($, $('body').get(0), claimedEls);
  uncategorizedRoots.forEach((root) => {
    const section = buildUncategorizedSection($, root, pageUrl, sections.length);
    if (section) sections.push(section);
  });

  return {
    sections,
    logo: detectLogo($, pageUrl),
    socialLinks: collectSocialLinks(sections),
    navLinks: collectNavLinks(sections),
    navTree: collectNavTree(sections),
  };
}
