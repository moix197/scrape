import * as cheerio from 'cheerio';

export function extractVisibleText(html) {
  const $ = cheerio.load(html);
  $('script, style, noscript, template').remove();
  const container = $('body').length ? $('body') : $.root();
  return container.text().replace(/\s+/g, ' ').trim();
}

export function extractPageMeta(html) {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim();
  const description = $('meta[name="description"]').attr('content')?.trim() || '';
  return { title, description };
}
