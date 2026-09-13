import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  buildRestructurePrompt,
  parseModelResponse,
  validatePlan,
  applyRestructurePlan,
  restructurePage,
  restructureSite,
  buildRestructuredCopyMarkdown,
  readRestructureStatus,
  writeRestructureStatus,
  findSiteDirs,
  resolveTargetSiteDirs,
  restructureSiteDir,
  THEME_FAMILIES,
  CHROME_TYPES,
  UNMATCHED_TYPE,
} from '../src/restructure.js';

async function makeTmpDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function fakeSection(overrides) {
  return {
    type: 'section',
    label: 'section',
    order: 0,
    selectorPath: 'body > section',
    images: [],
    videos: [],
    headings: [],
    links: [],
    text: '',
    ...overrides,
  };
}

test('buildRestructurePrompt puts each section under a stable numeric id with headings/text only', () => {
  const page = {
    url: 'https://example.com/',
    sections: [
      fakeSection({ type: 'header', label: 'header', headings: [{ level: 1, text: 'Hi' }], text: 'Hi there' }),
      fakeSection({ type: 'footer', label: 'footer', text: '(c) 2026' }),
    ],
  };

  const { system, user } = buildRestructurePrompt(page);
  assert.match(system, /sourceIds/);

  const parsed = JSON.parse(user);
  assert.equal(parsed.url, page.url);
  assert.deepEqual(parsed.sections, [
    { id: 0, type: 'header', label: 'header', headings: ['Hi'], text: 'Hi there' },
    { id: 1, type: 'footer', label: 'footer', headings: [], text: '(c) 2026' },
  ]);
});

test('parseModelResponse rejects a response with no sections array', () => {
  assert.throws(() => parseModelResponse('{"foo":"bar"}'), /sections/);
});

test('parseModelResponse rejects invalid JSON', () => {
  assert.throws(() => parseModelResponse('not json'));
});

test('validatePlan accepts a plan that covers every id exactly once', () => {
  const plan = { sections: [{ sourceIds: [1, 0], type: 'hero', label: 'Hero' }] };
  assert.doesNotThrow(() => validatePlan(plan, 2));
});

test('validatePlan rejects a plan that drops an id', () => {
  const plan = { sections: [{ sourceIds: [0], type: 'hero', label: 'Hero' }] };
  assert.throws(() => validatePlan(plan, 2), /covers 1 of 2/);
});

test('validatePlan rejects a plan that duplicates an id', () => {
  const plan = {
    sections: [
      { sourceIds: [0], type: 'hero', label: 'a' },
      { sourceIds: [0, 1], type: 'about', label: 'b' },
    ],
  };
  assert.throws(() => validatePlan(plan, 2), /used more than once/);
});

test('validatePlan rejects an out-of-range id', () => {
  const plan = { sections: [{ sourceIds: [5], type: 'hero', label: 'a' }] };
  assert.throws(() => validatePlan(plan, 2), /invalid source id/);
});

test('validatePlan accepts every theme-family type plus header chrome', () => {
  for (const type of [...THEME_FAMILIES, ...CHROME_TYPES]) {
    const plan = { sections: [{ sourceIds: [0], type, label: type }] };
    assert.doesNotThrow(() => validatePlan(plan, 1), `expected type "${type}" to be accepted`);
  }
});

test('validatePlan rejects a made-up type outside the closed vocabulary', () => {
  const plan = { sections: [{ sourceIds: [0], type: 'portfolio-showcase', label: 'x' }] };
  assert.throws(() => validatePlan(plan, 1), /invalid type/);
});

test('validatePlan rejects "unmatched" with no description', () => {
  const plan = { sections: [{ sourceIds: [0], type: UNMATCHED_TYPE, label: 'x' }] };
  assert.throws(() => validatePlan(plan, 1), /description/);
});

