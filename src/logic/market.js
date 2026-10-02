// Analiza targowiska - czysta logika, niezalezna od wygladu strony.
// Parser strony (logic/marketParse.js) zamienia oferty na:
//   { id, item, unitPrice, quantity, meritPrice, seller }
// a historia to podsumowania kolejnych odczytow (patrz scanRecords).

const DAY_MS = 24 * 3600 * 1000;

function normalizeItem(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
}

// Historia targu to podsumowania odczytow, jedno na przedmiot i odczyt:
//   { ts, item, low, median, n, supply }
// (surowe oferty ~100 przedmiotow co godzine urosnalyby do setek MB).

// Podsumowanie jednego odczytu przedmiotu z ofert w ¥. null bez ofert w ¥.
function summarizeScan(offers) {
  const prices = (offers || []).filter((o) => o.unitPrice > 0).map((o) => o.unitPrice).sort((a, b) => a - b);
  if (!prices.length) return null;
  return {
    low: prices[0],
    median: quantile(prices, 0.5),
    n: prices.length,
    supply: (offers || []).filter((o) => o.unitPrice > 0).reduce((s, o) => s + (o.quantity || 0), 0),
  };
}

// Wpisy historii z jednego odczytu: { kod: oferty } -> [{ ts, item, ... }].
function scanRecords(offersByItem, ts) {
  const out = [];
  for (const [item, offers] of Object.entries(offersByItem || {})) {
    const s = summarizeScan(offers);
    if (s) out.push({ ts, item: normalizeItem(item), ...s });
  }
  return out;
}

// Statystyki per przedmiot z historii z ostatnich `days` dni:
// - typicalLow: mediana najnizszych cen z kolejnych odczytow - punkt
//   odniesienia dla okazji i cen sprzedazy (najtansze oferty zawsze leza
//   ponizej mediany calej listy, wiec porownanie z mediana dawalo
//   falszywe okazje),
// - median: typowa mediana listy ofert,
// - scans: liczba odczytow,
// - trend: typowa najnizsza cena z ostatniej doby / z wczesniejszych
//   odczytow (null, gdy historia krotsza niz doba).
function priceStats(records, { now = Date.now(), days = 7 } = {}) {
  const since = now - days * DAY_MS;
  const byItem = new Map();
  for (const r of records || []) {
    if (!r || r.ts < since || !(r.low > 0)) continue;
    const k = normalizeItem(r.item);
    if (!byItem.has(k)) byItem.set(k, []);
    byItem.get(k).push(r);
  }
  const stats = new Map();
  const med = (arr) => quantile([...arr].sort((a, b) => a - b), 0.5);
  for (const [k, list] of byItem) {
    const recent = list.filter((r) => r.ts >= now - DAY_MS).map((r) => r.low);
    const older = list.filter((r) => r.ts < now - DAY_MS).map((r) => r.low);
    stats.set(k, {
      item: k,
      scans: list.length,
      typicalLow: med(list.map((r) => r.low)),
      median: med(list.map((r) => r.median || r.low)),
      trend: recent.length && older.length ? Math.round((med(recent) / med(older)) * 100) / 100 : null,
    });
  }
  return stats;
}

// Okazje: oferty ponizej `ratio` typowej najnizszej ceny (typicalLow).
// Wymagamy `minScans` odczytow - z jednego-dwoch odczytow nie wiadomo,
// jaka cena jest typowa.
// Zwraca liste { offer, reference, ratio } posortowana od najlepszej.
function findDeals(offers, stats, { ratio = 0.85, minScans = 6, watchlist = null } = {}) {
  const watched = watchlist ? new Set(watchlist.map(normalizeItem)) : null;
  const deals = [];
  for (const offer of offers || []) {
    if (!(offer.unitPrice > 0)) continue;
    const k = normalizeItem(offer.item);
    if (watched && !watched.has(k)) continue;
    const s = stats.get(k);
    if (!s || s.scans < minScans || !s.typicalLow) continue;
    const r = offer.unitPrice / s.typicalLow;
    if (r <= ratio) deals.push({ offer, reference: s.typicalLow, ratio: Math.round(r * 100) / 100 });
  }
  return deals.sort((a, b) => a.ratio - b.ratio);
}

