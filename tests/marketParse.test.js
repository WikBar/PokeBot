const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseCatalog } = require('../src/logic/marketParse');

const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'market-catalog.html'), 'utf8');

test('parseCatalog: 103 przedmioty z zakladkami (strona zapisana przez bota 02.10)', () => {
  const items = parseCatalog(html);
  assert.equal(items.length, 103);
  const count = (tab) => items.filter((i) => i.tab === tab).length;
  assert.equal(count('Jagody'), 10);
  assert.equal(count('Pokeballe'), 4);
  assert.equal(count('Ewolucyjne'), 38);
});

test('parseCatalog: kod, nazwa z <br>, numer zakladki, href bez &amp;', () => {
  const items = parseCatalog(html);
  const ultra = items.find((i) => i.code === 'ultraballe');
  assert.deepEqual(
    { name: ultra.name, tab: ultra.tab, tabIndex: ultra.tabIndex },
    { name: 'Ultraballe', tab: 'Pokeballe', tabIndex: 1 },
  );
  assert.match(ultra.href, /^targ_prz\.php\?szukaj&przedmiot=ultraballe&zakladka=1/);
  assert.equal(items.find((i) => i.code === 'rawst_berry').name, 'Rawst Jagody');
  assert.equal(items.find((i) => i.code === 'repel3').name, 'Max Repel');
});

test('parseCatalog: brak katalogu - pusta lista', () => {
  assert.deepEqual(parseCatalog('<html><body>Logowanie</body></html>'), []);
});
