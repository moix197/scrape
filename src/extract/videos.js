import * as cheerio from 'cheerio';
import { resolveUrl } from '../utils/urls.js';

const EMBED_HOST_MATCHERS = [
  { hosts: ['youtube.com', 'youtube-nocookie.com', 'youtu.be'], source: 'youtube-embed' },
  { hosts: ['vimeo.com'], source: 'vimeo-embed' },
  { hosts: ['wistia.com', 'wistia.net'], source: 'wistia-embed' },
];

const VIDEO_FILE_EXTENSIONS = ['.mp4', '.webm', '.ogg', '.ogv', '.mov'];

function isUsableUrl(url) {
  return url !== null && !url.startsWith('data:');
}

function pushResolvedVideo(videos, pageUrl, { url, source, type = null, poster = null }) {
  const resolved = resolveUrl(pageUrl, url);
  if (!isUsableUrl(resolved)) return;
  videos.push({ url: resolved, source, type, poster });
}

function resolvePoster($el, pageUrl) {
  const poster = $el.attr('poster');
  return poster ? resolveUrl(pageUrl, poster) : null;
}

function extractVideoTagSrc($, pageUrl) {
  const videos = [];
  $('video').each((_, el) => {
    const $el = $(el);
    const poster = resolvePoster($el, pageUrl);

    const src = $el.attr('src');
    if (src) pushResolvedVideo(videos, pageUrl, { url: src, source: 'video-src', poster });

    const dataSrc = $el.attr('data-src') || $el.attr('data-lazy-src');
    if (dataSrc) pushResolvedVideo(videos, pageUrl, { url: dataSrc, source: 'video-data-src', poster });
  });
  return videos;
}

function extractVideoSourceChildren($, pageUrl) {
  const videos = [];
  $('video').each((_, el) => {
    const $video = $(el);
    const poster = resolvePoster($video, pageUrl);

    $video.find('source').each((__, sourceEl) => {
      const $source = $(sourceEl);
      const src = $source.attr('src');
      if (!src) return;
      const type = $source.attr('type') || null;
      pushResolvedVideo(videos, pageUrl, { url: src, source: 'video-source', type, poster });
    });
  });
  return videos;
}

function matchEmbedSource(src) {
  const lowerSrc = src.toLowerCase();
  const match = EMBED_HOST_MATCHERS.find(({ hosts }) => hosts.some((host) => lowerSrc.includes(host)));
  return match ? match.source : null;
}

// `about:blank` is a common lazy-load placeholder (e.g. `<iframe src="about:blank"
// data-src="...">`) — a non-empty `src` that still means "no real src yet", so it must not
// win over data-src/data-lazy-src the way a real src would.
function isPlaceholderIframeSrc(src) {
  return typeof src === 'string' && src.trim().toLowerCase() === 'about:blank';
}

function extractIframeEmbeds($, pageUrl) {
  const videos = [];
  $('iframe').each((_, el) => {
    const $el = $(el);
    const src = $el.attr('src');
    const dataSrc = $el.attr('data-src') || $el.attr('data-lazy-src');
    const realSrc = src && !isPlaceholderIframeSrc(src) ? src : null;
    const iframeSrc = realSrc || dataSrc || src;
    if (!iframeSrc) return;
    const embedSource = matchEmbedSource(iframeSrc);
    if (!embedSource) return;
    const source = realSrc ? embedSource : `${embedSource}-data-src`;
    pushResolvedVideo(videos, pageUrl, { url: iframeSrc, source });
  });
  return videos;
}

function isVideoFileLink(href) {
  const pathOnly = href.split(/[?#]/)[0].toLowerCase();
  return VIDEO_FILE_EXTENSIONS.some((ext) => pathOnly.endsWith(ext));
}

function extractVideoFileLinks($, pageUrl) {
  const videos = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || !isVideoFileLink(href)) return;
    pushResolvedVideo(videos, pageUrl, { url: href, source: 'link-video-file' });
  });
  return videos;
}

function dedupeByUrlKeepFirst(videos) {
  const seen = new Map();
  for (const video of videos) {
    if (!seen.has(video.url)) seen.set(video.url, video);
  }
  return [...seen.values()];
}

export function extractVideos(html, pageUrl) {
  const $ = cheerio.load(html);
  const videos = [
    ...extractVideoTagSrc($, pageUrl),
    ...extractVideoSourceChildren($, pageUrl),
    ...extractIframeEmbeds($, pageUrl),
    ...extractVideoFileLinks($, pageUrl),
  ];
  return dedupeByUrlKeepFirst(videos);
}
