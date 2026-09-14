import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJson } from './images/manifest.js';

const STATUS_FILENAME = 'restructure-status.json';

// The website_simple/freelo theme's fixed section-family roster (see that repo's
// .ai/index.md § "Section family inventory") — closed on purpose, so restructured
// output slots straight into the theme with no manual mapping step.
const THEME_FAMILIES = [
  'hero',
  'about',
  'services',
  'process',
  'faq',
  'contact',
  'location',
  'testimonials',
  'logos',
  'gallery',
  'stats',
  'pricing',
  'cta-band',
  'team',
  'news',
];
// nav/footer sections are hoisted to root-level structureJson.nav/.footer before restructure
// ever runs (see scrapeSite.js buildStructureOutput) — only header ever reaches page.sections.
const CHROME_TYPES = ['header'];
const UNMATCHED_TYPE = 'unmatched';
const ALLOWED_TYPES = new Set([...THEME_FAMILIES, ...CHROME_TYPES, UNMATCHED_TYPE]);

const SYSTEM_PROMPT = `You reorganize the sections of a scraped webpage into a cleaner, more SEO-friendly structure ahead of a site rebuild onto a fixed theme.

You will receive the page's existing sections as a JSON array, each with a stable numeric "id", a DOM-derived "type"/"label", its "headings", and its body "text".

Group these EXISTING sections into a new ordered list of output sections: reorder them, relabel "type" using ONLY the closed vocabulary below, write a clearer "label", and merge sections that represent the same real-world content block (e.g. two separately-detected galleries that are really one portfolio).

The theme's section families — pick exactly one "type" per output section from this list, or from the two exceptions below it:
${THEME_FAMILIES.join(', ')}

Chrome types (site-wide header, not page-body sections — never relabel these into a family above, and never relabel a real family section into one of these): ${CHROME_TYPES.join(', ')}

If a section's content genuinely matches none of the above, use type "${UNMATCHED_TYPE}" and include a mandatory non-empty "description" explaining what the content actually is (e.g. "profile page for a single rental venue: address, photo gallery, capacity — no matching theme family; may need a new template"). Do not force-fit content into the wrong family just to avoid this fallback — an honest "${UNMATCHED_TYPE}" is correct when nothing fits.

Rules:
- Do not invent, drop, edit, or summarize any section's text or headings — you are only regrouping and relabeling whole input sections.
- Every input id must appear in exactly one output section's "sourceIds" array. No id may be missing or duplicated.
- Merging concatenates the merged sections' content in their original relative order — you don't need to do that concatenation yourself, just list which ids belong together.
- "type" must be one of: ${[...ALLOWED_TYPES].join(', ')}. No other value is accepted.

Respond with ONLY a JSON object of this exact shape, no markdown fences, no commentary:
{"sections":[{"sourceIds":[<id>,...],"type":"...","label":"...","description":"..." (required and non-empty only when type is "${UNMATCHED_TYPE}")}]}`;

function buildSectionSummaries(sections) {
  return sections.map((section, id) => ({
    id,
    type: section.type,
    label: section.label,
    headings: section.headings.map((h) => h.text),
    text: section.text,
  }));
}

function buildRestructurePrompt(page) {
  const summaries = buildSectionSummaries(page.sections);
  const user = JSON.stringify({ url: page.url, sections: summaries });
  return { system: SYSTEM_PROMPT, user };
}

function parseModelResponse(text) {
  const parsed = JSON.parse(text.trim());
  if (!Array.isArray(parsed.sections)) throw new Error('Response missing "sections" array');
  return parsed;
}

function validateEntryType(entry) {
  if (!ALLOWED_TYPES.has(entry.type)) {
    throw new Error(`restructure plan entry has invalid type "${entry.type}"`);
  }
  if (entry.type === UNMATCHED_TYPE && (typeof entry.description !== 'string' || entry.description.trim() === '')) {
    throw new Error(`restructure plan entry with type "${UNMATCHED_TYPE}" is missing a non-empty description`);
  }
}

