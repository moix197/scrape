import test from 'node:test';
import assert from 'node:assert/strict';
import { isAgeGate, extractScriptNavigations } from '../src/crawler.js';

// suter.com.ar's gate: a birth-date picker, SI runs direccionar(), NO links sin-acceso.php.
const GATE = `<html><head><script>
function initAge(){ //document.location.href='index_old.php';
}
function direccionar() {
  document.cookie = 'esmayor=si;path=/';
  if (window.location.hash!='') { window.location.replace(window.location.hash.replace('#','')); }
  else { window.location.replace('index_es.php'); }
}</script></head><body>
<select id="age-year"><option>1910</option><option>1911</option><option>1912</option></select>
<a href="#">¿Sos Mayor de 18 Años?</a><a onclick="direccionar();">SI</a><a href="sin-acceso.php">NO</a>
<p>BEBER CON MODERACIÓN. PROHIBIDA SU VENTA A MENORES DE 18 AÑOS.</p></body></html>`;

test('an age-asking short page is a gate; a content page with the legal footer is not', () => {
  assert.equal(isAgeGate(GATE), true);
  assert.equal(isAgeGate('<p>Lo sentimos, para acceder a nuestro sitio web es necesario ser mayor de 18 años</p>'), true);
  const page = `<h1>Nuestros vinos</h1><p>${'Malbec de San Rafael, cosecha tras cosecha. '.repeat(20)}</p><p>Prohibida su venta a menores de 18 años.</p>`;
  assert.equal(isAgeGate(page), false);
});

test("the gate's script targets are crawled, commented-out ones are not", () => {
  assert.deepEqual(extractScriptNavigations(GATE, 'https://suter.com.ar/', 'https://suter.com.ar'), ['https://suter.com.ar/index_es.php']);
});
