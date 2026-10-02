const test = require('node:test');
const assert = require('node:assert/strict');
const {
  summarizeScan, scanRecords, priceStats, findDeals, suggestSellPrice, planPurchases, buildMarketSummary,
} = require('../src/logic/market');
const { formatMarket } = require('../src/logic/telegramCommands');

const NOW = Date.parse('2026-10-02T12:00:00Z');
const H = 3600 * 1000;

// Wpis historii z jednego odczytu (jak scanRecords): najnizsza cena `low`.
const rec = (hoursAgo, low, item = 'ultraballe') =>
  ({ ts: NOW - hoursAgo * H, item, low, median: low + 40, n: 4, supply: 40 });
// 8 odczytow z typowa najnizsza cena ~100 (w tym 2 sprzed ponad doby).
const history = [
  rec(40, 100), rec(30, 98), rec(20, 102), rec(10, 100),
  rec(6, 101), rec(4, 99), rec(2, 100), rec(1, 100),
];

test('summarizeScan / scanRecords: najnizsza, mediana, podaz; bez ofert w ¥ - brak wpisu', () => {
  const offers = [
    { unitPrice: 120, quantity: 2 }, { unitPrice: 100, quantity: 5 },
    { unitPrice: 300, quantity: 1 }, { unitPrice: null, meritPrice: 3, quantity: 9 },
  ];
  assert.deepEqual(summarizeScan(offers), { low: 100, median: 120, n: 3, supply: 8 });
  assert.equal(summarizeScan([{ unitPrice: null, meritPrice: 1 }]), null);
  assert.deepEqual(
    scanRecords({ Ultraballe: offers, tylko_zaslugi: [{ unitPrice: null }] }, 5),
    [{ ts: 5, item: 'ultraballe', low: 100, median: 120, n: 3, supply: 8 }],
  );
});

test('priceStats: typowa najnizsza cena i mediana z kolejnych odczytow', () => {
  const s = priceStats(history, { now: NOW }).get('ultraballe');
  assert.equal(s.scans, 8);
  assert.equal(s.typicalLow, 100);
  assert.equal(s.median, 140);
});

test('priceStats: trend tylko przy historii dluzszej niz doba; stare wpisy pomijane', () => {
  // ostatnia doba: mediana najnizszych 100; wczesniej (100, 98): 99 -> 1.01
  assert.equal(priceStats(history, { now: NOW }).get('ultraballe').trend, 1.01);
  assert.equal(priceStats([rec(1, 100)], { now: NOW }).get('ultraballe').trend, null);
  assert.equal(priceStats([rec(24 * 8, 100)], { now: NOW }).size, 0);
});

test('findDeals: wzgledem typowej najnizszej ceny, dopiero po 6 odczytach (regresja: falszywe okazje z 1 odczytu)', () => {
  const offers = [
    { id: 900, item: 'ultraballe', unitPrice: 80, quantity: 5 },
    { id: 901, item: 'ultraballe', unitPrice: 95, quantity: 5 },
    { id: 902, item: 'ultraballe', unitPrice: null, meritPrice: 3, quantity: 5 },
  ];
  const deals = findDeals(offers, priceStats(history, { now: NOW }));
  assert.deepEqual(deals.map((d) => [d.offer.id, d.reference, d.ratio]), [[900, 100, 0.8]]);
  assert.deepEqual(findDeals(offers, priceStats([rec(1, 100)], { now: NOW })), []);
  assert.deepEqual(findDeals(offers, priceStats(history, { now: NOW }), { watchlist: ['rawst_berry'] }), []);
});

test('suggestSellPrice: pod najtansza oferta, nie ponizej 90% typowej ceny', () => {
  const s = priceStats(history, { now: NOW });
  assert.equal(suggestSellPrice('ultraballe', [{ item: 'ultraballe', unitPrice: 98 }], s).price, 97);
  assert.equal(suggestSellPrice('ultraballe', [{ item: 'ultraballe', unitPrice: 50 }], s).price, 90);
  assert.equal(suggestSellPrice('ultraballe', [], s).price, 100);
  assert.equal(suggestSellPrice('nieznane', [], s), null);
  // Przy jednym odczycie bez dolnej granicy - po prostu pod najtansza.
  const one = priceStats([rec(1, 65)], { now: NOW });
  assert.equal(suggestSellPrice('ultraballe', [{ item: 'ultraballe', unitPrice: 65 }], one).price, 64);
});