function validatePlan(plan, originalCount) {
  if (!Array.isArray(plan.sections) || plan.sections.length === 0) {
    throw new Error('restructure plan has no sections');
  }
  const seen = new Set();
  for (const entry of plan.sections) {
    if (!Array.isArray(entry.sourceIds) || entry.sourceIds.length === 0) {
      throw new Error('restructure plan entry missing non-empty sourceIds');
    }
    validateEntryType(entry);
    for (const id of entry.sourceIds) {
      if (!Number.isInteger(id) || id < 0 || id >= originalCount) {
        throw new Error(`invalid source id ${id} in restructure plan`);
      }
      if (seen.has(id)) throw new Error(`id ${id} used more than once in restructure plan`);
      seen.add(id);
    }
  }
  if (seen.size !== originalCount) {
    throw new Error(`restructure plan covers ${seen.size} of ${originalCount} original section ids`);
  }
}

// First-wins dedupe by (type, value) — same pattern as scrapeSite.js's collectSiteContacts.
function dedupeContacts(contacts) {
  const seen = new Map();
  for (const contact of contacts) {
    const key = `${contact.type}:${contact.value}`;
    if (!seen.has(key)) seen.set(key, contact);
  }
  return [...seen.values()];
}

function mergeSections(sections, sourceIds, { type, label, description }, order) {
  const sourceSections = [...sourceIds].sort((a, b) => a - b).map((id) => sections[id]);
  // Only a "cards" source section (see extract/structure.js) carries this — omitted rather
  // than merged in as `[]` so a merge with no card content doesn't grow every other section's
  // shape.
  const cards = sourceSections.flatMap((s) => s.cards ?? []);
  return {
    type,
    label,
    ...(description ? { description } : {}),
    order,
    selectorPath: sourceSections[0].selectorPath,
    images: sourceSections.flatMap((s) => s.images).map((img, i) => ({ ...img, order: i })),
    videos: sourceSections.flatMap((s) => s.videos).map((v, i) => ({ ...v, order: i })),
    headings: sourceSections.flatMap((s) => s.headings),
    links: sourceSections.flatMap((s) => s.links),
    text: sourceSections.map((s) => s.text).filter(Boolean).join(' '),
    ...(cards.length ? { cards } : {}),
    contacts: dedupeContacts(sourceSections.flatMap((s) => s.contacts)),
    listItems: sourceSections.flatMap((s) => s.listItems),
    form: sourceSections.map((s) => s.form).find((f) => f != null) ?? null,
  };
}

function applyRestructurePlan(sections, plan) {
  validatePlan(plan, sections.length);
  return plan.sections.map((entry, order) => mergeSections(sections, entry.sourceIds, entry, order));
}

function createPrecomputedCaller(responseTexts) {
  let index = 0;
  return async function callModel() {
    if (index >= responseTexts.length) {
      throw new Error(`createPrecomputedCaller: no more responses available (called ${index + 1} times for ${responseTexts.length} entries) — a page's plan is missing`);
    }
    return responseTexts[index++];
  };
}

function buildRestructureJobs(structureJson) {
  const jobs = [];
  structureJson.pages.forEach((page, pageIndex) => {
    if (page.sections.length === 0) return;
    const { system, user } = buildRestructurePrompt(page);
    jobs.push({ pageIndex, url: page.url, system, user });
  });
  return jobs;
}

async function restructurePage(page, { callModel }) {
  if (page.sections.length === 0) return { url: page.url, sections: [], skipped: true };

  try {
    const { system, user } = buildRestructurePrompt(page);
    const responseText = await callModel(system, user);
    const plan = parseModelResponse(responseText);
    const sections = applyRestructurePlan(page.sections, plan);
    return { url: page.url, sections, restructured: true };
  } catch (error) {
    return { url: page.url, sections: page.sections, restructured: false, error: error.message };
  }
}

async function restructureSite(structureJson, { callModel, onPageDone }) {
  const pages = [];
  let pagesRestructured = 0;
  let pagesSkipped = 0;
  let pagesFailed = 0;

  for (const page of structureJson.pages) {
    const result = await restructurePage(page, { callModel });
    onPageDone?.(result);
    if (result.skipped) pagesSkipped += 1;
    else if (result.restructured) pagesRestructured += 1;
    else pagesFailed += 1;

    pages.push({ ...page, sections: result.sections });
  }

  return { structureJson: { ...structureJson, pages }, pagesRestructured, pagesSkipped, pagesFailed };
}