test('validatePlan rejects "unmatched" with a blank description', () => {
  const plan = { sections: [{ sourceIds: [0], type: UNMATCHED_TYPE, label: 'x', description: '   ' }] };
  assert.throws(() => validatePlan(plan, 1), /description/);
});

test('validatePlan accepts "unmatched" with a non-empty description', () => {
  const plan = { sections: [{ sourceIds: [0], type: UNMATCHED_TYPE, label: 'x', description: 'a venue profile page' }] };
  assert.doesNotThrow(() => validatePlan(plan, 1));
});

test('applyRestructurePlan merges sections in original order, concatenating media and text', () => {
  const sections = [
    fakeSection({ type: 'gallery', label: 'Gallery A', images: [{ url: 'a1.jpg', alt: '', order: 0 }], text: 'first' }),
    fakeSection({ type: 'main', label: 'main', text: 'middle' }),
    fakeSection({ type: 'gallery', label: 'Gallery B', images: [{ url: 'b1.jpg', alt: '', order: 0 }], text: 'last' }),
  ];
  const plan = {
    sections: [
      { sourceIds: [2, 0], type: 'gallery', label: 'Portfolio' },
      { sourceIds: [1], type: 'about', label: 'About' },
    ],
  };

  const result = applyRestructurePlan(sections, plan);

  assert.equal(result.length, 2);
  assert.equal(result[0].type, 'gallery');
  assert.equal(result[0].label, 'Portfolio');
  assert.equal(result[0].order, 0);
  assert.equal(result[0].text, 'first last');
  assert.deepEqual(
    result[0].images.map((i) => i.url),
    ['a1.jpg', 'b1.jpg'],
  );
  assert.deepEqual(
    result[0].images.map((i) => i.order),
    [0, 1],
  );

  assert.equal(result[1].type, 'about');
  assert.equal(result[1].order, 1);
  assert.equal(result[1].text, 'middle');
});

test('applyRestructurePlan carries an "unmatched" description onto the output section', () => {
  const sections = [fakeSection({ type: 'section', label: 'section', text: 'venue details' })];
  const plan = {
    sections: [{ sourceIds: [0], type: UNMATCHED_TYPE, label: 'Venue Profile', description: 'a single rental venue profile page' }],
  };

  const result = applyRestructurePlan(sections, plan);

  assert.equal(result[0].type, UNMATCHED_TYPE);
  assert.equal(result[0].description, 'a single rental venue profile page');
});

test('applyRestructurePlan carries a "cards" section\'s cards array through unchanged', () => {
  const sections = [
    fakeSection({
      type: 'cards',
      label: 'cards',
      cards: [
        { text: 'Sparrow Beginnings', url: 'https://example.com/sparrow-beginnings', image: 'https://example.com/sparrow.jpg' },
        { text: 'The Legacy', url: null, image: 'https://example.com/legacy.jpg' },
      ],
    }),
  ];
  const plan = { sections: [{ sourceIds: [0], type: 'gallery', label: 'Venues' }] };

  const result = applyRestructurePlan(sections, plan);

  assert.equal(result[0].cards.length, 2);
  assert.equal(result[0].cards[0].text, 'Sparrow Beginnings');
  assert.equal(result[0].cards[1].url, null);
});

test('applyRestructurePlan merges cards from multiple merged source sections and omits cards entirely when none had any', () => {
  const sections = [
    fakeSection({ type: 'cards', label: 'cards', cards: [{ text: 'A', url: null, image: null }] }),
    fakeSection({ type: 'cards', label: 'cards', cards: [{ text: 'B', url: null, image: null }] }),
  ];
  const plan = { sections: [{ sourceIds: [0, 1], type: 'gallery', label: 'Merged' }] };

  const result = applyRestructurePlan(sections, plan);

  assert.deepEqual(
    result[0].cards.map((c) => c.text),
    ['A', 'B'],
  );

  const noCards = applyRestructurePlan(
    [fakeSection({ type: 'about', text: 'x' })],
    { sections: [{ sourceIds: [0], type: 'about', label: 'About' }] },
  );
  assert.ok(!('cards' in noCards[0]));
});

