// Analiza targowiska - czysta logika, niezalezna od wygladu strony.
// Parser strony (osobno) zamienia oferty na:
//   { id, item, unitPrice, quantity, seller?, ts }
// a historia to lista takich obserwacji z kolejnych odczytow.

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

// Statystyki cen per przedmiot z obserwacji z ostatnich `days` dni.
// - median/p25/min/max: kazda oferta liczy sie raz (po id), nawet jesli
//   widzielismy ja w wielu odczytach - inaczej dlugo wiszaca droga oferta
//   zawyzalaby mediane.
// - typicalLow: mediana NAJNIZSZYCH cen z kolejnych odczytow. To punkt
//   odniesienia dla okazji i cen sprzedazy - najtansze oferty zawsze leza
//   ponizej mediany calej listy, wiec porownanie z mediana dawalo
//   falszywe okazje.
// - scans: liczba odczytow z tym przedmiotem.
// - trend: typowa najnizsza cena z ostatniej doby / z wczesniejszych
//   odczytow (null, gdy historia krotsza niz doba).
function priceStats(observations, { now = Date.now(), days = 7 } = {}) {
  const since = now - days * DAY_MS;
  const unique = new Map();
  const lowsByItem = new Map();   // item -> Map(ts -> najnizsza cena)
  for (const o of observations || []) {
    if (!o || o.ts < since || !(o.unitPrice > 0)) continue;
    const key = o.id != null ? `id:${o.id}` : `${normalizeItem(o.item)}|${o.unitPrice}|${o.seller || ''}`;
    if (!unique.has(key)) unique.set(key, o);
    const k = normalizeItem(o.item);
    if (!lowsByItem.has(k)) lowsByItem.set(k, new Map());
    const lows = lowsByItem.get(k);
    if (!lows.has(o.ts) || o.unitPrice < lows.get(o.ts)) lows.set(o.ts, o.unitPrice);
  }

  const byItem = new Map();
  for (const o of unique.values()) {
    const k = normalizeItem(o.item);
    if (!byItem.has(k)) byItem.set(k, { name: o.item, all: [] });
    byItem.get(k).all.push(o.unitPrice);
  }

  const stats = new Map();
  for (const [k, g] of byItem) {
    const all = g.all.sort((a, b) => a - b);
    const scanLows = [...lowsByItem.get(k).entries()];
    const lows = scanLows.map(([, p]) => p).sort((a, b) => a - b);
    const recent = scanLows.filter(([ts]) => ts >= now - DAY_MS).map(([, p]) => p).sort((a, b) => a - b);
    const older = scanLows.filter(([ts]) => ts < now - DAY_MS).map(([, p]) => p).sort((a, b) => a - b);
    stats.set(k, {
      item: k,
      name: g.name,
      offers: all.length,
      min: all[0],
      p25: quantile(all, 0.25),
      median: quantile(all, 0.5),
      max: all[all.length - 1],
      scans: lows.length,
      typicalLow: quantile(lows, 0.5),
      trend: recent.length && older.length
        ? Math.round((quantile(recent, 0.5) / quantile(older, 0.5)) * 100) / 100
        : null,
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
// names: { kod: nazwa z katalogu }, history: obserwacje z historii
// (lacznie z aktualnym odczytem).
function buildMarketSummary({ offersByItem, names = {}, history, now = Date.now(), dealRatio = 0.85 }) {
  const stats = priceStats(history, { now });
  const items = [];
  const deals = [];
  for (const [code, offers] of Object.entries(offersByItem)) {
    const priced = offers.filter((o) => o.unitPrice > 0);
    const s = stats.get(normalizeItem(code)) || null;
    const lowest = priced.length ? Math.min(...priced.map((o) => o.unitPrice)) : null;
    const itemDeals = findDeals(priced, stats, { ratio: dealRatio });
    deals.push(...itemDeals.map((d) => ({ ...d, name: names[code] || code })));
    items.push({
      code,
      name: names[code] || code,
      offers: offers.length,
      lowest,
      supply: priced.reduce((sum, o) => sum + (o.quantity || 0), 0),
      median: s?.median ?? null,
      typicalLow: s?.typicalLow ?? null,
      scans: s?.scans ?? 0,
      p25: s?.p25 ?? null,
      trend: s?.trend ?? null,
      historyOffers: s?.offers ?? 0,
      suggestedSell: suggestSellPrice(code, priced, stats),
    });
  }
  return { updatedAt: new Date(now).toISOString(), items, deals };
}

module.exports = { normalizeItem, priceStats, findDeals, suggestSellPrice, planPurchases, buildMarketSummary };