// Sugerowana cena wystawienia: tuz pod najtansza aktualna oferta (zeby
// sprzedac szybko), ale nie ponizej `floor` typowej najnizszej ceny, gdy
// ta jest juz znana (min. `minScans` odczytow) - zeby jedna oferta-okazja
// nie zbila ceny. Bez danych - null.
function suggestSellPrice(item, currentOffers, stats, { undercut = 1, floor = 0.9, minScans = 3 } = {}) {
  const k = normalizeItem(item);
  const s = stats.get(k);
  const current = (currentOffers || [])
    .filter((o) => normalizeItem(o.item) === k && o.unitPrice > 0)
    .map((o) => o.unitPrice);
  const lowest = current.length ? Math.min(...current) : null;
  const known = s && s.scans >= minScans && s.typicalLow;
  const minAllowed = known ? Math.ceil(s.typicalLow * floor) : 0;

  if (lowest === null && !known) return null;
  if (lowest === null) return { price: s.typicalLow, reason: 'brak aktualnych ofert - typowa najniższa cena' };
  const price = Math.max(lowest - undercut, minAllowed);
  return {
    price,
    reason: price === lowest - undercut
      ? `o ${undercut} ¥ taniej niż najtańsza oferta (${lowest})`
      : `najtańsza oferta (${lowest}) poniżej ${Math.round(floor * 100)}% typowej ceny - trzymam ${minAllowed}`,
  };
}

// Plan zakupow okazji w ramach limitow. Nic nie kupuje - zwraca liste.
// - budget: ile lacznie mozna wydac w tym przebiegu
// - balance: aktualne Yeny; zostawiamy `reserve`
// - maxPerItem: { item: maks. sztuk } - ile chcemy miec danego przedmiotu
// - owned: { item: posiadane sztuki } (plecak)
function planPurchases(deals, { budget = 0, balance = Infinity, reserve = 0, maxPerItem = {}, owned = {} } = {}) {
  let left = Math.min(budget, Math.max(0, balance - reserve));
  const want = {};
  for (const [item, max] of Object.entries(maxPerItem)) {
    want[normalizeItem(item)] = Math.max(0, max - (owned[item] ?? owned[normalizeItem(item)] ?? 0));
  }
  const plan = [];
  for (const d of deals) {
    const k = normalizeItem(d.offer.item);
    const need = want[k] ?? 0;
    if (need <= 0 || left <= 0) continue;
    const qty = Math.min(need, d.offer.quantity || 1, Math.floor(left / d.offer.unitPrice));
    if (qty <= 0) continue;
    const cost = qty * d.offer.unitPrice;
    plan.push({ offer: d.offer, quantity: qty, cost, ratio: d.ratio });
    want[k] = need - qty;
    left -= cost;
  }
  return plan;
}
// Podsumowanie po odczycie targu - dla /targ, panelu i alarmow.
// offersByItem: { kod: [oferty z parseItemOffers] } (aktualny odczyt),
// names: { kod: nazwa z katalogu }, history: wpisy historii (lacznie
// z aktualnym odczytem), watch: obserwowane kody (alarmy, wiecej stron).
function buildMarketSummary({ offersByItem, names = {}, history, now = Date.now(), dealRatio = 0.85, watch = [] }) {
  const stats = priceStats(history, { now });
  const watched = new Set(watch.map(normalizeItem));
  const items = [];
  const deals = [];
  for (const [code, offers] of Object.entries(offersByItem)) {
    const priced = offers.filter((o) => o.unitPrice > 0);
    const scanned = summarizeScan(priced);
    const s = stats.get(normalizeItem(code)) || null;
    const isWatched = watched.has(normalizeItem(code));
    const name = names[code] || code;
    deals.push(...findDeals(priced, stats, { ratio: dealRatio })
      .map((d) => ({ ...d, name, code, watched: isWatched })));
    items.push({
      code,
      name,
      watched: isWatched,
      offers: offers.length,
      lowest: scanned?.low ?? null,
      supply: scanned?.supply ?? 0,
      typicalLow: s?.typicalLow ?? null,
      median: s?.median ?? null,
      scans: s?.scans ?? 0,
      trend: s?.trend ?? null,
      suggestedSell: suggestSellPrice(code, priced, stats),
    });
  }
  deals.sort((a, b) => a.ratio - b.ratio);
  return { updatedAt: new Date(now).toISOString(), items, deals };
}

module.exports = {
  normalizeItem, summarizeScan, scanRecords, priceStats,
  findDeals, suggestSellPrice, planPurchases, buildMarketSummary,
};
