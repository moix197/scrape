import path from 'node:path';
import fs from 'node:fs/promises';
import { imageSize } from 'image-size';
import { crawlSite } from './crawler.js';
import { getDomainFolderName } from './utils/urls.js';
import { sha1Hex } from './utils/hash.js';
import { downloadImage } from './images/download.js';
import { createContentDedupe, passesSizeFilter } from './images/dedup.js';
import { extractDominantColors } from './images/palette.js';
import { createManifestBuilder, writeJson, buildManifestImageMap, resolveStructureImageUrls } from './images/manifest.js';
import { scoreSiteColors } from './extract/colors.js';

const TOP_IMAGES_FOR_PALETTE = 5;
const USER_AGENT = 'site-scraper/0.1 (+pitch-mockup research)';

function guessExtension(contentType, url) {
  const byContentType = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/avif': '.avif',
  };
  if (contentType && byContentType[contentType]) return byContentType[contentType];

  const match = /\.(jpe?g|png|gif|webp|svg|avif)(?:$|[?#])/i.exec(url);
  return match ? `.${match[1].toLowerCase()}` : '.bin';
}

function resolveImageDimensions(buffer, fallbackWidth, fallbackHeight) {
  try {
    const { width, height } = imageSize(buffer);
    return { width, height };
  } catch {
    return { width: fallbackWidth, height: fallbackHeight };
  }
}

async function saveImageBuffer(outputBase, filename, buffer) {
  const imagesDir = path.join(outputBase, 'images');
  await fs.mkdir(imagesDir, { recursive: true });
  const filePath = path.join(imagesDir, filename);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

// Re-scraping a site (iterating on this tool, not because the live site changed) has no reason
// to re-download every image over the network again — a prior run's manifest.json already says
// exactly which URL maps to which file on disk. `--fresh` opts back into a full re-download.
export async function loadPreviousImageCache(outputBase, { fresh }) {
  if (fresh) return new Map();
  try {
    const text = await fs.readFile(path.join(outputBase, 'manifest.json'), 'utf8');
    return buildManifestImageMap(JSON.parse(text).images);
  } catch {
    return new Map();
  }
}

// Returns null (falls through to a real download) if the manifest said a file exists but it's
// since gone missing from disk — never trust the cache blindly over what's actually there.
async function tryLoadCachedImage(image, { outputBase, previousImagesByUrl }) {
  const entry = previousImagesByUrl.get(image.url);
  if (!entry?.localFilename) return null;
  try {
    const buffer = await fs.readFile(path.join(outputBase, 'images', entry.localFilename));
    return { buffer, byteLength: buffer.byteLength, localFilename: entry.localFilename, width: entry.width, height: entry.height };
  } catch {
    return null;
  }
}

// Chrome (site-wide header/nav/footer) sections are where small, legitimate icons live —
// social icons, a secondary mark — that the generic size filter would otherwise mistake for
// tracking pixels. Same reasoning as the logo exemption below, just keyed by section instead
// of by URL.
const ICON_EXEMPT_SECTION_TYPES = new Set(['header', 'nav', 'footer']);

async function downloadAndFilterImage(
  image,
  { userAgent, sizeFilterOptions, contentDedupe, logoUrl, imageSectionLookup, outputBase, previousImagesByUrl },
) {
  const cached = await tryLoadCachedImage(image, { outputBase, previousImagesByUrl });
  if (cached) {
    const hash = sha1Hex(cached.buffer);
    if (!contentDedupe.getExisting(hash)) {
      contentDedupe.addHash(hash, { localFilename: cached.localFilename, width: cached.width, height: cached.height });
    }
    return { ...cached, hash, fromCache: true };
  }

  const downloaded = await downloadImage(image.url, { userAgent });
  if (downloaded === null) return null;

  const hash = sha1Hex(downloaded.buffer);
  // A different URL whose bytes are byte-identical to one already saved: still a legitimate
  // manifest entry, just pointing at the file already on disk instead of a new download.
  const existingEntry = contentDedupe.getExisting(hash);
  if (existingEntry) return { isDuplicate: true, existingEntry };

  const { width, height } = resolveImageDimensions(downloaded.buffer, image.width, image.height);
  // The size filter exists to drop icons/tracking pixels, but a real logo is often short-and-wide
  // (e.g. a 351x91 wordmark) and would get wrongly dropped by it — never filter the detected logo,
  // nor a small icon that legitimately belongs in the header/nav/footer chrome.
  const isLogo = image.url === logoUrl;
  const isChromeIcon = ICON_EXEMPT_SECTION_TYPES.has(imageSectionLookup.get(image.url)?.sectionType);
  const candidate = { width, height, byteLength: downloaded.byteLength };
  if (!isLogo && !isChromeIcon && !passesSizeFilter(candidate, sizeFilterOptions)) return null;

  return { ...downloaded, hash, width, height };
}

// Keeps only the largest TOP_IMAGES_FOR_PALETTE buffers in memory at any time, instead of
// every downloaded image's buffer for the whole crawl (that OOMs on large/full-site crawls).
function updateTopByBytes(topByBytes, candidate, limit) {
  topByBytes.push(candidate);
  topByBytes.sort((a, b) => b.byteLength - a.byteLength);
  topByBytes.length = Math.min(topByBytes.length, limit);
  return topByBytes;
}

function addImageManifestRow(manifest, image, { localFilename, width, height }, { imageSectionLookup, logoUrl }) {
  manifest.addImage({
    sourcePageUrl: image.sourcePageUrl,
    imageUrl: image.url,
    localFilename,
    width,
    height,
    alt: image.alt,
    ...(imageSectionLookup.get(image.url) ?? {}),
    isLogo: image.url === logoUrl,
  });
}

export async function processImages(
  images,
  { outputBase, userAgent, sizeFilterOptions, manifest, imageSectionLookup, logoUrl, previousImagesByUrl = new Map() },
) {
  const contentDedupe = createContentDedupe();
  const saved = [];
  let topByBytes = [];
  let reusedFromCache = 0;

  for (const image of images) {
    const result = await downloadAndFilterImage(image, {
      userAgent,
      sizeFilterOptions,
      contentDedupe,
      logoUrl,
      imageSectionLookup,
      outputBase,
      previousImagesByUrl,
    });
    if (result === null) continue;

    if (result.isDuplicate) {
      addImageManifestRow(manifest, image, result.existingEntry, { imageSectionLookup, logoUrl });
      continue;
    }

    if (result.fromCache) {
      addImageManifestRow(manifest, image, { localFilename: result.localFilename, width: result.width, height: result.height }, { imageSectionLookup, logoUrl });
      topByBytes = updateTopByBytes(topByBytes, { buffer: result.buffer, byteLength: result.byteLength }, TOP_IMAGES_FOR_PALETTE);
      saved.push({ filename: result.localFilename, sourcePageUrl: image.sourcePageUrl, byteLength: result.byteLength });
      reusedFromCache += 1;
      continue;
    }

    const filename = `${result.hash.slice(0, 12)}${guessExtension(result.contentType, image.url)}`;
    await saveImageBuffer(outputBase, filename, result.buffer);
    contentDedupe.addHash(result.hash, { localFilename: filename, width: result.width, height: result.height });

    addImageManifestRow(manifest, image, { localFilename: filename, width: result.width, height: result.height }, { imageSectionLookup, logoUrl });

    topByBytes = updateTopByBytes(topByBytes, { buffer: result.buffer, byteLength: result.byteLength }, TOP_IMAGES_FOR_PALETTE);
    saved.push({ filename, sourcePageUrl: image.sourcePageUrl, byteLength: result.byteLength });
  }

  return { saved, topByBytes, reusedFromCache };
}

async function buildPalette(topByBytes) {
  const colorSets = await Promise.all(topByBytes.map((img) => extractDominantColors(img.buffer, { count: 5 })));
  return { colors: [...new Set(colorSets.flat())] };
}

function buildSectionMarkdown(section) {
  const heading = `### ${section.label} (${section.type})`;
  return `${heading}\n\n${section.text || '_no text_'}\n`;
}

function buildCopyMarkdown(pages) {
  return pages
    .map((page) => {
      const heading = page.title || page.url;
      const sections = page.structure.sections.map(buildSectionMarkdown).join('\n');
      return `## ${heading}\n\n**URL:** ${page.url}\n\n**Description:** ${page.description || '_none_'}\n\n${sections}`;
    })
    .join('\n---\n\n');
}

async function writeFetchLog(outputBase, fetchLog) {
  const lines = fetchLog.map((entry) => JSON.stringify(entry)).join('\n');
  await fs.mkdir(outputBase, { recursive: true });
  await fs.writeFile(path.join(outputBase, 'fetch-log.jsonl'), lines ? `${lines}\n` : '');
}

function logProgress(page) {
  console.log(`crawled: ${page.url}`);
}

async function crawlAndBuildManifest(cliOptions, manifest, fetchLog) {
  const crawlResult = await crawlSite(cliOptions.rootUrl, {
    maxPages: cliOptions.maxPages,
    maxDepth: cliOptions.maxDepth,
    requestsPerSecond: cliOptions.rate,
    userAgent: USER_AGENT,
    forcePlaywright: cliOptions.forcePlaywright,
    onFetchLogged: (entry) => fetchLog.push(entry),
    onPageCrawled: logProgress,
  });

  for (const page of crawlResult.pages) {
    manifest.addPage({ url: page.url, title: page.title, description: page.description });
  }

  return crawlResult;
}

function dedupeLinksByUrl(links) {
  const seen = new Map();
  for (const link of links) if (!seen.has(link.url)) seen.set(link.url, link);
  return [...seen.values()];
}

function derivePageName(url) {
  const segments = new URL(url).pathname.split('/').filter(Boolean);
  return segments.length ? segments[segments.length - 1] : 'home';
}

// navLinks/navTree are the same site-wide menu on every page (one <nav> per site) — pick the
// first page's as the site-wide nav, and warn (not throw) if some page's really does differ,
// since that would mean the nav genuinely varies by page and this pick is losing information.
function pickSiteNav(pages) {
  const navs = pages.map((p) => ({ navLinks: p.structure.navLinks, navTree: p.structure.navTree }));
  const serialized = navs.map((n) => JSON.stringify(n));
  if (!serialized.every((s) => s === serialized[0])) {
    console.warn('Pages have inconsistent nav content; using the first page\'s nav as the site-wide nav.');
  }
  return navs[0];
}

function footerContentKey(section) {
  const { images, videos, headings, links, text } = section;
  return JSON.stringify({ images, videos, headings, links, text });
}

// Same idea as pickSiteNav, but for the footer-type section (not every page has one at all).
function pickSiteFooter(pages) {
  const footers = pages
    .map((p) => p.structure.sections.find((s) => s.type === 'footer'))
    .filter(Boolean);
  if (footers.length === 0) return null;
  const keys = footers.map(footerContentKey);
  if (!keys.every((k) => k === keys[0])) {
    console.warn('Pages have inconsistent footer content; using the first detected footer as the site-wide footer.');
  }
  const { images, videos, headings, links, text } = footers[0];
  return { images, videos, headings, links, text };
}

function stripChromeSections(sections) {
  return sections.filter((s) => s.type !== 'nav' && s.type !== 'footer');
}

function buildStructureOutput(pages) {
  const withLogo = pages.find((p) => p.structure.logo);
  const socialLinks = dedupeLinksByUrl(pages.flatMap((p) => p.structure.socialLinks));
  return {
    logo: withLogo ? withLogo.structure.logo : null,
    socialLinks,
    nav: pickSiteNav(pages),
    footer: pickSiteFooter(pages),
    pages: pages.map((p) => ({
      url: p.url,
      name: derivePageName(p.url),
      sections: stripChromeSections(p.structure.sections),
      logo: p.structure.logo,
    })),
  };
}

function addUsageIfNew(usages, usage) {
  const isDuplicate = usages.some(
    (existing) =>
      existing.sourcePageUrl === usage.sourcePageUrl &&
      existing.sectionType === usage.sectionType &&
      existing.sectionLabel === usage.sectionLabel
  );
  if (!isDuplicate) usages.push(usage);
}

// Keeps the first page/section as the singular sectionType/sectionLabel (existing consumers
// reading a single value), while `usages` additionally records every distinct page/section an
// image appears in — a shared logo/background used on every page previously reported only one.
export function buildImageSectionLookup(pages) {
  const lookup = new Map();
  for (const page of pages) {
    for (const section of page.structure.sections) {
      for (const img of section.images) {
        const usage = { sourcePageUrl: page.url, sectionType: section.type, sectionLabel: section.label };
        if (!lookup.has(img.url)) {
          lookup.set(img.url, { sectionType: section.type, sectionLabel: section.label, usages: [] });
        }
        addUsageIfNew(lookup.get(img.url).usages, usage);
      }
    }
  }
  return lookup;
}

async function writeAllOutputs(outputBase, { manifest, crawlResult, palette, fetchLog, structureOutput }) {
  await writeJson(path.join(outputBase, 'manifest.json'), manifest.build());
  await writeJson(path.join(outputBase, 'fonts.json'), crawlResult.fonts);
  await writeJson(path.join(outputBase, 'videos.json'), crawlResult.videos);
  await writeJson(path.join(outputBase, 'structure.json'), structureOutput);
  await writeJson(path.join(outputBase, 'palette.json'), palette);
  await writeJson(path.join(outputBase, 'site-colors.json'), { colors: scoreSiteColors(crawlResult.colorRules) });
  await fs.writeFile(path.join(outputBase, 'copy.md'), buildCopyMarkdown(crawlResult.pages));
  await writeFetchLog(outputBase, fetchLog);
}

export async function runScrape(cliOptions) {
  const originUrl = new URL(cliOptions.rootUrl).origin;
  const outputBase = path.join(cliOptions.out, getDomainFolderName(cliOptions.rootUrl));
  const fetchLog = [];
  const manifest = createManifestBuilder(cliOptions.rootUrl);

  console.log(`Crawling ${originUrl} (max ${cliOptions.maxPages} pages, depth ${cliOptions.maxDepth})...`);
  const crawlResult = await crawlAndBuildManifest(cliOptions, manifest, fetchLog);
  if (crawlResult.pages.length === 0) {
    throw new Error(`No pages could be crawled from ${cliOptions.rootUrl} (unreachable, or disallowed by robots.txt).`);
  }

  const structureOutput = buildStructureOutput(crawlResult.pages);
  const imageSectionLookup = buildImageSectionLookup(crawlResult.pages);
  const logoUrl = structureOutput.logo?.url ?? null;

  const sizeFilterOptions = {
    minWidth: cliOptions.minWidth,
    minHeight: cliOptions.minHeight,
    minBytes: cliOptions.minBytes,
  };

  const previousImagesByUrl = await loadPreviousImageCache(outputBase, { fresh: cliOptions.fresh });

  console.log(
    `Downloading ${crawlResult.images.length} discovered images` +
      (previousImagesByUrl.size ? ` (reusing already-downloaded ones from a prior scrape; pass --fresh to force re-download)` : '') +
      `...`,
  );
  const { saved: savedImages, topByBytes, reusedFromCache } = await processImages(crawlResult.images, {
    outputBase,
    userAgent: USER_AGENT,
    sizeFilterOptions,
    manifest,
    imageSectionLookup,
    logoUrl,
    previousImagesByUrl,
  });

  const palette = await buildPalette(topByBytes);

  // Deterministic — resolve each image's url/width/height now, while the manifest is still in
  // memory, so structure.json (and anything derived from it, e.g. restructure.js's
  // structure.restructured.json) never needs a second cross-reference against manifest.json.
  const manifestByUrl = buildManifestImageMap(manifest.build().images);
  const resolvedStructureOutput = resolveStructureImageUrls(structureOutput, manifestByUrl);

  await writeAllOutputs(outputBase, { manifest, crawlResult, palette, fetchLog, structureOutput: resolvedStructureOutput });

  console.log(
    `\nDone. Pages crawled: ${crawlResult.pages.length}. Images saved: ${savedImages.length}` +
      (reusedFromCache ? ` (${reusedFromCache} reused from a prior scrape, no re-download)` : '') +
      `. Videos found: ${crawlResult.videos.length}.`,
  );
  console.log(`Output written to: ${outputBase}`);

  return { pages: crawlResult.pages.length, images: savedImages.length, videos: crawlResult.videos.length };
}
