import test from 'node:test';
import assert from 'node:assert/strict';
import Jimp from 'jimp';
import { extractDominantColors } from '../src/images/palette.js';

test('extractDominantColors returns dominant color first for a mostly-red image', async () => {
  const image = new Jimp(20, 20, 0xff0000ff);
  image.setPixelColor(0x0000ffff, 0, 0);
  const buffer = await image.getBufferAsync(Jimp.MIME_PNG);

  const colors = await extractDominantColors(buffer, { count: 3 });

  assert.ok(colors.length >= 1);
  assert.match(colors[0], /^#[0-9a-f]{6}$/);
  assert.equal(colors[0], '#ff0000');
});

test('extractDominantColors returns empty array for invalid buffer', async () => {
  const colors = await extractDominantColors(Buffer.from('not an image'));
  assert.deepEqual(colors, []);
});
