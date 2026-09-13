import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowed, parseRobotsText } from '../src/utils/robots.js';

test('isAllowed allows paths with no matching rule', () => {
  const rules = { disallow: ['/admin'], allow: [] };
  assert.equal(isAllowed(rules, '/public/page'), true);
});

test('isAllowed disallows paths matching a disallow prefix', () => {
  const rules = { disallow: ['/admin'], allow: [] };
  assert.equal(isAllowed(rules, '/admin/settings'), false);
});

test('isAllowed lets the longest matching rule win (allow overrides shorter disallow)', () => {
  const rules = { disallow: ['/admin'], allow: ['/admin/public'] };
  assert.equal(isAllowed(rules, '/admin/public/page'), true);
  assert.equal(isAllowed(rules, '/admin/private'), false);
});

test('isAllowed lets the longest matching rule win (disallow overrides shorter allow)', () => {
  const rules = { disallow: ['/admin/secret'], allow: ['/admin'] };
  assert.equal(isAllowed(rules, '/admin/secret/page'), false);
  assert.equal(isAllowed(rules, '/admin/other'), true);
});

test('isAllowed accepts a full URL and checks its pathname', () => {
  const rules = { disallow: ['/admin'], allow: [] };
  assert.equal(isAllowed(rules, 'https://example.com/admin/x'), false);
  assert.equal(isAllowed(rules, 'https://example.com/public'), true);
});

test('parseRobotsText picks the block matching a specific user agent', () => {
  const text = [
    'User-agent: Googlebot',
    'Disallow: /google-only',
    '',
    'User-agent: *',
    'Disallow: /all',
  ].join('\n');

  const rules = parseRobotsText(text, 'Googlebot');
  assert.deepEqual(rules, { disallow: ['/google-only'], allow: [] });
});

test('parseRobotsText falls back to the wildcard block', () => {
  const text = ['User-agent: Googlebot', 'Disallow: /google-only', '', 'User-agent: *', 'Disallow: /all'].join(
    '\n'
  );

  const rules = parseRobotsText(text, 'SomeOtherBot');
  assert.deepEqual(rules, { disallow: ['/all'], allow: [] });
});

test('parseRobotsText groups multiple user-agent lines sharing one rule set', () => {
  const text = ['User-agent: bot-a', 'User-agent: bot-b', 'Disallow: /shared'].join('\n');

  assert.deepEqual(parseRobotsText(text, 'bot-a'), { disallow: ['/shared'], allow: [] });
  assert.deepEqual(parseRobotsText(text, 'bot-b'), { disallow: ['/shared'], allow: [] });
});