test('planPurchases: budzet, rezerwa, limit sztuk i posiadane', () => {
  const deals = [
    { offer: { id: 1, item: 'Ultraballe', unitPrice: 50, quantity: 40 }, ratio: 0.5 },
    { offer: { id: 2, item: 'Ultraballe', unitPrice: 60, quantity: 40 }, ratio: 0.6 },
    { offer: { id: 3, item: 'Masterballe', unitPrice: 10, quantity: 1 }, ratio: 0.1 },
  ];
  const plan = planPurchases(deals, {
    budget: 3000, balance: 10000, reserve: 0,
    maxPerItem: { Ultraballe: 100 }, owned: { Ultraballe: 50 },
  });
  // potrzeba 50 szt.: 40 z oferty 1 (2000), 10 z oferty 2 (600); Masterballe nie na liscie
  assert.deepEqual(plan.map((p) => [p.offer.id, p.quantity, p.cost]), [[1, 40, 2000], [2, 10, 600]]);

  const tight = planPurchases(deals, { budget: 3000, balance: 1200, reserve: 1000, maxPerItem: { Ultraballe: 100 } });
  assert.deepEqual(tight.map((p) => [p.offer.id, p.quantity]), [[1, 4]]);
});

function sampleSummary() {
  const current = {
    ultraballe: [
      { id: 950, item: 'ultraballe', unitPrice: 80, quantity: 5 },
      { id: 951, item: 'ultraballe', unitPrice: 120, quantity: 7 },
      { id: 952, item: 'ultraballe', unitPrice: null, meritPrice: 3, quantity: 9 },
    ],
    okruch_ognisty: [{ id: 960, item: 'okruch_ognisty', unitPrice: 5000, quantity: 3 }],
    okruch_wodny: [],
  };
  return buildMarketSummary({
    offersByItem: current,
    names: { ultraballe: 'Ultraballe', okruch_ognisty: 'Okruchy Ogniste', okruch_wodny: 'Okruchy Wodne' },
    history: [...history, ...scanRecords(current, NOW)],
    now: NOW,
    watch: ['ultraballe'],
  });
}

test('buildMarketSummary: obserwowane oznaczone, okazje z flaga watched', () => {
  const s = sampleSummary();
  const u = s.items.find((i) => i.code === 'ultraballe');
  assert.deepEqual([u.watched, u.offers, u.lowest, u.supply, u.scans], [true, 3, 80, 12, 9]);
  assert.equal(s.items.find((i) => i.code === 'okruch_ognisty').watched, false);
  assert.equal(s.items.find((i) => i.code === 'okruch_wodny').lowest, null);
  assert.deepEqual(s.deals.map((d) => [d.code, d.watched]), [['ultraballe', true]]);
});

test('/targ: przeglad (obserwowane + okazje) i wyszukiwanie bez polskich znakow', () => {
  const s = sampleSummary();
  const text = formatMarket(s, NOW + 5 * 60000);
  assert.match(text, /odczyt 5 min temu, 3 przedmiotów/);
  assert.match(text, /Ultraballe: od 80 ¥ \(3 ofert\), zwykle od 100 ¥/);
  assert.doesNotMatch(text, /Okruchy Ogniste/);   // nieobserwowane tylko w wyszukiwaniu
  assert.match(text, /Okazje \(1\):\n- Ultraballe: 80 ¥ × 5 \(80% typowej ceny\)/);

  const found = formatMarket(s, NOW, 'okruch');
  assert.match(found, /Okruchy Ogniste: od 5000 ¥ \(1 ofert\), odczytów: 1/);
  assert.match(found, /Okruchy Wodne: brak ofert w ¥/);
  assert.match(formatMarket(s, NOW, 'ognistE'), /Okruchy Ogniste/);
  assert.match(formatMarket(s, NOW, 'masterball'), /Nie znaleziono "masterball"/);
  assert.match(formatMarket(null), /Brak danych z targu/);
});
