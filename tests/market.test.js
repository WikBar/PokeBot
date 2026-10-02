const test = require('node:test');
const assert = require('node:assert/strict');
const { priceStats, findDeals, suggestSellPrice, planPurchases } = require('../src/logic/market');

const NOW = Date.parse('2026-10-02T12:00:00Z');
const H = 3600 * 1000;
const obs = (id, item, unitPrice, hoursAgo = 30, quantity = 10) =>
  ({ id, item, unitPrice, quantity, ts: NOW - hoursAgo * H });

const history = [
  obs(1, 'Ultraballe', 100), obs(2, 'Ultraballe', 110), obs(3, 'Ultraballe', 120),
  obs(4, 'Ultraballe', 90), obs(5, 'Ultraballe', 105), obs(6, 'Ultraballe', 95, 2),
  obs(7, 'Jagoda Rawst', 50), obs(8, 'Jagoda Rawst', 60),
];

test('priceStats: mediana, kwartyl, oferta liczona raz, stare odrzucone', () => {
  const dup = [...history, { ...history[0] }, obs(99, 'Ultraballe', 9999, 24 * 30)];
  const s = priceStats(dup, { now: NOW });
  const u = s.get('ultraballe');
  assert.equal(u.offers, 6);
  assert.equal(u.min, 90);
  assert.equal(u.median, 103);
  assert.equal(u.max, 120);
  assert.equal(u.name, 'Ultraballe');
});

test('findDeals: ponizej 70% mediany, tylko przy wystarczajacej historii', () => {
  const s = priceStats(history, { now: NOW });
  const offers = [
    { id: 20, item: 'Ultraballe', unitPrice: 60, quantity: 5 },
    { id: 21, item: 'Ultraballe', unitPrice: 100, quantity: 5 },
    { id: 22, item: 'Jagoda Rawst', unitPrice: 10, quantity: 5 },   // za malo historii
  ];
  const deals = findDeals(offers, s);
  assert.deepEqual(deals.map((d) => d.offer.id), [20]);
  assert.equal(deals[0].ratio, 0.58);
  assert.deepEqual(findDeals(offers, s, { watchlist: ['Jagoda Rawst'] }), []);
});

test('suggestSellPrice: pod najtansza oferta, ale nie ponizej 80% mediany', () => {
  const s = priceStats(history, { now: NOW });
  assert.equal(suggestSellPrice('Ultraballe', [{ item: 'Ultraballe', unitPrice: 98 }], s).price, 97);
  const low = suggestSellPrice('Ultraballe', [{ item: 'Ultraballe', unitPrice: 50 }], s);
  assert.equal(low.price, 83);
  assert.equal(suggestSellPrice('Ultraballe', [], s).price, 103);
  assert.equal(suggestSellPrice('Nieznane', [], s), null);
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

const { buildMarketSummary } = require('../src/logic/market');
const { formatMarket } = require('../src/logic/telegramCommands');

test('buildMarketSummary: najnizsza cena, podaz, mediana, okazje z nazwa', () => {
  const offersByItem = {
    ultraballe: [
      { id: 20, item: 'ultraballe', unitPrice: 60, quantity: 5 },
      { id: 21, item: 'ultraballe', unitPrice: 100, quantity: 7 },
      { id: 22, item: 'ultraballe', unitPrice: null, meritPrice: 3, quantity: 9 },
    ],
  };
  const hist = history.filter((o) => o.item === 'Ultraballe').map((o) => ({ ...o, item: 'ultraballe' }));
  const s = buildMarketSummary({ offersByItem, names: { ultraballe: 'Ultraballe' }, history: hist, now: NOW });
  const u = s.items[0];
  assert.deepEqual([u.name, u.offers, u.lowest, u.supply, u.median], ['Ultraballe', 3, 60, 12, 103]);
  assert.equal(s.deals.length, 1);
  assert.equal(s.deals[0].name, 'Ultraballe');
  const text = formatMarket(s, NOW + 5 * 60000);
  assert.match(text, /odczyt 5 min temu/);
  assert.match(text, /Ultraballe: od 60 ¥ \(3 ofert\), mediana 103 ¥/);
  assert.match(text, /Okazje:\n- Ultraballe: 60 ¥ × 5 \(58% mediany\)/);
  assert.match(formatMarket(null), /Brak danych z targu/);
});
