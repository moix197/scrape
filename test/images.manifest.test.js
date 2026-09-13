import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  createManifestBuilder,
  writeJson,
  buildManifestImageMap,
  resolveSectionImageUrls,
  resolveStructureImageUrls,
} from '../src/images/manifest.js';

test('createManifestBuilder builds expected shape', () => {
  const builder = createManifestBuilder('https://example.com');

  builder.addPage({ url: 'https://example.com/', title: 'Home', description: 'Landing page' });
  builder.addImage({
    sourcePageUrl: 'https://example.com/',
    imageUrl: 'https://example.com/hero.jpg',
    localFilename: 'hero.jpg',
    width: 800,
    height: 600,
    alt: 'Hero image',
  });

  const manifest = builder.build();

  assert.equal(manifest.siteUrl, 'https://example.com');
  assert.equal(typeof manifest.scrapedAt, 'string');
  assert.notEqual(new Date(manifest.scrapedAt).toString(), 'Invalid Date');
  assert.deepEqual(manifest.pages, [
    { url: 'https://example.com/', title: 'Home', description: 'Landing page' },
  ]);
  assert.deepEqual(manifest.images, [
    {
      sourcePageUrl: 'https://example.com/',
      imageUrl: 'https://example.com/hero.jpg',
      localFilename: 'hero.jpg',
      width: 800,
      height: 600,
      alt: 'Hero image',
      sectionType: null,
      sectionLabel: null,
      isLogo: false,
      usages: [],
    },
  ]);
});

test('addImage defaults sectionType/sectionLabel/isLogo when omitted', () => {
  const builder = createManifestBuilder('https://example.com');
  builder.addImage({
    sourcePageUrl: 'https://example.com/',
    imageUrl: 'https://example.com/plain.jpg',
    localFilename: 'plain.jpg',
    width: 100,
    height: 100,
    alt: '',
  });

  const [image] = builder.build().images;
  assert.equal(image.sectionType, null);
  assert.equal(image.sectionLabel, null);
  assert.equal(image.isLogo, false);
  assert.deepEqual(image.usages, []);
});

test('addImage passes through sectionType/sectionLabel/isLogo when provided', () => {
  const builder = createManifestBuilder('https://example.com');
  builder.addImage({
    sourcePageUrl: 'https://example.com/',
    imageUrl: 'https://example.com/logo.png',
    localFilename: 'logo.png',
    width: 200,
    height: 60,
    alt: 'Logo',
    sectionType: 'header',
    sectionLabel: 'header',
    isLogo: true,
    usages: [{ sourcePageUrl: 'https://example.com/', sectionType: 'header', sectionLabel: 'header' }],
  });

  const [image] = builder.build().images;
  assert.equal(image.sectionType, 'header');
  assert.equal(image.sectionLabel, 'header');
  assert.equal(image.isLogo, true);
  assert.deepEqual(image.usages, [
    { sourcePageUrl: 'https://example.com/', sectionType: 'header', sectionLabel: 'header' },
  ]);
});

test('createManifestBuilder starts with empty pages/images', () => {
  const manifest = createManifestBuilder('https://example.com').build();
  assert.deepEqual(manifest.pages, []);
  assert.deepEqual(manifest.images, []);
});

test('buildManifestImageMap indexes manifest image rows by imageUrl, skipping rows missing either field', () => {
  const images = [
    { imageUrl: 'https://example.com/a.jpg', localFilename: 'a1b2.jpg', width: 800, height: 600 },
    { imageUrl: 'https://example.com/b.jpg', localFilename: null, width: 10, height: 10 },
    { imageUrl: null, localFilename: 'orphan.jpg', width: 10, height: 10 },
  ];
  const map = buildManifestImageMap(images);
  assert.deepEqual(map.get('https://example.com/a.jpg'), { localFilename: 'a1b2.jpg', width: 800, height: 600 });
  assert.equal(map.size, 1);
});

test('buildManifestImageMap tolerates a missing/empty image list', () => {
  assert.equal(buildManifestImageMap(undefined).size, 0);
  assert.equal(buildManifestImageMap([]).size, 0);
});

test('resolveSectionImageUrls rewrites resolved images to their local filename + dimensions, nulling out unresolved ones', () => {
  const section = {
    type: 'gallery',
    images: [
      { url: 'https://example.com/a.jpg', alt: 'A', order: 0 },
      { url: 'https://example.com/unresolved.jpg', alt: 'U', order: 1 },
    ],
  };
  const map = new Map([['https://example.com/a.jpg', { localFilename: 'a1b2.jpg', width: 800, height: 600 }]]);
  const resolved = resolveSectionImageUrls(section, map);
  assert.deepEqual(
    resolved.images.map(({ url, width, height }) => ({ url, width, height })),
    [
      { url: 'a1b2.jpg', width: 800, height: 600 },
      { url: null, width: null, height: null },
    ],
  );
  assert.equal(resolved.images[0].alt, 'A');
});

test('resolveStructureImageUrls applies the resolution across every page and section', () => {
  const structureJson = {
    pages: [
      {
        url: 'https://example.com/',
        sections: [{ type: 'hero', images: [{ url: 'https://example.com/a.jpg', alt: '', order: 0 }] }],
      },
    ],
  };
  const map = new Map([['https://example.com/a.jpg', { localFilename: 'a1b2.jpg', width: 800, height: 600 }]]);
  const resolved = resolveStructureImageUrls(structureJson, map);
  const image = resolved.pages[0].sections[0].images[0];
  assert.equal(image.url, 'a1b2.jpg');
  assert.equal(image.width, 800);
  assert.equal(image.height, 600);
});

test('resolveStructureImageUrls also resolves the top-level and per-page logo, not just section images', () => {
  const structureJson = {
    logo: { url: 'https://example.com/logo.png', alt: 'Acme' },
    pages: [
      {
        url: 'https://example.com/',
        logo: { url: 'https://example.com/logo.png', alt: 'Acme' },
        sections: [],
      },
      { url: 'https://example.com/about', logo: null, sections: [] },
    ],
  };
  const map = new Map([['https://example.com/logo.png', { localFilename: 'logo123.png', width: 351, height: 91 }]]);
  const resolved = resolveStructureImageUrls(structureJson, map);

  assert.equal(resolved.logo.url, 'logo123.png');
  assert.equal(resolved.logo.width, 351);
  assert.equal(resolved.logo.height, 91);
  assert.equal(resolved.pages[0].logo.url, 'logo123.png');
  assert.equal(resolved.pages[1].logo, null, 'a page with no detected logo stays null');
});

test('writeJson writes pretty-printed JSON, creating parent directories', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'site-scraper-manifest-'));
  const filePath = path.join(tmpDir, 'nested', 'dir', 'manifest.json');

  try {
    const data = { siteUrl: 'https://example.com', pages: [], images: [] };
    await writeJson(filePath, data);

    const raw = await fs.readFile(filePath, 'utf8');
    assert.deepEqual(JSON.parse(raw), data);
    assert.equal(raw, JSON.stringify(data, null, 2));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
