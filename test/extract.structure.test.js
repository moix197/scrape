import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractPageStructure } from '../src/extract/structure.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(__dirname, 'fixtures/structure.html'), 'utf8');
const pageUrl = 'https://example.com/page';

function findSection(structure, type) {
  return structure.sections.find((s) => s.type === type);
}

function findSections(structure, type) {
  return structure.sections.filter((s) => s.type === type);
}

test('extractPageStructure detects sections in document order with correct types', () => {
  const structure = extractPageStructure(html, pageUrl);
  const types = structure.sections.map((s) => s.type);
  assert.deepEqual(types, [
    'header',
    'nav',
    'hero',
    'gallery',
    'about',
    'contact',
    'testimonials',
    'cards',
    'section',
    'team',
    'footer',
    'uncategorized',
    'uncategorized',
    'uncategorized',
  ]);
  structure.sections.forEach((section, index) => assert.equal(section.order, index));
});

test('extractPageStructure labels sections from their first heading, falling back to type', () => {
  const structure = extractPageStructure(html, pageUrl);
  assert.equal(findSection(structure, 'hero').label, 'Welcome to Acme');
  assert.equal(findSection(structure, 'gallery').label, 'Our Work');
  assert.equal(findSection(structure, 'header').label, 'header');
  assert.equal(findSection(structure, 'nav').label, 'nav');
});

test('extractPageStructure captures gallery images with correct order', () => {
  const structure = extractPageStructure(html, pageUrl);
  const gallery = findSection(structure, 'gallery');
  assert.equal(gallery.images.length, 3);
  assert.deepEqual(
    gallery.images.map((img) => img.order),
    [0, 1, 2],
  );
  assert.ok(gallery.images.every((img) => img.url.startsWith('https://example.com/gallery-')));
});

test('extractPageStructure captures hero heading', () => {
  const structure = extractPageStructure(html, pageUrl);
  const hero = findSection(structure, 'hero');
  assert.deepEqual(hero.headings, [{ level: 1, text: 'Welcome to Acme' }]);
});

test('extractPageStructure populates top-level navLinks from the nav section', () => {
  const structure = extractPageStructure(html, pageUrl);
  assert.equal(structure.navLinks.length, 8);
  assert.ok(structure.navLinks.some((l) => l.url === 'https://example.com/about' && l.text === 'About'));
});

test('extractPageStructure builds a hierarchical navTree preserving parent/child nesting', () => {
  const structure = extractPageStructure(html, pageUrl);
  const byText = (items, text) => items.find((item) => item.text === text);

  assert.equal(structure.navTree.length, 5);

  const about = byText(structure.navTree, 'About');
  assert.equal(about.url, 'https://example.com/about');
  assert.equal(about.children, undefined);

  const services = byText(structure.navTree, 'Services');
  assert.equal(services.url, 'https://example.com/services');
  assert.deepEqual(
    services.children.map((c) => ({ url: c.url, text: c.text })),
    [
      { url: 'https://example.com/services/consulting', text: 'Consulting' },
      { url: 'https://example.com/services/design', text: 'Design' },
    ],
  );

  const contact = byText(structure.navTree, 'Contact');
  assert.equal(contact.url, 'https://example.com/contact');
});

test('extractPageStructure captures a Bootstrap-style dropdown toggle with a placeholder href as a parent with a null url', () => {
  const structure = extractPageStructure(html, pageUrl);
  const resources = structure.navTree.find((item) => item.text === 'Resources');
  assert.ok(resources);
  assert.equal(resources.url, null);
  assert.deepEqual(
    resources.children.map((c) => ({ url: c.url, text: c.text })),
    [{ url: 'https://example.com/resources/guides', text: 'Guides' }],
  );
});

test('extractPageStructure captures a button-based dropdown toggle (no anchor) by its text', () => {
  const structure = extractPageStructure(html, pageUrl);
  const more = structure.navTree.find((item) => item.text === 'More');
  assert.ok(more);
  assert.equal(more.url, null);
  assert.deepEqual(
    more.children.map((c) => ({ url: c.url, text: c.text })),
    [{ url: 'https://example.com/more/faq', text: 'FAQ' }],
  );
});

test('extractPageStructure still exposes the flat nav.links array unchanged alongside navTree', () => {
  const structure = extractPageStructure(html, pageUrl);
  const nav = findSection(structure, 'nav');
  assert.ok(nav.links.some((l) => l.url === 'https://example.com/services/consulting'));
  assert.ok(Array.isArray(nav.navTree));
});