function buildSectionMarkdown(section) {
  const heading = `### ${section.label} (${section.type})`;
  const description = section.description ? `_${section.description}_\n\n` : '';
  return `${heading}\n\n${description}${section.text || '_no text_'}\n`;
}

function buildRestructuredCopyMarkdown(pages) {
  return pages
    .map((page) => {
      const sections = page.sections.map(buildSectionMarkdown).join('\n');
      return `## ${page.url}\n\n${sections}`;
    })
    .join('\n---\n\n');
}

async function readRestructureStatus(siteDir) {
  try {
    const text = await fs.readFile(path.join(siteDir, STATUS_FILENAME), 'utf8');
    return JSON.parse(text);
  } catch {
    return { done: false, at: null, model: null, pagesRestructured: 0, pagesSkipped: 0, pagesFailed: 0 };
  }
}

async function writeRestructureStatus(siteDir, status) {
  await writeJson(path.join(siteDir, STATUS_FILENAME), status);
}

async function findSiteDirs(outDir) {
  let entries;
  try {
    entries = await fs.readdir(outDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const siteDir = path.join(outDir, entry.name);
    try {
      await fs.access(path.join(siteDir, 'structure.json'));
      dirs.push(siteDir);
    } catch {
      // not a scraped site folder — skip
    }
  }
  return dirs;
}

async function readManifestSiteUrl(siteDir) {
  try {
    const text = await fs.readFile(path.join(siteDir, 'manifest.json'), 'utf8');
    return JSON.parse(text).siteUrl;
  } catch {
    return null;
  }
}

async function resolveTargetSiteDirs(outDir, target) {
  const allDirs = await findSiteDirs(outDir);
  if (!target) return allDirs;

  const matches = [];
  for (const dir of allDirs) {
    const domainMatch = path.basename(dir) === target;
    const siteUrl = await readManifestSiteUrl(dir);
    if (domainMatch || siteUrl === target) matches.push(dir);
  }
  return matches;
}

async function mirrorIntoBatchSummary(outDir, siteUrl, restructured) {
  const summaryPath = path.join(outDir, 'batch-summary.json');
  let summary;
  try {
    summary = JSON.parse(await fs.readFile(summaryPath, 'utf8'));
  } catch {
    return;
  }
  const entry = summary.sites.find((s) => s.url === siteUrl);
  if (!entry) return;
  entry.restructured = restructured;
  await writeJson(summaryPath, summary);
}

async function restructureSiteDir(siteDir, { callModel, model, outDir, onPageDone }) {
  const structureJson = JSON.parse(await fs.readFile(path.join(siteDir, 'structure.json'), 'utf8'));

  const {
    structureJson: restructured,
    pagesRestructured,
    pagesSkipped,
    pagesFailed,
  } = await restructureSite(structureJson, { callModel, onPageDone });

  await writeJson(path.join(siteDir, 'structure.restructured.json'), restructured);
  await fs.writeFile(path.join(siteDir, 'copy.restructured.md'), buildRestructuredCopyMarkdown(restructured.pages));

  const status = { done: true, at: new Date().toISOString(), model, pagesRestructured, pagesSkipped, pagesFailed };
  await writeRestructureStatus(siteDir, status);

  const siteUrl = await readManifestSiteUrl(siteDir);
  if (siteUrl && outDir) await mirrorIntoBatchSummary(outDir, siteUrl, true);

  return status;
}

export {
  STATUS_FILENAME,
  THEME_FAMILIES,
  CHROME_TYPES,
  UNMATCHED_TYPE,
  ALLOWED_TYPES,
  buildSectionSummaries,
  buildRestructurePrompt,
  parseModelResponse,
  validatePlan,
  mergeSections,
  applyRestructurePlan,
  createPrecomputedCaller,
  buildRestructureJobs,
  restructurePage,
  restructureSite,
  buildRestructuredCopyMarkdown,
  readRestructureStatus,
  writeRestructureStatus,
  findSiteDirs,
  readManifestSiteUrl,
  resolveTargetSiteDirs,
  mirrorIntoBatchSummary,
  restructureSiteDir,
};
