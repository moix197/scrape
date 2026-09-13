import * as cheerio from 'cheerio';
import { resolveUrl } from '../utils/urls.js';

export function extractLinkedStylesheetUrls(html, pageUrl) {
  const $ = cheerio.load(html);
  const urls = [];
  $('link[rel="stylesheet"]').each((_, el) => {
    const resolved = resolveUrl(pageUrl, $(el).attr('href'));
    if (resolved) urls.push(resolved);
  });
  return urls;
}

function extractUrlsFromValue(value) {
  const urlRegex = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
  const raws = [];
  let match;
  while ((match = urlRegex.exec(value))) {
    raws.push(match[2].trim());
  }
  return raws;
}

export function extractBackgroundImagesFromCss(cssText, cssBaseUrl) {
  const urls = new Set();
  const declRegex = /background(?:-image)?\s*:\s*([^;}{]+)/gi;
  let match;
  while ((match = declRegex.exec(cssText))) {
    for (const raw of extractUrlsFromValue(match[1])) {
      if (!raw || raw.startsWith('data:')) continue;
      const resolved = resolveUrl(cssBaseUrl, raw);
      if (resolved) urls.add(resolved);
    }
  }
  return [...urls];
}

function parseFontFamily(block) {
  const familyMatch = /font-family\s*:\s*([^;]+);?/i.exec(block);
  if (!familyMatch) return null;
  return familyMatch[1].trim().replace(/^['"]|['"]$/g, '');
}

function parseFontFaceSrcEntries(block, cssBaseUrl) {
  const srcMatch = /src\s*:\s*([^;]+);?/i.exec(block);
  if (!srcMatch) return [];

  const entryRegex = /url\(\s*(['"]?)(.*?)\1\s*\)(?:\s*format\(\s*(['"]?)(.*?)\3\s*\))?/gi;
  const entries = [];
  let entryMatch;
  while ((entryMatch = entryRegex.exec(srcMatch[1]))) {
    const raw = entryMatch[2].trim();
    if (!raw || raw.startsWith('data:')) continue;
    const resolved = resolveUrl(cssBaseUrl, raw);
    if (!resolved) continue;
    entries.push({ url: resolved, format: entryMatch[4] ? entryMatch[4].trim() : null });
  }
  return entries;
}

export function extractFontsFromCss(cssText, cssBaseUrl) {
  const fonts = [];
  const fontFaceRegex = /@font-face\s*\{([^}]*)\}/gi;
  let faceMatch;
  while ((faceMatch = fontFaceRegex.exec(cssText))) {
    const block = faceMatch[1];
    const fontFamily = parseFontFamily(block);
    for (const entry of parseFontFaceSrcEntries(block, cssBaseUrl)) {
      fonts.push({ ...entry, fontFamily });
    }
  }
  return fonts;
}