test('extractPageStructure claims a <nav> nested inside <header> as its own section, not swallowed by the wrapper', () => {
  const structure = extractPageStructure(html, pageUrl);
  const header = findSection(structure, 'header');
  const nav = findSection(structure, 'nav');
  assert.ok(header, 'header section should still be claimed');
  assert.ok(nav, 'nav nested inside header should still be claimed as its own section');
  assert.equal(nav.navTree.length, 5);
  assert.ok(!header.links.some((l) => l.url === 'https://example.com/about'), "header's own links must exclude the nested nav's items");
});

test('extractPageStructure collects deduped socialLinks across sections, excluding mailto', () => {
  const structure = extractPageStructure(html, pageUrl);
  const platforms = structure.socialLinks.map((l) => l.platform);
  assert.ok(platforms.includes('facebook'));
  assert.ok(platforms.includes('instagram'));
  assert.ok(platforms.includes('twitter'));
  assert.ok(platforms.includes('youtube'));
  assert.ok(!structure.socialLinks.some((l) => l.url.startsWith('mailto:')));

  const urls = structure.socialLinks.map((l) => l.url);
  assert.equal(new Set(urls).size, urls.length);
});

test('extractPageStructure detects the logo image and its alt text', () => {
  const structure = extractPageStructure(html, pageUrl);
  assert.ok(structure.logo);
  assert.equal(structure.logo.url, 'https://example.com/logo.png');
  assert.equal(structure.logo.alt, 'Acme Logo');
});

test('extractPageStructure classifies the youtube iframe as a video, excludes the maps iframe', () => {
  const structure = extractPageStructure(html, pageUrl);
  const testimonials = findSection(structure, 'testimonials');
  assert.equal(testimonials.videos.length, 1);
  assert.equal(testimonials.videos[0].source, 'youtube-embed');

  const allVideos = structure.sections.flatMap((s) => s.videos);
  assert.ok(!allVideos.some((v) => v.url.includes('google.com/maps')));
});

test('extractPageStructure captures a lazy-loaded iframe video via data-src fallback', () => {
  const structure = extractPageStructure(html, pageUrl);
  const hero = findSection(structure, 'hero');
  const lazyVideo = hero.videos.find((v) => v.url === 'https://player.vimeo.com/video/999');
  assert.ok(lazyVideo);
  assert.equal(lazyVideo.source, 'vimeo-embed');
});

test('extractPageStructure treats iframe src="about:blank" as a placeholder and falls back to data-src', () => {
  const structure = extractPageStructure(html, pageUrl);
  const hero = findSection(structure, 'hero');
  const blankVideo = hero.videos.find((v) => v.url === 'https://player.vimeo.com/video/54321');
  assert.ok(blankVideo);
  assert.equal(blankVideo.source, 'vimeo-embed');
});

test('extractPageStructure gives each section its own scoped body text', () => {
  const structure = extractPageStructure(html, pageUrl);
  assert.equal(findSection(structure, 'about').text, 'About Us We build things.');
  assert.equal(findSection(structure, 'footer').text, 'Twitter X YouTube © 2026 Acme Inc. 555-010-2020');
});

test('extractPageStructure includes link text in a section\'s body text', () => {
  const structure = extractPageStructure(html, pageUrl);
  assert.equal(findSection(structure, 'contact').text, 'Contact Us Facebook Instagram Email us Call us Email');
});

test('extractPageStructure captures deduped tel/mailto contacts for a section, in document order', () => {
  const structure = extractPageStructure(html, pageUrl);
  const contact = findSection(structure, 'contact');
  assert.deepEqual(contact.contacts, [
    { type: 'mailto', value: 'hello@acme.com', label: 'Email us' },
    { type: 'tel', value: '+15550102020', label: 'Call us' },
  ]);
});

test('extractPageStructure normalizes a bare tel: href to digits only', () => {
  const structure = extractPageStructure(html, pageUrl);
  const footer = findSection(structure, 'footer');
  assert.deepEqual(footer.contacts, [{ type: 'tel', value: '5550102020', label: '555-010-2020' }]);
});

test('extractPageStructure gives a section with no tel/mailto anchors an empty contacts array', () => {
  const structure = extractPageStructure(html, pageUrl);
  assert.deepEqual(findSection(structure, 'hero').contacts, []);
});

test('extractPageStructure keeps tel/mailto hrefs out of a section\'s links array', () => {
  const structure = extractPageStructure(html, pageUrl);
  const contact = findSection(structure, 'contact');
  assert.ok(!contact.links.some((l) => l.url.startsWith('tel:') || l.url.startsWith('mailto:')));
});

