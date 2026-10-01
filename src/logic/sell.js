// Wybor pokemonow do sprzedazy w Hodowli - czysta logika nad tekstami
// przyciskow (label.btn-hodowla). SellPokemon tylko klika wynik.

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Nazwa pokemona z tekstu przycisku: pierwsza linia bez plci, poziomu i liczb.
function extractName(raw) {
  const firstLine = String(raw || '').split('\n')[0].trim();
  const cleaned = firstLine
    .replace(/\s{2,}/g, ' ')
    .replace(/♀|♂/g, '')
    .replace(/[+>]/g, '')
    .replace(/\d+\s*poz\b/gi, '')
    .replace(/\b(poziom|lvl|lv)\s*\d+\b/gi, '')
    .replace(/\b\d+\b/g, '')
    .replace(/\(.*\)$/g, '')
    .trim();
  return cleaned.length ? cleaned : firstLine;
}

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Dokladne dopasowanie nazwy z listy do nazwy z przycisku. Wczesniej regex
// dopasowywal fragment: "Klink" sprzedawal Klinklanga, a "Meowth" - Meowth
// Alola z druzyny. Lepiej czegos nie sprzedac niz sprzedac nie to.
function findListName(list, name) {
  const n = normalizeName(name);
  return list.find((entry) => normalizeName(entry) === n);
}

// Ochrona celowo dopasowuje fragment (stare zachowanie): "Flabébé" chroni
// tez formy z dopiskiem. Nadmiarowa ochrona jest bezpieczna.
function isProtectedText(protectedList, text) {
  return protectedList.some((name) => new RegExp(escapeRegExp(name)).test(text));
}

// Zwraca { indexes, keptOne, surplus, counts }:
// - indexes: indeksy przyciskow do zaznaczenia (kolejnosc jak w Hodowli),
// - keptOne: nazwy z sellable, z ktorych zostawiamy po jednej sztuce,
// - surplus: [{ label, name, count, sold }] dla limitow diff3/diff4,
// - counts: Map nazwa -> liczba sztuk w Hodowli (do TOP 5).
function planSale(texts, {
  sellable = [], protectedList = [], diff3 = [], diff4 = [],
  diff3Keep = 5, diff4Keep = 5, limitsEnabled = true,
} = {}) {
  const names = texts.map(extractName);
  const counts = new Map();
  for (const name of names) counts.set(name, (counts.get(name) || 0) + 1);

  const indexes = [];
  const keptOne = new Set();
  const surplus = [];
  const isProtected = (i) => isProtectedText(protectedList, texts[i]);

  for (let i = 0; i < texts.length; i++) {
    if (isProtected(i)) continue;
    const matched = findListName(sellable, names[i]);
    if (!matched) continue;
    if (keptOne.has(matched)) indexes.push(i);
    else keptOne.add(matched);
  }

  // Pokemony diff3/diff4: sprzedajemy nadwyzki powyzej ustalonego limitu.
  // Indeksy juz zakwalifikowane pomijamy, zeby nie klikac dwa razy.
  const limitSurplus = (list, keep, label) => {
    if (!Array.isArray(list) || list.length === 0) return;
    const groups = new Map();
    for (let i = 0; i < texts.length; i++) {
      if (isProtected(i) || indexes.includes(i)) continue;
      const matched = findListName(list, names[i]);
      if (!matched) continue;
      if (!groups.has(matched)) groups.set(matched, []);
      groups.get(matched).push(i);
    }
    for (const [name, idx] of groups) {
      if (idx.length > keep) {
        const toSell = idx.slice(keep);
        surplus.push({ label, name, count: idx.length, sold: toSell.length });
        indexes.push(...toSell);
      }
    }
  };

  if (limitsEnabled) {
    limitSurplus(diff3, diff3Keep, 'diff3');
    limitSurplus(diff4, diff4Keep, 'diff4');
  }

  return { indexes, keptOne: [...keptOne], surplus, counts };
}

module.exports = { extractName, planSale, findListName, isProtectedText };
