import * as cheerio from 'cheerio';
import { resolveUrl } from '../utils/urls.js';

function classifyFontLink(href, rel, as) {
  if (href.includes('fonts.googleapis.com') || href.includes('fonts.gstatic.com')) {
    return 'google-fonts';
  }
  if (rel === 'preload' && as === 'font') return 'preload-font';
  return 'stylesheet';
}

export function extractFontLinks(html, pageUrl) {
  const $ = cheerio.load(html);
  const links = [];

  $('link').each((_, el) => {
    const $el = $(el);
    const rel = ($el.attr('rel') || '').trim().toLowerCase();
    const isRelevant = rel === 'stylesheet' || rel === 'preload';
    if (!isRelevant) return;

    const resolved = resolveUrl(pageUrl, $el.attr('href'));
    if (!resolved) return;

    const as = ($el.attr('as') || '').trim().toLowerCase();
    links.push({ url: resolved, kind: classifyFontLink(resolved, rel, as) });
  });

  return links;
}
