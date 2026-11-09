import fs from 'node:fs/promises';
import path from 'node:path';

export function createManifestBuilder(siteUrl) {
  const pages = [];
  const images = [];
  let documents = [];
  let crawl = null;

  return {
    setDocuments(rows) {
      documents = rows;
    },
    setCrawl(info) {
      crawl = info;
    },
    addImage({
      sourcePageUrl,
      imageUrl,
      localFilename,
      width,
      height,
      alt,
      sectionType = null,
      sectionLabel = null,
      isLogo = false,
      usages = [],
    }) {
      images.push({ sourcePageUrl, imageUrl, localFilename, width, height, alt, sectionType, sectionLabel, isLogo, usages });
    },
    addPage({ url, title, description }) {
      pages.push({ url, title, description });
    },
    build() {
      return {
        siteUrl,
        scrapedAt: new Date().toISOString(),
        crawl,
        pages,
        images,
        documents,
      };
    },
  };
}

export async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

// Keyed by imageUrl, one entry per manifest row — carries everything a structure.json image
// object needs from the manifest (filename + real downloaded dimensions), so nothing about an
// image requires a second, separate cross-reference against manifest.json afterward.
export function buildManifestImageMap(images) {
  const map = new Map();
  for (const image of images ?? []) {
    if (image.imageUrl && image.localFilename) {
      map.set(image.imageUrl, { localFilename: image.localFilename, width: image.width, height: image.height });
    }
  }
  return map;
}

// `url` must only ever be a local filename or null — never a remote address, so a site builder
// can trust it unconditionally instead of having to sniff "does this look like a URL". An image
// with no manifest row (filtered by size, failed download, etc.) stays unresolved: `url`,
// `width`, and `height` all come back null, since no real dimensions were ever measured.
export function resolveSectionImageUrls(section, manifestByUrl) {
  if (!section.images?.length) return section;
  return {
    ...section,
    images: section.images.map((img) => {
      const entry = manifestByUrl.get(img.url);
      return { ...img, url: entry?.localFilename ?? null, width: entry?.width ?? null, height: entry?.height ?? null };
    }),
  };
}

// The detected logo is a `{ url, alt }` pair, same shape as a section image, but it lives
// outside any section's `images[]` (top-level `structureJson.logo` and each page's own
// `page.logo`) — easy to miss when resolving image urls, so it gets its own small helper
// rather than being silently skipped.
function resolveLogoUrl(logo, manifestByUrl) {
  if (!logo) return logo;
  const entry = manifestByUrl.get(logo.url);
  return { ...logo, url: entry?.localFilename ?? null, width: entry?.width ?? null, height: entry?.height ?? null };
}

// Applied to structure.json itself at scrape time (scrapeSite.js), right after images finish
// downloading — by the time restructure.js reads structure.json back in, image urls are already
// local filenames, so restructure's own section-merge carries them through with no extra work.
export function resolveStructureImageUrls(structureJson, manifestByUrl) {
  return {
    ...structureJson,
    logo: resolveLogoUrl(structureJson.logo, manifestByUrl),
    footer: structureJson.footer ? resolveSectionImageUrls(structureJson.footer, manifestByUrl) : null,
    pages: structureJson.pages.map((page) => ({
      ...page,
      logo: resolveLogoUrl(page.logo, manifestByUrl),
      sections: page.sections.map((section) => resolveSectionImageUrls(section, manifestByUrl)),
    })),
  };
}
