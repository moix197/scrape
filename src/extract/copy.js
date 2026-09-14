import * as cheerio from 'cheerio';
import { resolveUrl } from '../utils/urls.js';

export function extractVisibleText(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript, template').remove();
  const container = $('body').length ? $('body') : $.root();
  return container.text().replace(/\s+/g, ' ').trim();
}

function extractCanonical($, pageUrl) {
  const href = $('link[rel="canonical"]').first().attr('href');
  return resolveUrl(pageUrl, href);
}

function extractOpenGraph($, pageUrl) {
  const title = $('meta[property="og:title"]').attr('content')?.trim() || null;
  const description = $('meta[property="og:description"]').attr('content')?.trim() || null;
  const image = resolveUrl(pageUrl, $('meta[property="og:image"]').attr('content'));
  return { title, description, image };
}

function extractJsonLd($) {
  const entries = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    let parsed;
    try {
      parsed = JSON.parse($(el).text());
    } catch {
      return;
    }
    if (Array.isArray(parsed)) entries.push(...parsed);
    else entries.push(parsed);
  });
  return entries;
}

export function extractPageMeta(html, pageUrl) {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim();
  const description = $('meta[name="description"]').attr('content')?.trim() || '';
  return {
    title,
    description,
    canonical: extractCanonical($, pageUrl),
    og: extractOpenGraph($, pageUrl),
    jsonLd: extractJsonLd($),
  };
}

const FAVICON_REL_TOKENS = new Set(['icon', 'shortcut icon', 'apple-touch-icon']);

function extractFavicon($, pageUrl) {
  let href = null;
  $('link[rel]').each((_, el) => {
    if (href) return;
    const rel = $(el).attr('rel')?.trim().toLowerCase();
    if (rel && FAVICON_REL_TOKENS.has(rel)) href = $(el).attr('href');
  });
  return resolveUrl(pageUrl, href);
}

export function extractSiteMeta(html, pageUrl) {
  const $ = cheerio.load(html);
  const lang = $('html').attr('lang')?.trim() || null;
  return { lang, favicon: extractFavicon($, pageUrl) };
}