test('restructurePage skips pages with zero sections without calling the model', async () => {
  let called = false;
  const result = await restructurePage(
    { url: 'https://example.com/empty', sections: [] },
    { callModel: async () => { called = true; return '{}'; } },
  );
  assert.equal(called, false);
  assert.equal(result.skipped, true);
  assert.deepEqual(result.sections, []);
});

test('restructurePage falls back to the original sections when the model response is unusable', async () => {
  const originalSections = [fakeSection({ type: 'main', label: 'main', text: 'stuff' })];
  const result = await restructurePage(
    { url: 'https://example.com/bad', sections: originalSections },
    { callModel: async () => 'not json' },
  );
  assert.equal(result.restructured, false);
  assert.ok(result.error);
  assert.deepEqual(result.sections, originalSections);
});

test('restructurePage applies a valid model plan', async () => {
  const originalSections = [
    fakeSection({ type: 'main', label: 'main', text: 'a' }),
    fakeSection({ type: 'main', label: 'main', text: 'b' }),
  ];
  const result = await restructurePage(
    { url: 'https://example.com/ok', sections: originalSections },
    { callModel: async () => JSON.stringify({ sections: [{ sourceIds: [0, 1], type: 'hero', label: 'Hero' }] }) },
  );
  assert.equal(result.restructured, true);
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].text, 'a b');
});

test('restructureSite tallies restructured/skipped/failed pages across a site', async () => {
  const structureJson = {
    logo: null,
    socialLinks: [],
    pages: [
      { url: 'https://example.com/ok', sections: [fakeSection({ text: 'a' })] },
      { url: 'https://example.com/empty', sections: [] },
      { url: 'https://example.com/bad', sections: [fakeSection({ text: 'b' })] },
    ],
  };

  const callModel = async (system, user) => {
    const { url } = JSON.parse(user);
    if (url.endsWith('/bad')) return 'not json';
    return JSON.stringify({ sections: [{ sourceIds: [0], type: 'hero', label: 'Hero' }] });
  };

  const done = [];
  const result = await restructureSite(structureJson, { callModel, onPageDone: (r) => done.push(r) });

  assert.equal(result.pagesRestructured, 1);
  assert.equal(result.pagesSkipped, 1);
  assert.equal(result.pagesFailed, 1);
  assert.equal(done.length, 3);
  assert.equal(result.structureJson.pages.length, 3);
});

