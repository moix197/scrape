import test from 'node:test';
import assert from 'node:assert/strict';
import { scriptFilledListIds, viewUrl, withLinkedList } from '../src/render/scriptListViews.js';

// neris.com.ar's productos.php: the product menu ships as a commented-out list that js/productos.js fills from an XML feed.
const PAGE = `<html><head><script src="js/productos.js"></script></head><body>
<ul id="botoneraPrincipal"><li><a href="empresa.php">Empresa</a></li></ul>
<ul id="navProductos"><!-- <li><a href="productos/rosca_metrica_m/index.php">Rosca Métrica [M]</a></li> --></ul>
<div id="seccionData"></div></body></html>`;

test('an empty list on a page that runs scripts is a script-filled candidate; a filled list or a script-less page is not', () => {
  assert.deepEqual(scriptFilledListIds(PAGE), ['navProductos']);
  assert.deepEqual(scriptFilledListIds(PAGE.replace(/<script[^>]*><\/script>/, '')), []);
});

test("a view's URL is the page with ?vista= the item's label slug", () => {
  assert.equal(viewUrl('https://www.neris.com.ar/productos.php', 'Rosca Métrica [M]'), 'https://www.neris.com.ar/productos.php?vista=rosca-metrica-m');
});

test("the rendered list replaces the empty one, each item linking its view's URL", () => {
  const rendered = '<ul id="navProductos"><li><a rel="item1" title="Rosca Métrica [M]"><p>Rosca Métrica [M]</p></a></li><li><a rel="item2"><p>Rosca Americana [UN]</p></a></li></ul>';
  const urls = ['https://x/productos.php?vista=rosca-metrica-m', 'https://x/productos.php?vista=rosca-americana-un'];
  const html = withLinkedList(PAGE, 'navProductos', rendered, urls);
  assert.match(html, /<a rel="item1" title="Rosca Métrica \[M\]" href="https:\/\/x\/productos\.php\?vista=rosca-metrica-m">/);
  assert.match(html, /href="https:\/\/x\/productos\.php\?vista=rosca-americana-un"/);
  assert.doesNotMatch(html, /<!--/);
});
