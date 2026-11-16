// Old catalogues fill an empty list from script (jQuery reading an XML feed: neris.com.ar's productos.php) and swap the
// page's content when an item is clicked. The items have no href, so neither the crawl nor a plain render sees more than
// the default view. Such a page is rendered and each item clicked; every view is kept as a page of its own at
// <page>?vista=<item-slug>, and the list's items link those URLs in the base page and in every view, so the views read
// as the page's own menu.
import * as cheerio from 'cheerio';
import { normalizeUrl } from '../utils/urls.js';

const VIEW_PARAM = 'vista';
const MIN_ITEMS = 3;
const VIEW_SETTLE_MS = 700;

/** Ids of the lists a page ships empty (no <li>, comments aside) while it runs scripts: script-filled candidates. */
export function scriptFilledListIds(html) {
  const $ = cheerio.load(html);
  if ($('script').length === 0) return [];
  return $('body ul[id], body ol[id]')
    .filter((_, el) => $(el).children('li').length === 0)
    .map((_, el) => $(el).attr('id'))
    .get();
}

function slugify(label) {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The URL a list item's view is kept at: the page with ?vista=<slug of the item's label>. */
export function viewUrl(pageUrl, label) {
  const url = new URL(pageUrl);
  url.searchParams.set(VIEW_PARAM, slugify(label));
  return normalizeUrl(url.href);
}

/** `html` with the list `listHtml` (as rendered) in place of the list `id`, its items linking `urls` in order. */
export function withLinkedList(html, id, listHtml, urls) {
  const $ = cheerio.load(html);
  const list = $(listHtml);
  list.children('li').each((i, li) => {
    if (urls[i]) $(li).find('a').first().attr('href', urls[i]);
  });
  $(`[id="${id}"]`).replaceWith(list);
  return $.html();
}

// In the page: the first of the candidate lists holding MIN_ITEMS+ items whose link goes nowhere (no href, "#",
// javascript:), with each item's label.
function findClickableList({ ids, min }) {
  const goesNowhere = (a) => {
    const href = (a.getAttribute('href') || '').trim();
    return !href || href === '#' || /^javascript:/i.test(href);
  };
  for (const id of ids) {
    const list = document.getElementById(id);
    const items = list ? [...list.children].filter((el) => el.tagName === 'LI') : [];
    const anchors = items.map((li) => li.querySelector('a'));
    if (items.length < min || anchors.some((a) => !a || !goesNowhere(a))) continue;
    const labels = anchors.map((a) => (a.textContent || a.getAttribute('title') || '').replace(/\s+/g, ' ').trim());
    if (labels.some((l) => !l)) continue;
    return { id, labels, listHtml: list.outerHTML };
  }
  return null;
}

async function clickView(page, id, index) {
  await page.locator(`[id="${id}"] > li`).nth(index).locator('a').first().click();
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(VIEW_SETTLE_MS);
  return page.content();
}

/**
 * Renders `url`, clicks through its script-filled list and returns `{ base, views: [{ url, label, html }] }`: the plain
 * page with the list filled and linked, and one page per item view (views rendering the same html as an earlier one are
 * dropped). Null when no candidate list fills with clickable items, or Playwright is unavailable.
 */
export async function renderListViews(url, plainHtml, listIds, session) {
  return session.withPage(url, null, async (page) => {
    const list = await page.evaluate(findClickableList, { ids: listIds, min: MIN_ITEMS });
    if (!list) return null;
    const urls = list.labels.map((label) => viewUrl(url, label));
    const views = [];
    const seen = new Set();
    for (const [i, label] of list.labels.entries()) {
      const html = await clickView(page, list.id, i);
      if (seen.has(html)) continue;
      seen.add(html);
      views.push({ url: urls[i], label, html: withLinkedList(html, list.id, list.listHtml, urls) });
    }
    return { base: withLinkedList(plainHtml, list.id, list.listHtml, urls), views };
  });
}
