const test = require('node:test');
const assert = require('node:assert/strict');
const {
  priceStats, findDeals, suggestSellPrice, planPurchases, buildMarketSummary,
} = require('../src/logic/market');
const { formatMarket } = require('../src/logic/telegramCommands');

const NOW = Date.parse('2026-10-02T12:00:00Z');
const H = 3600 * 1000;

// Odczyt targu: najtansza oferta `low` i kilka drozszych, wszystkie z tym
// samym ts (jak w prawdziwym odczycie).
let nextId = 1;
function scan(hoursAgo, low, item = 'ultraballe') {
  const ts = NOW - hoursAgo * H;
  return [low, low + 10, low + 40, 200].map((unitPrice) => ({ id: nextId++, item, unitPrice, quantity: 10, ts }));
}
// 8 odczytow z typowa najnizsza cena ~100 (w tym 2 sprzed ponad doby).
const history = [
  ...scan(40, 100), ...scan(30, 98), ...scan(20, 102), ...scan(10, 100),
  ...scan(6, 101), ...scan(4, 99), ...scan(2, 100), ...scan(1, 100),
];

test('priceStats: typowa najnizsza cena z kolejnych odczytow, oferta liczona raz', () => {
  const s = priceStats([...history, { ...history[0] }], { now: NOW }).get('ultraballe');
  assert.equal(s.scans, 8);
  assert.equal(s.typicalLow, 100);
  assert.equal(s.offers, 32);
  assert.equal(s.min, 98);
  assert.ok(s.median > s.typicalLow);   // mediana calej listy jest zawsze wyzej
});

test('priceStats: trend tylko przy historii dluzszej niz doba', () => {
  // ostatnia doba: mediana najnizszych 100; wczesniej (100, 98): 99 -> 1.01
  assert.equal(priceStats(history, { now: NOW }).get('ultraballe').trend, 1.01);
  assert.equal(priceStats(scan(1, 100), { now: NOW }).get('ultraballe').trend, null);
});

test('findDeals: wzgledem typowej najnizszej ceny, dopiero po 6 odczytach (regresja: falszywe okazje z 1 odczytu)', () => {
  const offers = [
    { id: 900, item: 'ultraballe', unitPrice: 80, quantity: 5 },
    { id: 901, item: 'ultraballe', unitPrice: 95, quantity: 5 },
    { id: 902, item: 'ultraballe', unitPrice: null, meritPrice: 3, quantity: 5 },
  ];
  const deals = findDeals(offers, priceStats(history, { now: NOW }));
  assert.deepEqual(deals.map((d) => [d.offer.id, d.reference, d.ratio]), [[900, 100, 0.8]]);

  // Jeden odczyt: najtansze oferty sa daleko ponizej mediany listy, ale to nie okazje.
  const single = scan(1, 65);
  assert.deepEqual(findDeals(single, priceStats(single, { now: NOW })), []);
  assert.deepEqual(findDeals(offers, priceStats(history, { now: NOW }), { watchlist: ['rawst_berry'] }), []);
});

test('suggestSellPrice: pod najtansza oferta, nie ponizej 90% typowej ceny', () => {
  const s = priceStats(history, { now: NOW });
  assert.equal(suggestSellPrice('ultraballe', [{ item: 'ultraballe', unitPrice: 98 }], s).price, 97);
  assert.equal(suggestSellPrice('ultraballe', [{ item: 'ultraballe', unitPrice: 50 }], s).price, 90);
  assert.equal(suggestSellPrice('ultraballe', [], s).price, 100);
  assert.equal(suggestSellPrice('nieznane', [], s), null);
  // Przy jednym odczycie bez dolnej granicy - po prostu pod najtansza.
  const one = priceStats(scan(1, 65), { now: NOW });
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

test('buildMarketSummary i /targ', () => {
  const current = [
    { id: 950, item: 'ultraballe', unitPrice: 80, quantity: 5, ts: NOW },
    { id: 951, item: 'ultraballe', unitPrice: 120, quantity: 7, ts: NOW },
    { id: 952, item: 'ultraballe', unitPrice: null, meritPrice: 3, quantity: 9, ts: NOW },
  ];
  const s = buildMarketSummary({
    offersByItem: { ultraballe: current },
    names: { ultraballe: 'Ultraballe' },
    history: [...history, ...current.filter((o) => o.unitPrice)],
    now: NOW,
  });
  const u = s.items[0];
  assert.deepEqual([u.name, u.offers, u.lowest, u.supply, u.scans], ['Ultraballe', 3, 80, 12, 9]);
  assert.equal(s.deals.length, 1);
  const text = formatMarket(s, NOW + 5 * 60000);
  assert.match(text, /odczyt 5 min temu/);
  assert.match(text, /Ultraballe: od 80 ¥ \(3 ofert\), zwykle od 100 ¥/);
  assert.match(text, /Okazje:\n- Ultraballe: 80 ¥ × 5 \(80% typowej ceny\)/);
  assert.match(formatMarket(null), /Brak danych z targu/);

  const first = buildMarketSummary({ offersByItem: { ultraballe: current }, names: {}, history: current, now: NOW });
  assert.match(formatMarket(first, NOW), /odczytów: 1/);
  assert.deepEqual(first.deals, []);
});
