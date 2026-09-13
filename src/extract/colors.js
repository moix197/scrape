import * as cheerio from 'cheerio';

const COLOR_PROPERTIES = new Set(['background-color', 'background', 'color', 'border-color', 'fill']);

const SELECTOR_WEIGHTS = [
  [/\bbutton\b|\.btn\b|\.cta\b/i, 5],
  [/\bnav\b|\bheader\b/i, 4],
  [/(^|[\s,])a(:|\.|\s|,|$)|:link|:visited/i, 4],
  [/\bbody\b|:root/i, 3],
  [/\bfooter\b/i, 2],
];

export function extractInlineStyleBlocks(html) {
  const $ = cheerio.load(html);
  return $('style')
    .map((_, el) => $(el).text())
    .get()
    .join('\n');
}

function toHex2(n) {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
}

function normalizeHexLiteral(value) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1].toLowerCase();
  if (hex.length === 3) {
    return `#${[...hex].map((c) => c + c).join('')}`;
  }
  return `#${hex}`;
}

function normalizeRgbLiteral(value) {
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value.trim());
  if (!match) return null;
  const [, r, g, b, alpha] = match;
  if (alpha !== undefined && Number(alpha) < 0.15) return null;
  return `#${toHex2(Number(r))}${toHex2(Number(g))}${toHex2(Number(b))}`;
}

// Only hex and rgb()/rgba() are handled here — named colors, hsl(), currentColor,
// and gradients are intentionally out of scope for this pragmatic regex-based scan.
function normalizeColorValue(value) {
  return normalizeHexLiteral(value) ?? normalizeRgbLiteral(value);
}

function isSolidColorProperty(property, value) {
  if (!COLOR_PROPERTIES.has(property)) return false;
  if (property === 'background' && (/url\(/i.test(value) || /gradient/i.test(value))) return false;
  return true;
}

function extractRuleColorEntries(selector, declarationsText) {
  const entries = [];
  const declRegex = /([\w-]+)\s*:\s*([^;]+)/g;
  let declMatch;
  while ((declMatch = declRegex.exec(declarationsText))) {
    const [, property, rawValue] = declMatch;
    if (!isSolidColorProperty(property.toLowerCase(), rawValue)) continue;
    const hex = normalizeColorValue(rawValue.trim());
    if (!hex) continue;
    entries.push({ selector: selector.trim(), hex });
  }
  return entries;
}

export function extractColorRules(cssText) {
  const entries = [];
  const ruleRegex = /([^{}]+)\{([^{}]*)\}/g;
  let ruleMatch;
  while ((ruleMatch = ruleRegex.exec(cssText))) {
    const [, selector, declarationsText] = ruleMatch;
    entries.push(...extractRuleColorEntries(selector, declarationsText));
  }
  return entries;
}

function weightForSelector(selector) {
  const match = SELECTOR_WEIGHTS.find(([regex]) => regex.test(selector));
  return match ? match[1] : 1;
}

export function scoreSiteColors(colorRules, limit = 8) {
  const scores = new Map();
  for (const { selector, hex } of colorRules) {
    scores.set(hex, (scores.get(hex) || 0) + weightForSelector(selector));
  }
  return [...scores.entries()]
    .map(([hex, score]) => ({ hex, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
