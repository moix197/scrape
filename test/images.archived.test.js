import test from 'node:test';
import assert from 'node:assert/strict';
import { rawSnapshotUrl } from '../src/images/archived.js';

test('rawSnapshotUrl asks the Wayback Machine for the archived bytes, not its toolbar page', () => {
  assert.equal(
    rawSnapshotUrl('http://web.archive.org/web/20240721051840/http://aguapelodge.com/images/logo.png'),
    'http://web.archive.org/web/20240721051840if_/http://aguapelodge.com/images/logo.png',
  );
});