test('extractPageStructure excludes a <form>\'s labels, buttons, links, images, and headings from its containing section entirely', () => {
  const structure = extractPageStructure(html, pageUrl);
  const contact = findSection(structure, 'contact');

  assert.ok(!contact.text.includes('Send us a message'));
  assert.ok(!contact.text.includes('Your name'));
  assert.ok(!contact.text.includes('Submit'));
  assert.ok(!contact.headings.some((h) => h.text === 'Send us a message'));
  assert.ok(!contact.links.some((l) => l.url === 'https://example.com/privacy'));
  assert.ok(!contact.images.some((img) => img.url === 'https://example.com/form-icon.png'));
});

test('extractPageStructure produces no section at all for a bare <form> outside any landmark', () => {
  const structure = extractPageStructure(html, pageUrl);
  const uncategorized = findSections(structure, 'uncategorized');

  assert.equal(uncategorized.length, 3);
  assert.ok(!uncategorized.some((s) => s.text.includes('Subscribe') || s.text.includes('Email')));
});

test('extractPageStructure claims a role="list" card grid as its own "cards" section, even with no recognizable classes', () => {
  const structure = extractPageStructure(html, pageUrl);
  const cards = findSection(structure, 'cards');
  assert.ok(cards);
  assert.equal(cards.cards.length, 2);
});

test('extractPageStructure resolves a Wix <wow-image>\'s real (full-resolution) url from its data-image-info JSON', () => {
  const structure = extractPageStructure(html, pageUrl);
  const cards = findSection(structure, 'cards');
  const sparrow = cards.cards.find((c) => c.text === 'Sparrow Beginnings');
  assert.ok(sparrow);
  assert.equal(sparrow.image, 'https://static.wixstatic.com/media/89d44b_abc~mv2_d_5760_3840.jpg');
  assert.equal(sparrow.url, 'https://example.com/sparrow-beginnings');
});

test('extractPageStructure falls back to a plain <img> for a card with no <wow-image>, and to a null url when the card has no link', () => {
  const structure = extractPageStructure(html, pageUrl);
  const cards = findSection(structure, 'cards');
  const legacy = cards.cards.find((c) => c.text === 'The Legacy');
  assert.ok(legacy);
  assert.equal(legacy.image, 'https://example.com/legacy.jpg');
  assert.equal(legacy.url, null);
});

test('extractPageStructure puts the stray body-level image in its own uncategorized section', () => {
  const structure = extractPageStructure(html, pageUrl);
  const uncategorized = findSections(structure, 'uncategorized').find((s) =>
    s.images.some((img) => img.url === 'https://example.com/stray.jpg'),
  );
  assert.ok(uncategorized);
  assert.equal(uncategorized.label, 'uncategorized');
  assert.equal(uncategorized.selectorPath, 'body > img');
  assert.equal(uncategorized.text, '');
});

test('extractPageStructure claims a nested <section> inside a wrapping <main> instead of letting <main> swallow it', () => {
  const structure = extractPageStructure(html, pageUrl);
  assert.equal(structure.sections.some((s) => s.type === 'main'), false);

  const blockA = findSection(structure, 'section');
  assert.ok(blockA);
  assert.equal(blockA.selectorPath, 'body > main > section:nth-of-type(1)');
  assert.equal(blockA.label, 'Special Offer');
  assert.equal(blockA.text, 'Special Offer Save today.');
});

test('extractPageStructure dissolves a wrapper section that itself contains an already-claimed landmark, instead of double-counting it', () => {
  const structure = extractPageStructure(html, pageUrl);

  const team = findSection(structure, 'team');
  assert.ok(team);
  assert.equal(team.label, 'Meet the Team');
  assert.ok(team.images.some((img) => img.url === 'https://example.com/team-1.jpg'));

  // section.block-b (wrapping the team div) is never claimed in its own right, so its own
  // stray paragraph — not part of any claimed landmark — falls through to its own uncategorized
  // section, scoped to just that paragraph rather than merged with unrelated stray content.
  const uncategorizedSections = findSections(structure, 'uncategorized');
  const strayParagraph = uncategorizedSections.find((s) => s.text.includes('See our latest work below.'));
  assert.ok(strayParagraph);
  assert.equal(strayParagraph.selectorPath, 'body > main > section:nth-of-type(2) > p');

  // it's a distinct section from the unrelated stray image elsewhere in the body...
  const strayImage = uncategorizedSections.find((s) => s.images.some((img) => img.url === 'https://example.com/stray.jpg'));
  assert.ok(strayImage);
  assert.notEqual(strayParagraph.order, strayImage.order);
  assert.ok(!strayParagraph.text.includes('stray'));

  // ...and it isn't duplicated onto the team section itself.
  assert.ok(!team.text.includes('See our latest work below.'));
});
