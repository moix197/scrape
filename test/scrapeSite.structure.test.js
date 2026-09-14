import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStructureOutput } from '../src/scrapeSite.js';

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
    contacts: [],
    listItems: [],
    form: null,
    ...overrides,
  };
}

function fakePage(url, sections) {
  return {
    url,
    meta: null,
    structure: { logo: null, socialLinks: [], sections },
  };
}

test('buildStructureOutput hoists a site-wide, deduped contacts list (first crawl-order occurrence wins) and carries contacts/listItems/form onto the site-wide footer', () => {
  const sharedContact = { type: 'tel', value: '+1-555-0100', label: 'Call us' };
  const footerSection = fakeSection({
    type: 'footer',
    order: 1,
    text: 'Footer text',
    contacts: [sharedContact],
    listItems: [{ ordered: false, items: ['Item A'] }],
    form: { fields: [{ label: 'Name', type: 'text', required: true }] },
  });
  const page1 = fakePage('https://example.com/', [
    fakeSection({ type: 'hero', order: 0, text: 'Hero text' }),
    footerSection,
  ]);
  const page2 = fakePage('https://example.com/about', [
    fakeSection({
      type: 'hero',
      order: 0,
      text: 'About hero',
      contacts: [sharedContact, { type: 'mailto', value: 'hi@example.com', label: 'Email' }],
    }),
  ]);

  const result = buildStructureOutput([page1, page2]);

  assert.deepEqual(result.contacts, [
    { type: 'tel', value: '+1-555-0100', label: 'Call us', where: { page: 'https://example.com/', sectionOrder: 1 } },
    { type: 'mailto', value: 'hi@example.com', label: 'Email', where: { page: 'https://example.com/about', sectionOrder: 0 } },
  ]);

  assert.deepEqual(result.footer.contacts, [sharedContact]);
  assert.deepEqual(result.footer.listItems, [{ ordered: false, items: ['Item A'] }]);
  assert.deepEqual(result.footer.form, { fields: [{ label: 'Name', type: 'text', required: true }] });
});

test('buildStructureOutput warns about inconsistent footers when they differ only in contacts', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const page1 = fakePage('https://example.com/', [
    fakeSection({ type: 'footer', order: 0, text: 'Footer', contacts: [{ type: 'tel', value: '+15550100', label: 'Call' }] }),
  ]);
  const page2 = fakePage('https://example.com/about', [
    fakeSection({ type: 'footer', order: 0, text: 'Footer', contacts: [] }),
  ]);

  buildStructureOutput([page1, page2]);

  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments[0], /inconsistent footer/);
});
