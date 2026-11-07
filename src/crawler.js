import * as cheerio from 'cheerio';
import { resolveUrl, isSameOrigin, normalizeUrl } from './utils/urls.js';
import { fetchRobotsRules, isAllowed } from './utils/robots.js';
import { createRateLimiter } from './utils/rateLimiter.js';
import { withBackoff } from './utils/backoff.js';
import { readResponseHtml } from './utils/decodeHtml.js';
import { extractImages } from './extract/images.js';
import { extractFontLinks } from './extract/fonts.js';
import { extractVideos } from './extract/videos.js';
import { extractPageStructure } from './extract/structure.js';
import { extractPageMeta, extractSiteMeta, extractVisibleText } from './extract/copy.js';
import {
  extractLinkedStylesheetUrls,
  extractBackgroundImagesFromCss,
  extractLogoBackgroundFromCss,
  extractFontsFromCss,
} from './extract/css.js';
import { extractColorRules, extractInlineStyleBlocks } from './extract/colors.js';
import { renderWithPlaywright } from './render/playwrightFallback.js';

const MIN_TEXT_LENGTH = 200;

// A page whose URL smells like a videography-focused page (cinematography/videos/etc.) but has
// no video captured yet is a strong sign of a lazy-hydrated widget (e.g. Wix's VideoPlayer — an
// empty mount <div> with no <iframe>/<video> at all until scrolled into view and given a moment
// to fetch its real player) rather than the site genuinely having no video content there.
const VIDEO_PAGE_URL_KEYWORDS = ['video', 'videography', 'cinematography', 'film'];

export function isLikelyLazyVideoPage(html, pageUrl) {
  let path;
  try {
    path = new URL(pageUrl).pathname.toLowerCase();
  } catch {
    return false;
  }
  const looksVideoRelated = VIDEO_PAGE_URL_KEYWORDS.some((keyword) => path.includes(keyword));
  if (!looksVideoRelated) return false;
  // Reuse the same extraction the rest of the pipeline uses, rather than re-guessing what
  // counts as "a video" — a page can have an unrelated iframe (e.g. an Instagram embed) without
  // that counting as already having its video captured.
  return extractVideos(html, pageUrl).length === 0;
}

const BINARY_EXTENSION = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|rar|7z|gz|docx?|xlsx?|pptx?|mp[34]|mov|avi|wmv|webm|exe|dmg)$/i;

function hasBinaryExtension(url) {
  return BINARY_EXTENSION.test(new URL(url).pathname);
}

function extractLinksFromPage(html, pageUrl, originUrl) {
  const $ = cheerio.load(html);
  const links = new Set();

  $('a[href]').each((_, el) => {
    const resolved = resolveUrl(pageUrl, $(el).attr('href'));
    if (!resolved || !isSameOrigin(resolved, originUrl) || hasBinaryExtension(resolved)) return;
    links.add(normalizeUrl(resolved));
  });

  return [...links];
}

async function fetchUrlWithLog({ url, userAgent, rateLimiter, onFetchLogged, method = 'fetch' }) {
  await rateLimiter.throttle();
  const response = await withBackoff(() => fetch(url, { headers: { 'User-Agent': userAgent } }));
  onFetchLogged?.({ url, status: response.status, timestamp: new Date().toISOString(), method });
  return response;
}

async function fetchPageHtml(url, { userAgent, rateLimiter, onFetchLogged, minImagesThreshold, forcePlaywright, browserSession }) {
  let response;
  try {
    response = await fetchUrlWithLog({ url, userAgent, rateLimiter, onFetchLogged });
  } catch {
    onFetchLogged?.({ url, status: 0, timestamp: new Date().toISOString(), method: 'fetch' });
    return null;
  }
  if (!response.ok) return null;

  const plainHtml = await readResponseHtml(response);
  if (plainHtml === null) return null;
  const shouldTryPlaywright =
    forcePlaywright || isLikelyClientRendered(plainHtml, url, minImagesThreshold) || isLikelyLazyVideoPage(plainHtml, url);
  if (!shouldTryPlaywright) return plainHtml;

  const rendered = await renderWithPlaywright(url, { session: browserSession });
  if (!rendered) return plainHtml;

  onFetchLogged?.({ url, status: 200, timestamp: new Date().toISOString(), method: 'playwright' });
  return rendered.html;
}

function isLikelyClientRendered(html, pageUrl, minImagesThreshold) {
  const imageCount = extractImages(html, pageUrl).length;
  const textLength = extractVisibleText(html).length;
  return imageCount < minImagesThreshold && textLength < MIN_TEXT_LENGTH;
}

async function fetchStylesheetText(url, { userAgent, rateLimiter, onFetchLogged, originUrl, robotsRules }) {
  if (!isSameOrigin(url, originUrl)) return '';
  if (!isAllowed(robotsRules, url)) return '';
  try {
    const response = await fetchUrlWithLog({ url, userAgent, rateLimiter, onFetchLogged });
    if (!response.ok) return '';
    return await response.text();
  } catch {
    return '';
  }
}

