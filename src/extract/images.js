import * as cheerio from 'cheerio';
import { resolveUrl } from '../utils/urls.js';
import { resolveWowImage } from './wixImage.js';

function parseSrcset(srcset) {
  return srcset
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split(/\s+/)[0]);
}

function parseDimension(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function isUsableUrl(url) {
  return url !== null && !url.startsWith('data:');
}

function pushResolvedImage(images, pageUrl, { url, alt, source, width, height }) {
  const resolved = resolveUrl(pageUrl, url);
  if (!isUsableUrl(resolved)) return;
  images.push({ url: resolved, alt, source, width, height });
}

function extractImgTagImages($, pageUrl) {
  const images = [];
  $('img').each((_, el) => {
    const $el = $(el);
    const alt = $el.attr('alt') || '';
    const width = parseDimension($el.attr('width'));
    const height = parseDimension($el.attr('height'));

    const src = $el.attr('src');
    if (src) pushResolvedImage(images, pageUrl, { url: src, alt, source: 'img-src', width, height });

    const srcset = $el.attr('srcset');
    if (srcset) {
      for (const url of parseSrcset(srcset)) {
        pushResolvedImage(images, pageUrl, { url, alt, source: 'srcset', width, height });
      }
    }

    const dataSrc = $el.attr('data-src');
    if (dataSrc) pushResolvedImage(images, pageUrl, { url: dataSrc, alt, source: 'data-src', width, height });

    const dataLazySrc = $el.attr('data-lazy-src');
    if (dataLazySrc) {
      pushResolvedImage(images, pageUrl, { url: dataLazySrc, alt, source: 'data-lazy-src', width, height });
    }
  });
  return images;
}

function extractWowImageImages($, pageUrl) {
  const images = [];
  $('wow-image[data-image-info]').each((_, el) => {
    const $el = $(el);
    const resolved = resolveWowImage($el.attr('data-image-info'));
    if (!resolved) return;
    pushResolvedImage(images, pageUrl, {
      url: resolved.url,
      alt: $el.find('img').first().attr('alt') || '',
      source: 'wow-image',
      width: resolved.width,
      height: resolved.height,
    });
  });
  return images;
}

function extractPictureSourceImages($, pageUrl) {
  const images = [];
  $('picture source[srcset]').each((_, el) => {
    const $el = $(el);
    const srcset = $el.attr('srcset');
    for (const url of parseSrcset(srcset)) {
      pushResolvedImage(images, pageUrl, {
        url,
        alt: '',
        source: 'picture-source',
        width: parseDimension($el.attr('width')),
        height: parseDimension($el.attr('height')),
      });
    }
  });
  return images;
}

const SCRIPT_IMAGE_LITERAL = /(["'])([^"'\s<>]+?\.(?:jpe?g|png|gif|webp|svg|avif)(?:\?[^"'\s<>]*)?)\1/gi;
const SCRIPT_STRING_LITERAL = /(["'])([^"'\s<>]+)\1/g;

// Slideshow plugins (fadeSlideShow, etc.) list their images only in an inline script's config
// (`imagearray: [["a.jpg"], ...]`). Any image-looking string literal counts, in source order; all
// string literals (e.g. `wrapperid: "fadeshow1"`) are returned as `literals` so the caller can
// find the element the gallery renders into.
export function extractInlineScriptGalleries($, pageUrl) {
  const galleries = [];
  $('script:not([src])').each((_, el) => {
    const code = $(el).html() || '';
    const urls = [...new Set([...code.matchAll(SCRIPT_IMAGE_LITERAL)].map((m) => resolveUrl(pageUrl, m[2])).filter(isUsableUrl))];
    if (urls.length === 0) return;
    const literals = [...code.matchAll(SCRIPT_STRING_LITERAL)].map((m) => m[2]);
    galleries.push({ urls, literals });
  });
  return galleries;
}

function extractInlineScriptImages($, pageUrl) {
  return extractInlineScriptGalleries($, pageUrl).flatMap(({ urls }) =>
    urls.map((url) => ({ url, alt: '', source: 'inline-script', width: null, height: null })),
  );
}

export function extractImages(html, pageUrl) {
  const $ = cheerio.load(html);
  return [
    ...extractImgTagImages($, pageUrl),
    ...extractPictureSourceImages($, pageUrl),
    ...extractWowImageImages($, pageUrl),
    ...extractInlineScriptImages($, pageUrl),
  ];
}
