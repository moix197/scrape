import Jimp from 'jimp';

const QUANTIZE_STEP = 32;
const MIN_ALPHA = 10;

function quantizeChannel(value) {
  return Math.round(value / QUANTIZE_STEP) * QUANTIZE_STEP;
}

function toHexColor(r, g, b) {
  const toHex = (n) => Math.min(255, n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function tallyPixelColors(image) {
  const { data } = image.bitmap;
  const counts = new Map();

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha !== undefined && alpha < MIN_ALPHA) continue;

    const hex = toHexColor(
      quantizeChannel(data[i]),
      quantizeChannel(data[i + 1]),
      quantizeChannel(data[i + 2])
    );
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }

  return counts;
}

export async function extractDominantColors(buffer, { count = 5 } = {}) {
  try {
    const image = await Jimp.read(buffer);
    image.resize(40, Jimp.AUTO);

    const counts = tallyPixelColors(image);

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([hex]) => hex);
  } catch {
    return [];
  }
}
