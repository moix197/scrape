import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { processImages, buildImageSectionLookup, loadPreviousImageCache } from '../src/scrapeSite.js';
import { createManifestBuilder, buildManifestImageMap, resolveStructureImageUrls } from '../src/images/manifest.js';

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function fakeImageResponse(buffer) {
  return {
    ok: true,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'image/png' : null) },
    arrayBuffer: async () => toArrayBuffer(buffer),
  };
}

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'site-scraper-images-test-'));
}

test('processImages adds a manifest row aliasing the same file when two URLs are byte-identical', async (t) => {
  const outputBase = await makeTmpDir();
  const sharedBytes = Buffer.from('identical-image-bytes');
  t.mock.method(global, 'fetch', async () => fakeImageResponse(sharedBytes));

  try {
    const manifest = createManifestBuilder('https://example.com');
    const images = [
      { url: 'https://example.com/a.png', sourcePageUrl: 'https://example.com/', alt: 'A', width: 200, height: 200 },
      { url: 'https://example.com/b.png', sourcePageUrl: 'https://example.com/', alt: 'B', width: 200, height: 200 },
    ];

    const { saved } = await processImages(images, {
      outputBase,
      userAgent: 'test-agent',
      sizeFilterOptions: { minWidth: 0, minHeight: 0, minBytes: 0 },
      manifest,
      imageSectionLookup: new Map(),
      logoUrl: null,
    });

    // Only one file is actually downloaded and written; the second URL is a content-alias.
    assert.equal(saved.length, 1);

    const { images: manifestImages } = manifest.build();
    assert.equal(manifestImages.length, 2, 'both URLs must get a manifest row');

    const [rowA, rowB] = manifestImages;
    assert.equal(rowA.imageUrl, 'https://example.com/a.png');
    assert.equal(rowB.imageUrl, 'https://example.com/b.png');
    assert.equal(rowA.localFilename, rowB.localFilename, 'alias row must point at the same saved file');
    assert.equal(rowA.width, rowB.width);
    assert.equal(rowA.height, rowB.height);

    const savedFiles = await fs.readdir(path.join(outputBase, 'images'));
    assert.equal(savedFiles.length, 1, 'bytes must only be saved once, not once per URL');
  } finally {
    await fs.rm(outputBase, { recursive: true, force: true });
  }
});

test('runScrape wiring: structureOutput image urls resolve to local filenames once images finish downloading', async (t) => {
  const outputBase = await makeTmpDir();
  const bytes = Buffer.from('hero-image-bytes');
  t.mock.method(global, 'fetch', async () => fakeImageResponse(bytes));

  try {
    const manifest = createManifestBuilder('https://example.com');
    const heroUrl = 'https://example.com/hero.jpg';
    const structureOutput = {
      logo: null,
      pages: [
        {
          url: 'https://example.com/',
          sections: [
            { type: 'hero', images: [{ url: heroUrl, alt: 'Hero', order: 0 }] },
            { type: 'footer', images: [{ url: 'https://example.com/never-downloaded.jpg', alt: '', order: 0 }] },
          ],
        },
      ],
    };

    await processImages([{ url: heroUrl, sourcePageUrl: 'https://example.com/', alt: 'Hero', width: 800, height: 600 }], {
      outputBase,
      userAgent: 'test-agent',
      sizeFilterOptions: { minWidth: 0, minHeight: 0, minBytes: 0 },
      manifest,
      imageSectionLookup: new Map(),
      logoUrl: null,
    });

    const manifestByUrl = buildManifestImageMap(manifest.build().images);
    const resolved = resolveStructureImageUrls(structureOutput, manifestByUrl);

    const [heroSection, footerSection] = resolved.pages[0].sections;
    assert.match(heroSection.images[0].url, /^[0-9a-f]{12}\.png$/, 'resolved image url is the local filename');
    assert.equal(heroSection.images[0].width, 800, 'resolved image carries its real downloaded width');
    assert.equal(heroSection.images[0].height, 600, 'resolved image carries its real downloaded height');
    assert.equal(footerSection.images[0].url, null, 'an image with no manifest row resolves to null, never a raw url');
    assert.equal(footerSection.images[0].width, null, 'an unresolved image has no known dimensions either');
  } finally {
    await fs.rm(outputBase, { recursive: true, force: true });
  }
});