async function collectStylesheetExtras(html, pageUrl, deps) {
  const stylesheetUrls = extractLinkedStylesheetUrls(html, pageUrl);
  const images = [];
  const fonts = [];
  const colorRules = [];
  const logoCandidates = [];

  for (const cssUrl of stylesheetUrls) {
    const cssText = await fetchStylesheetText(cssUrl, deps);
    if (!cssText) continue;
    for (const url of extractBackgroundImagesFromCss(cssText, cssUrl)) {
      images.push({ url, alt: '', source: 'css-background', width: null, height: null });
    }
    const cssLogo = extractLogoBackgroundFromCss(cssText, cssUrl);
    if (cssLogo) logoCandidates.push(cssLogo);
    fonts.push(...extractFontsFromCss(cssText, cssUrl));
    colorRules.push(...extractColorRules(cssText));
  }

  return { images, fonts, colorRules, stylesheetUrls, logoCandidates };
}

// A CSS-background logo only counts when the page actually has that element; it then beats the
// <img> guess, which falls back to any header image when nothing is marked as a logo.
function pickCssLogo(html, logoCandidates) {
  const $ = cheerio.load(html);
  const match = logoCandidates.find(({ selector }) => $(selector).length > 0);
  if (!match) return null;
  return { url: match.url, alt: $(match.selector).find('a[title]').first().attr('title') || '' };
}

async function processPage(url, deps) {
  const { userAgent, rateLimiter, onFetchLogged, minImagesThreshold, forcePlaywright, originUrl, robotsRules, browserSession } = deps;
  const html = await fetchPageHtml(url, { userAgent, rateLimiter, onFetchLogged, minImagesThreshold, forcePlaywright, browserSession });
  if (html === null) return null;

  const meta = extractPageMeta(html, url);
  const pageImages = extractImages(html, url).map((img) => ({ ...img, sourcePageUrl: url }));
  const fontLinks = extractFontLinks(html, url);
  const structure = extractPageStructure(html, url);
  const videos = extractVideos(html, url).map((v) => ({ ...v, sourcePageUrl: url }));
  const links = extractLinksFromPage(html, url, originUrl);

  const cssExtras = await collectStylesheetExtras(html, url, { userAgent, rateLimiter, onFetchLogged, originUrl, robotsRules });
  const cssImages = cssExtras.images.map((img) => ({ ...img, sourcePageUrl: url }));
  const cssLogo = pickCssLogo(html, cssExtras.logoCandidates);
  if (cssLogo) structure.logo = cssLogo;
  const inlineColorRules = extractColorRules(extractInlineStyleBlocks(html));

  return {
    page: { url, title: meta.title, description: meta.description, structure, meta, site: extractSiteMeta(html, url) },
    images: [...pageImages, ...cssImages],
    fonts: [...fontLinks, ...cssExtras.fonts],
    videos,
    links,
    colorRules: [...inlineColorRules, ...cssExtras.colorRules],
  };
}

function dedupeByUrlKeepFirst(items) {
  const seen = new Map();
  for (const item of items) {
    if (!seen.has(item.url)) seen.set(item.url, item);
  }
  return [...seen.values()];
}

export async function crawlSite(rootUrl, options = {}) {
  const {
    maxPages = 40,
    maxDepth = 2,
    requestsPerSecond = 1,
    userAgent = 'site-scraper/0.1 (+pitch-mockup research)',
    minImagesThreshold = 3,
    forcePlaywright = false,
    onFetchLogged,
    onPageCrawled,
    browserSession,
  } = options;

  const originUrl = new URL(rootUrl).origin;
  const robotsRules = await fetchRobotsRules(originUrl, userAgent);
  const rateLimiter = createRateLimiter(requestsPerSecond);

  const visited = new Set();
  const queue = [{ url: normalizeUrl(rootUrl), depth: 0 }];
  visited.add(normalizeUrl(rootUrl));

  const pages = [];
  const allImages = [];
  const allFonts = [];
  const allVideos = [];
  const allColorRules = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const { url, depth } = queue.shift();

    if (!isAllowed(robotsRules, url)) continue;

    const result = await processPage(url, {
      userAgent,
      rateLimiter,
      onFetchLogged,
      minImagesThreshold,
      forcePlaywright,
      originUrl,
      robotsRules,
      browserSession,
    });

    if (result === null) continue;

    pages.push(result.page);
    allImages.push(...result.images);
    allFonts.push(...result.fonts);
    allVideos.push(...result.videos);
    allColorRules.push(...result.colorRules);
    onPageCrawled?.(result.page);

    if (depth < maxDepth) {
      for (const link of result.links) {
        if (visited.has(link)) continue;
        visited.add(link);
        queue.push({ url: link, depth: depth + 1 });
      }
    }
  }

  return {
    pages,
    images: dedupeByUrlKeepFirst(allImages),
    fonts: dedupeByUrlKeepFirst(allFonts),
    videos: dedupeByUrlKeepFirst(allVideos),
    colorRules: allColorRules,
  };
}
