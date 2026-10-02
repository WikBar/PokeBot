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

const { parseItemOffers } = require('../src/logic/marketParse');
const offersHtml = fs.readFileSync(path.join(__dirname, 'fixtures', 'market-offers-rawst.html'), 'utf8');

test('parseItemOffers: oferty Rawst (prawdziwa strona, sprzedawcy zanonimizowani)', () => {
  const offers = parseItemOffers(offersHtml);
  assert.equal(offers.length, 16);
  assert.deepEqual(offers[0], {
    id: 3961166, item: 'rawst_berry', quantity: 3569, unitPrice: 30000, meritPrice: null, seller: 'Gracz1',
  });
  // Oferty tylko za zaslugi (§) - bez ceny w Yenach.
  const merit = offers.filter((o) => o.unitPrice === null);
  assert.equal(merit.length, 6);
  assert.ok(merit.every((o) => o.meritPrice > 0));
  assert.equal(offers.find((o) => o.unitPrice === 100000).quantity, 43);
});

test('parseItemOffers: strona bez ofert - null, pusta lista ofert - []', () => {
  assert.equal(parseItemOffers('<html>Logowanie</html>'), null);
  assert.deepEqual(parseItemOffers('<h2>Oferty</h2><div id="targ_prz_oferty"></div>'), []);
});