test('processImages does not size-filter an image in a header/nav/footer section, even below the size threshold', async (t) => {
  const outputBase = await makeTmpDir();
  const tinyBytes = Buffer.from('tiny-icon-bytes');
  t.mock.method(global, 'fetch', async () => fakeImageResponse(tinyBytes));

  try {
    const iconUrl = 'https://example.com/social-icon.png';
    const imageSectionLookup = new Map([[iconUrl, { sectionType: 'footer', sectionLabel: 'footer', usages: [] }]]);

    const { saved } = await processImages(
      [{ url: iconUrl, sourcePageUrl: 'https://example.com/', alt: 'Facebook', width: 40, height: 40 }],
      {
        outputBase,
        userAgent: 'test-agent',
        sizeFilterOptions: { minWidth: 100, minHeight: 100, minBytes: 2048 },
        manifest: createManifestBuilder('https://example.com'),
        imageSectionLookup,
        logoUrl: null,
      },
    );

    assert.equal(saved.length, 1, 'a 40x40 icon in a footer section must not be dropped by the size filter');
  } finally {
    await fs.rm(outputBase, { recursive: true, force: true });
  }
});

test('processImages still size-filters a small image outside header/nav/footer sections', async (t) => {
  const outputBase = await makeTmpDir();
  const tinyBytes = Buffer.from('tracking-pixel-bytes');
  t.mock.method(global, 'fetch', async () => fakeImageResponse(tinyBytes));

  try {
    const pixelUrl = 'https://example.com/tracking-pixel.png';
    const imageSectionLookup = new Map([[pixelUrl, { sectionType: 'section', sectionLabel: 'section', usages: [] }]]);

    const { saved } = await processImages(
      [{ url: pixelUrl, sourcePageUrl: 'https://example.com/', alt: '', width: 1, height: 1 }],
      {
        outputBase,
        userAgent: 'test-agent',
        sizeFilterOptions: { minWidth: 100, minHeight: 100, minBytes: 2048 },
        manifest: createManifestBuilder('https://example.com'),
        imageSectionLookup,
        logoUrl: null,
      },
    );

    assert.equal(saved.length, 0, 'a tracking-pixel-sized image outside chrome sections is still dropped');
  } finally {
    await fs.rm(outputBase, { recursive: true, force: true });
  }
});

test('loadPreviousImageCache reads a prior manifest.json into a url map, and returns empty when fresh is true or nothing exists', async () => {
  const outputBase = await makeTmpDir();
  try {
    await fs.writeFile(
      path.join(outputBase, 'manifest.json'),
      JSON.stringify({ images: [{ imageUrl: 'https://example.com/a.jpg', localFilename: 'a1b2.jpg', width: 800, height: 600 }] }),
    );

    const cache = await loadPreviousImageCache(outputBase, { fresh: false });
    assert.deepEqual(cache.get('https://example.com/a.jpg'), { localFilename: 'a1b2.jpg', width: 800, height: 600 });

    const forcedFresh = await loadPreviousImageCache(outputBase, { fresh: true });
    assert.equal(forcedFresh.size, 0, '--fresh ignores any prior manifest entirely');
  } finally {
    await fs.rm(outputBase, { recursive: true, force: true });
  }
});

test('loadPreviousImageCache returns an empty map when no manifest.json exists yet', async () => {
  const outputBase = await makeTmpDir();
  try {
    const cache = await loadPreviousImageCache(outputBase, { fresh: false });
    assert.equal(cache.size, 0);
  } finally {
    await fs.rm(outputBase, { recursive: true, force: true });
  }
});

test('processImages reuses a previously-downloaded image by url without fetching it again', async (t) => {
  const outputBase = await makeTmpDir();
  const fetchMock = t.mock.fn(async () => {
    throw new Error('fetch should never be called for an image already in previousImagesByUrl');
  });
  t.mock.method(global, 'fetch', fetchMock);

  try {
    const cachedUrl = 'https://example.com/already-downloaded.jpg';
    await fs.mkdir(path.join(outputBase, 'images'), { recursive: true });
    await fs.writeFile(path.join(outputBase, 'images', 'cached123.jpg'), Buffer.from('cached-bytes'));

    const previousImagesByUrl = new Map([[cachedUrl, { localFilename: 'cached123.jpg', width: 400, height: 300 }]]);

    const { saved, reusedFromCache } = await processImages(
      [{ url: cachedUrl, sourcePageUrl: 'https://example.com/', alt: '', width: 400, height: 300 }],
      {
        outputBase,
        userAgent: 'test-agent',
        sizeFilterOptions: { minWidth: 100, minHeight: 100, minBytes: 2048 },
        manifest: createManifestBuilder('https://example.com'),
        imageSectionLookup: new Map(),
        logoUrl: null,
        previousImagesByUrl,
      },
    );

    assert.equal(fetchMock.mock.callCount(), 0, 'no network request should be made for a cached image');
    assert.equal(saved.length, 1);
    assert.equal(saved[0].filename, 'cached123.jpg');
    assert.equal(reusedFromCache, 1);
  } finally {
    await fs.rm(outputBase, { recursive: true, force: true });
  }
});

