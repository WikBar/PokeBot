// Historia cen pokemonow na targu i wykrywanie ofert ponizej rzeczywistej
// wartosci. Czysta logika.
//
// Wpis historii = jedna oferta z jednego odczytu (kompaktowe klucze):
//   { ts, sp: gatunek, id, lvl, tr: treningi, val: wartosc skupu,
//     yen: cena w ¥ | null, pz: cena w PZ | null, sh: shiny }
//
// Rzeczywista wartosc oferty liczymy na dwa sposoby:
// 1. ponizej skupu - cena w ¥ nizsza niz "Wartosc" tego pokemona (to, co da
//    za niego skup w Hodowli): kupno i sprzedaz w skupie to od razu zysk;
// 2. ponizej typowej ceny - cena/wartosc ponizej `ratio` typowego stosunku
//    dla TEGO SAMEGO gatunku i kategorii (zwykly / trenowany / shiny),
//    liczonego z historii (min. 5 roznych ofert).
//    Bez porownania z calym targiem: ceny trenowanych wahaja sie od 1,5x
//    do 175x wartosci niezaleznie od liczby treningow (02.10) - wspolny
//    stosunek dawal same falszywe okazje.

const TRAINED_MIN = 6;   // od tylu treningow pokemon jest "trenowany"
const CATEGORIES = ['zwykly', 'trenowany', 'shiny'];

function categoryOf(o) {
  if (o.sh || o.shiny) return 'shiny';
  return (o.tr ?? o.trainings ?? 0) >= TRAINED_MIN ? 'trenowany' : 'zwykly';
}

// Oferty gatunku (parsePokemonOffers) -> wpisy historii.
function offerRecords(species, offers, ts) {
  return (offers || []).map((o) => ({
    ts,
    sp: species,
    id: o.id,
    lvl: o.level,
    tr: o.trainings || 0,
    val: o.value,
    yen: o.yenPrice,
    pz: o.meritPrice,
    sh: !!o.shiny,
  }));
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Typowe stosunki cena/wartosc: Map 'gatunek|kategoria' i '*|kategoria'
// -> { median, n }. Kazda oferta liczy sie raz (najnowszy wpis jej id) -
// dlugo wiszaca oferta nie moze przewazyc mediany.
function ratioStats(history) {
  const latest = new Map();
  for (const r of history || []) {
    if (!(r.yen > 0) || !(r.val > 0)) continue;
    const prev = latest.get(r.id);
    if (!prev || r.ts > prev.ts) latest.set(r.id, r);
  }
  const groups = new Map();
  const push = (key, v) => {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  };
  for (const r of latest.values()) {
    const ratio = r.yen / r.val;
    const cat = categoryOf(r);
    push(`${r.sp}|${cat}`, ratio);
    push(`*|${cat}`, ratio);
  }
  const out = new Map();
  for (const [k, v] of groups) out.set(k, { median: median(v), n: v.length });
  return out;
}

// Oferty ponizej rzeczywistej wartosci.
// offersBySpecies: { gatunek: [oferty z parsePokemonOffers] } (aktualny odczyt)
// Zwraca [{ species, offer, category, kind, expected, ratio, basis }]
// posortowane od najwiekszego zysku (expected - cena).
// - kind 'ponizej-skupu': expected = wartosc skupu
// - kind 'ponizej-typowej': expected = wartosc * typowy stosunek
function findPokemonDeals(offersBySpecies, history, { ratio = 0.8, minSpecies = 5 } = {}) {
  const stats = ratioStats(history);
  const deals = [];
  for (const [species, offers] of Object.entries(offersBySpecies || {})) {
    for (const offer of offers || []) {
      if (!(offer.yenPrice > 0) || !(offer.value > 0)) continue;
      const category = categoryOf(offer);
      if (offer.yenPrice < offer.value) {
        deals.push({
          species, offer, category, kind: 'ponizej-skupu',
          expected: offer.value, ratio: Math.round((offer.yenPrice / offer.value) * 100) / 100, basis: 'skup',
        });
        continue;
      }
      const own = stats.get(`${species}|${category}`);
      if (!own || own.n < minSpecies) continue;
      const ref = { ...own, basis: 'gatunek' };
      const expected = Math.round(offer.value * ref.median);
      const r = offer.yenPrice / expected;
      if (r <= ratio) {
        deals.push({
          species, offer, category, kind: 'ponizej-typowej',
          expected, ratio: Math.round(r * 100) / 100, basis: ref.basis,
        });
      }
    }
  }
  return deals.sort((a, b) => (b.expected - b.offer.yenPrice) - (a.expected - a.offer.yenPrice));
}

module.exports = { TRAINED_MIN, CATEGORIES, categoryOf, offerRecords, ratioStats, findPokemonDeals };
