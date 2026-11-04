import test from 'node:test';
import assert from 'node:assert/strict';
import { pickCharset } from '../src/utils/decodeHtml.js';

const bytes = (text) => new TextEncoder().encode(text);

test('pickCharset prefers the Content-Type charset', () => {
  assert.equal(pickCharset('text/html; charset=ISO-8859-1', bytes('<meta charset="utf-8">')), 'ISO-8859-1');
});

test('pickCharset sniffs <meta charset> and http-equiv when the header has none', () => {
  assert.equal(pickCharset('text/html', bytes('<meta charset="windows-1252">')), 'windows-1252');
  assert.equal(
    pickCharset(null, bytes('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">')),
    'iso-8859-1',
  );
});

test('pickCharset falls back to utf-8 for missing or unknown charsets', () => {
  assert.equal(pickCharset('text/html', bytes('<p>hi</p>')), 'utf-8');
  assert.equal(pickCharset('text/html; charset=bogus', bytes('<p>hi</p>')), 'utf-8');
});

test('pickCharset ignores a UTF-8 declaration when the bytes are really Latin-1', () => {
  const latin1 = Uint8Array.from([...bytes('<meta charset="iso-8859-1">jard'), 0xed, ...bytes('n')]);
  assert.equal(pickCharset('text/html; charset=UTF-8', latin1), 'iso-8859-1');
  assert.equal(pickCharset('text/html; charset=UTF-8', Uint8Array.from([0x6a, 0xed])), 'windows-1252');
});