test('buildRestructuredCopyMarkdown renders one page block with one subsection per section', () => {
  const pages = [
    { url: 'https://example.com/', sections: [fakeSection({ type: 'hero', label: 'Hero', text: 'Welcome' })] },
  ];
  const markdown = buildRestructuredCopyMarkdown(pages);
  assert.match(markdown, /## https:\/\/example\.com\//);
  assert.match(markdown, /### Hero \(hero\)/);
  assert.match(markdown, /Welcome/);
});

test('buildRestructuredCopyMarkdown renders the description under an "unmatched" section heading', () => {
  const pages = [
    {
      url: 'https://example.com/venue',
      sections: [fakeSection({ type: UNMATCHED_TYPE, label: 'Venue Profile', description: 'a single rental venue profile page', text: 'Address, photos, capacity' })],
    },
  ];
  const markdown = buildRestructuredCopyMarkdown(pages);
  assert.match(markdown, /### Venue Profile \(unmatched\)/);
  assert.match(markdown, /_a single rental venue profile page_/);
  assert.match(markdown, /Address, photos, capacity/);
});

test('readRestructureStatus returns a not-done default when no status file exists', async () => {
  const tmpDir = await makeTmpDir('site-scraper-restructure-test-');
  try {
    const status = await readRestructureStatus(tmpDir);
    assert.equal(status.done, false);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('writeRestructureStatus then readRestructureStatus round-trips', async () => {
  const tmpDir = await makeTmpDir('site-scraper-restructure-test-');
  try {
    const status = { done: true, at: '2026-01-01T00:00:00.000Z', model: 'claude-opus-5', pagesRestructured: 2, pagesSkipped: 0, pagesFailed: 0 };
    await writeRestructureStatus(tmpDir, status);
    assert.deepEqual(await readRestructureStatus(tmpDir), status);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('findSiteDirs only returns folders containing structure.json', async () => {
  const outDir = await makeTmpDir('site-scraper-restructure-test-out-');
  try {
    await fs.mkdir(path.join(outDir, 'site-a'));
    await fs.writeFile(path.join(outDir, 'site-a', 'structure.json'), '{}');
    await fs.mkdir(path.join(outDir, 'not-a-site'));

    const dirs = await findSiteDirs(outDir);
    assert.deepEqual(dirs, [path.join(outDir, 'site-a')]);
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test('resolveTargetSiteDirs matches by domain folder name or manifest siteUrl', async () => {
  const outDir = await makeTmpDir('site-scraper-restructure-test-target-');
  try {
    await fs.mkdir(path.join(outDir, 'example.com'));
    await fs.writeFile(path.join(outDir, 'example.com', 'structure.json'), '{}');
    await fs.writeFile(path.join(outDir, 'example.com', 'manifest.json'), JSON.stringify({ siteUrl: 'https://example.com/' }));

    assert.deepEqual(await resolveTargetSiteDirs(outDir, 'example.com'), [path.join(outDir, 'example.com')]);
    assert.deepEqual(await resolveTargetSiteDirs(outDir, 'https://example.com/'), [path.join(outDir, 'example.com')]);
    assert.deepEqual(await resolveTargetSiteDirs(outDir, 'nope.com'), []);
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});

test('restructureSiteDir writes restructured outputs, status, and mirrors batch-summary.json', async () => {
  const outDir = await makeTmpDir('site-scraper-restructure-test-e2e-');
  const siteDir = path.join(outDir, 'example.com');
  try {
    await fs.mkdir(siteDir, { recursive: true });
    const structureJson = {
      logo: null,
      socialLinks: [],
      pages: [{ url: 'https://example.com/', sections: [fakeSection({ type: 'main', label: 'main', text: 'hi' })] }],
    };
    await fs.writeFile(path.join(siteDir, 'structure.json'), JSON.stringify(structureJson));
    await fs.writeFile(path.join(siteDir, 'manifest.json'), JSON.stringify({ siteUrl: 'https://example.com/' }));
    await fs.writeFile(
      path.join(outDir, 'batch-summary.json'),
      JSON.stringify({ sites: [{ url: 'https://example.com/', status: 'ok' }] }),
    );

    const callModel = async () => JSON.stringify({ sections: [{ sourceIds: [0], type: 'hero', label: 'Hero' }] });
    const status = await restructureSiteDir(siteDir, { callModel, model: 'claude-opus-5', outDir, onPageDone: () => {} });

    assert.equal(status.done, true);
    assert.equal(status.pagesRestructured, 1);

    const restructured = JSON.parse(await fs.readFile(path.join(siteDir, 'structure.restructured.json'), 'utf8'));
    assert.equal(restructured.pages[0].sections[0].label, 'Hero');

    const copyMd = await fs.readFile(path.join(siteDir, 'copy.restructured.md'), 'utf8');
    assert.match(copyMd, /### Hero \(hero\)/);

    const savedStatus = await readRestructureStatus(siteDir);
    assert.equal(savedStatus.done, true);

    const batchSummary = JSON.parse(await fs.readFile(path.join(outDir, 'batch-summary.json'), 'utf8'));
    assert.equal(batchSummary.sites[0].restructured, true);
  } finally {
    await fs.rm(outDir, { recursive: true, force: true });
  }
});
