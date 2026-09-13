import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractInlineStyleBlocks,
  extractColorRules,
  scoreSiteColors,
} from '../src/extract/colors.js';

test('extractInlineStyleBlocks concatenates text from multiple <style> tags', () => {
  const html = `<html><head>
    <style>.a { color: #fff; }</style>
    <style>.b { color: #000; }</style>
  </head><body></body></html>`;
  const text = extractInlineStyleBlocks(html);
  assert.ok(text.includes('.a { color: #fff; }'));
  assert.ok(text.includes('.b { color: #000; }'));
});

test('extractInlineStyleBlocks returns empty string when no <style> tags', () => {
  const html = '<html><head></head><body><p>hi</p></body></html>';
  assert.equal(extractInlineStyleBlocks(html), '');
});

test('extractColorRules normalizes 3-digit and 6-digit hex, case-insensitively', () => {
  const css = '.a { color: #FFF; } .b { color: #aAbBcC; }';
  const rules = extractColorRules(css);
  assert.deepEqual(
    rules.map((r) => r.hex),
    ['#ffffff', '#aabbcc'],
  );
});

test('extractColorRules normalizes rgb() and rgba() with sufficient alpha', () => {
  const css = '.a { background-color: rgb(255, 0, 0); } .b { color: rgba(0, 128, 0, 0.5); }';
  const rules = extractColorRules(css);
  assert.deepEqual(
    rules.map((r) => r.hex),
    ['#ff0000', '#008000'],
  );
});

test('extractColorRules skips rgba() with low alpha', () => {
  const css = '.a { background-color: rgba(255, 0, 0, 0.1); }';
  assert.deepEqual(extractColorRules(css), []);
});

test('extractColorRules skips background shorthand containing url()', () => {
  const css = '.hero { background: url("bg.jpg") #ff0000 no-repeat; }';
  assert.deepEqual(extractColorRules(css), []);
});

test('extractColorRules skips non-hex/rgb color values', () => {
  const css = '.a { color: red; } .b { color: hsl(0, 100%, 50%); }';
  assert.deepEqual(extractColorRules(css), []);
});

test('extractColorRules finds nested rules inside @media blocks', () => {
  const css = '@media (min-width: 768px) { .btn { background-color: #ff0000; } }';
  const rules = extractColorRules(css);
  assert.deepEqual(rules, [{ selector: '.btn', hex: '#ff0000' }]);
});

test('scoreSiteColors weights button/.btn/.cta selectors higher than generic selectors', () => {
  const colorRules = [
    { selector: '.btn', hex: '#ff0000' },
    { selector: 'div', hex: '#00ff00' },
  ];
  const scored = scoreSiteColors(colorRules);
  const btnColor = scored.find((c) => c.hex === '#ff0000');
  const divColor = scored.find((c) => c.hex === '#00ff00');
  assert.ok(btnColor.score > divColor.score);
});

test('scoreSiteColors sorts descending and truncates to limit', () => {
  const colorRules = [
    { selector: '.btn', hex: '#111111' },
    { selector: '.btn', hex: '#111111' },
    { selector: 'nav', hex: '#222222' },
    { selector: 'footer', hex: '#333333' },
    { selector: 'div', hex: '#444444' },
  ];
  const scored = scoreSiteColors(colorRules, 2);
  assert.equal(scored.length, 2);
  assert.deepEqual(
    scored.map((c) => c.hex),
    ['#111111', '#222222'],
  );
  assert.ok(scored[0].score >= scored[1].score);
});
