const test = require('node:test');
const assert = require('node:assert/strict');
const { categoryOf, offerRecords, ratioStats, findPokemonDeals } = require('../src/logic/pokemonHistory');
const { renderPokemonChartsPage } = require('../src/logic/marketChart');

const offer = (o) => ({ id: 1, level: 70, trainings: 0, value: 300000, yenPrice: null, meritPrice: null, shiny: false, ...o });

test('categoryOf: zwykly / trenowany (od 6 treningow) / shiny', () => {
  assert.equal(categoryOf({ tr: 5 }), 'zwykly');
  assert.equal(categoryOf({ trainings: 6 }), 'trenowany');
  assert.equal(categoryOf({ tr: 84, sh: true }), 'shiny');
});

test('offerRecords: kompaktowy wpis historii', () => {
  assert.deepEqual(offerRecords('Prinplup', [offer({ id: 7, trainings: 84, yenPrice: 500000, meritPrice: 19 })], 5), [
    { ts: 5, sp: 'Prinplup', id: 7, lvl: 70, tr: 84, val: 300000, yen: 500000, pz: 19, sh: false },
  ]);
});

test('ratioStats: oferta liczona raz (najnowszy wpis), osobno gatunek i caly targ', () => {
  const h = [
    { ts: 1, sp: 'A', id: 1, tr: 0, val: 100, yen: 200, sh: false },
    { ts: 2, sp: 'A', id: 1, tr: 0, val: 100, yen: 150, sh: false },   // ta sama oferta, nowsza cena
    { ts: 2, sp: 'A', id: 2, tr: 0, val: 100, yen: 250, sh: false },
    { ts: 2, sp: 'B', id: 3, tr: 0, val: 100, yen: 300, sh: false },
    { ts: 2, sp: 'B', id: 4, tr: 0, val: 100, yen: null, pz: 5, sh: false },   // tylko PZ - pomijana
  ];
  const s = ratioStats(h);
  assert.deepEqual(s.get('A|zwykly'), { median: 2, n: 2 });
  assert.deepEqual(s.get('*|zwykly'), { median: 2.5, n: 3 });
});

test('findPokemonDeals: ponizej skupu zawsze, ponizej typowej przy wystarczajacej historii', () => {
  // Historia: 5 trenowanych Prinplupow po ~2x wartosci.
  const history = [1, 2, 3, 4, 5].map((i) => ({ ts: i, sp: 'Prinplup', id: 100 + i, tr: 80, val: 200000, yen: 400000 + i * 1000, sh: false }));
  const current = {
    Prinplup: [
      offer({ id: 1, trainings: 80, value: 200000, yenPrice: 250000 }),   // 0.62 typowej
      offer({ id: 2, trainings: 80, value: 200000, yenPrice: 390000 }),   // typowa
      offer({ id: 3, value: 300000, yenPrice: 250000 }),                  // ponizej skupu
      offer({ id: 4, value: 300000, meritPrice: 10 }),                    // tylko PZ
    ],
    Ledyba: [offer({ id: 5, yenPrice: 350000 })],                          // brak historii
  };
  const deals = findPokemonDeals(current, history);
  assert.deepEqual(deals.map((d) => [d.offer.id, d.kind, d.basis]), [
    [1, 'ponizej-typowej', 'gatunek'],
    [3, 'ponizej-skupu', 'skup'],
  ]);
  assert.equal(deals[0].expected, 403000);   // 200 000 × mediana(2.005..2.025)
  assert.equal(deals[1].expected, 300000);
});

test('findPokemonDeals: cienka historia gatunku - brak okazji (bez porownania z calym targiem)', () => {
  // 20 ofert innych gatunkow po 2x wartosci - nie moga wyznaczac ceny nowego gatunku.
  const history = Array.from({ length: 20 }, (_, i) => ({ ts: 1, sp: `X${i}`, id: i, tr: 0, val: 100000, yen: 200000, sh: false }));
  assert.deepEqual(findPokemonDeals({ Nowy: [offer({ id: 99, value: 100000, yenPrice: 120000 })] }, history), []);
});

test('renderPokemonChartsPage: samodzielny HTML z danymi, bez wstrzykniecia skryptu', () => {
  const html = renderPokemonChartsPage({
    records: [{ ts: 1, sp: '</script><script>alert(1)</script>', id: 1, lvl: 5, tr: 0, val: 10, yen: 20, pz: null, sh: false }],
    deals: [],
  });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Targ pokemonów - historia cen<\/title>/);
  assert.doesNotMatch(html, /<\/script><script>alert/);
  assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/);   // zadnych zewnetrznych zasobow
});
