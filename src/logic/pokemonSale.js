// Co sprzedac z Hodowli: skup (Hodowla) czy targ. Czysta logika.
//
// Fakty z gry (02.10):
// - pokemonow z Hodowli nie da sie wystawic wprost - "Wystaw - Pokemony"
//   obejmuje tylko grupy rezerwy (najpierw trzeba je tam przeniesc),
// - minimalna cena wystawienia ~ cena skupu, limit 26 ofert,
// - na targu dominuja pokemony trenowane i shiny; zwykle zlapane
//   (bez treningow) rzadko maja oferty.
// Targ oplaca sie wiec tylko, gdy porownywalne oferty (bez shiny, malo
// treningow, podobny poziom) sa wyraznie drozsze niz skup.

const COMPARABLE_MAX_TRAININGS = 5;
const COMPARABLE_LEVEL_DIFF = 15;
const MARKET_PREMIUM = 1.3;          // targ musi dac min. 30% wiecej niz skup
const HIGH_VALUE_MULTIPLIER = 10;    // egzemplarz 10x drozszy niz typowy w gatunku

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

// Grupuje Hodowle po gatunku: [{ name, count, total, best, specimens }]
// posortowane od najwiekszej lacznej wartosci skupu.
function groupBySpecies(hodowla) {
  const map = new Map();
  for (const p of hodowla || []) {
    if (!map.has(p.name)) map.set(p.name, []);
    map.get(p.name).push(p);
  }
  return [...map.entries()].map(([name, specimens]) => {
    const sorted = specimens.slice().sort((a, b) => (b.value || 0) - (a.value || 0));
    return {
      name,
      count: specimens.length,
      total: specimens.reduce((s, p) => s + (p.value || 0), 0),
      best: sorted[0],
      specimens: sorted,
    };
  }).sort((a, b) => b.total - a.total);
}

// Gatunki do sprawdzenia na targu w tym odczycie: najcenniejsze najpierw,
// pomijamy sprawdzone w ciagu `maxAgeMs`.
function speciesToCheck(groups, cache, { limit = 60, now = Date.now(), maxAgeMs = 24 * 3600 * 1000 } = {}) {
  return groups
    .filter((g) => !(cache?.[g.name]?.ts > now - maxAgeMs))
    .slice(0, limit)
    .map((g) => g.name);
}

// Analiza jednego gatunku. offers - wynik parsePokemonOffers albo
// undefined (jeszcze nie sprawdzono).
function analyzeSpecies(group, offers, { pokemonOfDay = {} } = {}) {
  const typical = median(group.specimens.map((p) => p.value || 0));
  const highValue = group.specimens.filter((p) => typical && p.value >= typical * HIGH_VALUE_MULTIPLIER);
  const best = group.specimens.find((p) => !highValue.includes(p)) || group.best;
  const base = {
    name: group.name,
    count: group.count,
    total: group.total,
    best: { id: best.id, level: best.level, value: best.value },
    highValue: highValue.map((p) => ({ id: p.id, level: p.level, value: p.value })),
    pokemonOfDay: [pokemonOfDay.day, pokemonOfDay.guild].includes(group.name),
  };
  if (offers === undefined) return { ...base, verdict: 'nie-sprawdzono' };

  const forYen = offers.filter((o) => !o.shiny && o.yenPrice > 0);
  const comparable = forYen.filter((o) => (o.trainings || 0) <= COMPARABLE_MAX_TRAININGS
    && Math.abs((o.level || 0) - (best.level || 0)) <= COMPARABLE_LEVEL_DIFF);
  const market = {
    offers: offers.length,
    shiny: offers.filter((o) => o.shiny).length,
    forYen: forYen.length,
    comparable: comparable.length,
    minYen: forYen.length ? Math.min(...forYen.map((o) => o.yenPrice)) : null,
    comparableMin: comparable.length ? Math.min(...comparable.map((o) => o.yenPrice)) : null,
  };

  if (!offers.length) return { ...base, market, verdict: 'brak-ofert' };
  if (!comparable.length) return { ...base, market, verdict: 'brak-porownywalnych' };
  if (market.comparableMin >= best.value * MARKET_PREMIUM) {
    const price = market.comparableMin - 1;
    return { ...base, market, verdict: 'targ', suggestedPrice: price, gainPerPokemon: price - best.value };
  }
  return { ...base, market, verdict: 'skup' };
}

// Raport dla calej Hodowli. marketCache: { gatunek: { ts, offers } }.
function analyzeHodowla(hodowla, marketCache = {}, { pokemonOfDay = {} } = {}) {
  const groups = groupBySpecies(hodowla);
  const species = groups.map((g) => analyzeSpecies(g, marketCache[g.name]?.offers, { pokemonOfDay }));
  const by = (v) => species.filter((s) => s.verdict === v);
  return {
    pokemon: (hodowla || []).length,
    species: species.length,
    totalValue: groups.reduce((s, g) => s + g.total, 0),
    checked: species.filter((s) => s.verdict !== 'nie-sprawdzono').length,
    market: by('targ').sort((a, b) => b.gainPerPokemon - a.gainPerPokemon),
    sellToNpc: by('skup').length,
    noComparable: by('brak-porownywalnych').length,
    noOffers: by('brak-ofert').length,
    highValue: species.filter((s) => s.highValue.length)
      .flatMap((s) => s.highValue.map((p) => ({ name: s.name, ...p })))
      .sort((a, b) => b.value - a.value),
    pokemonOfDay: species.filter((s) => s.pokemonOfDay).map((s) => ({ name: s.name, count: s.count, total: s.total })),
    details: species,
  };
}

module.exports = {
  MARKET_PREMIUM, groupBySpecies, speciesToCheck, analyzeSpecies, analyzeHodowla,
};