test('processImages falls back to a real download when the cached file is missing from disk', async (t) => {
  const outputBase = await makeTmpDir();
  const freshBytes = Buffer.from('freshly-downloaded-bytes');
  t.mock.method(global, 'fetch', async () => fakeImageResponse(freshBytes));

  try {
    const url = 'https://example.com/gone-from-disk.jpg';
    // previousImagesByUrl claims a file exists, but it was never actually written to outputBase/images/.
    const previousImagesByUrl = new Map([[url, { localFilename: 'missing.jpg', width: 400, height: 300 }]]);

    const { saved, reusedFromCache } = await processImages(
      [{ url, sourcePageUrl: 'https://example.com/', alt: '', width: 400, height: 300 }],
      {
        outputBase,
        userAgent: 'test-agent',
        sizeFilterOptions: { minWidth: 0, minHeight: 0, minBytes: 0 },
        manifest: createManifestBuilder('https://example.com'),
        imageSectionLookup: new Map(),
        logoUrl: null,
        previousImagesByUrl,
      },
    );

    assert.equal(reusedFromCache, 0, 'a missing cached file must not count as reused');
    assert.equal(saved.length, 1, 'the image is still downloaded fresh instead of being silently dropped');
  } finally {
    await fs.rm(outputBase, { recursive: true, force: true });
  }
});

test('buildImageSectionLookup records every distinct page/section usage of a shared image', () => {
  const sharedUrl = 'https://example.com/shared-logo.png';
  const pages = [
    {
      url: 'https://example.com/',
      structure: { sections: [{ type: 'header', label: 'header', images: [{ url: sharedUrl }] }] },
    },
    {
      url: 'https://example.com/about',
      structure: { sections: [{ type: 'footer', label: 'footer', images: [{ url: sharedUrl }] }] },
    },
  ];

  const lookup = buildImageSectionLookup(pages);
  const entry = lookup.get(sharedUrl);

  // First occurrence wins for the singular fields, for backward compatibility.
  assert.equal(entry.sectionType, 'header');
  assert.equal(entry.sectionLabel, 'header');

  assert.deepEqual(entry.usages, [
    { sourcePageUrl: 'https://example.com/', sectionType: 'header', sectionLabel: 'header' },
    { sourcePageUrl: 'https://example.com/about', sectionType: 'footer', sectionLabel: 'footer' },
  ]);
});

test('processImages manifest row for a shared image lists all usages and isLogo is true if any occurrence is the logo', async (t) => {
  const outputBase = await makeTmpDir();
  const bytes = Buffer.from('shared-logo-bytes');
  t.mock.method(global, 'fetch', async () => fakeImageResponse(bytes));

  try {
    const sharedUrl = 'https://example.com/shared-logo.png';
    const pages = [
      {
        url: 'https://example.com/',
        structure: { sections: [{ type: 'header', label: 'header', images: [{ url: sharedUrl }] }] },
      },
      {
        url: 'https://example.com/about',
        structure: { sections: [{ type: 'footer', label: 'footer', images: [{ url: sharedUrl }] }] },
      },
    ];
    const imageSectionLookup = buildImageSectionLookup(pages);

    const manifest = createManifestBuilder('https://example.com');
    await processImages(
      [{ url: sharedUrl, sourcePageUrl: 'https://example.com/', alt: 'Logo', width: 200, height: 60 }],
      {
        outputBase,
        userAgent: 'test-agent',
        sizeFilterOptions: { minWidth: 0, minHeight: 0, minBytes: 0 },
        manifest,
        imageSectionLookup,
        logoUrl: sharedUrl,
      },
    );

    const [row] = manifest.build().images;
    assert.equal(row.isLogo, true);
    assert.deepEqual(row.usages, [
      { sourcePageUrl: 'https://example.com/', sectionType: 'header', sectionLabel: 'header' },
      { sourcePageUrl: 'https://example.com/about', sectionType: 'footer', sectionLabel: 'footer' },
    ]);
  } finally {
    await fs.rm(outputBase, { recursive: true, force: true });
  }
});
