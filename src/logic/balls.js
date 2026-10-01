// Wybor kuli przy lapaniu - czysta logika, bez Playwrighta.
// CatchPokemon (actions/adventure.js) tylko klika to, co tu wyjdzie,
// dzieki czemu tabele regul da sie przetestowac bez przegladarki.

const NEST_BALL_MAX_LV = 20;
// Levelball od 30 poziomu wzwyz. Ponizej tego progu zostaja nightball
// (wieczorem/noca) i greatball.
const LVL_BALL_MIN_LV = 30;
// Do tego poziomu najtrudniejsze pokemony (diff 5) lapiemy ultraballem.
const ULTRA_BALL_MAX_LV = 70;
const LURE_BALL_MAX_LV = 30;

// Porownanie nazw odporne na wielkosc liter i podwojne spacje - listy
// z panelu wpisuje czlowiek, a nazwa ze strony bywa z dodatkowa spacja.
function normalizePokemonName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function isNightHour(hour) {
  return hour >= 18 || hour < 6;
}

// Zwraca { ball, fallback?, kind, reason }:
// - ball/fallback: klucze z Pokeballe (actions/constants.js),
// - kind: 'beast' | 'goldenNest' | 'normal' - wywolujacy obsluguje
//   powiadomienia Golden Nest i sprawdzenie zlapania.
//
// Wejscie:
// - pokemon: { pokemon, level, catchDiff }
// - isSpecial: lokacja specjalna (tylko safariball na ekranie)
// - sharesType: pokemon ma typ wspolny z pokemonem wyslanym do walki
// - hour: 0-23 (wstrzykiwane, zeby testy nie zalezaly od zegara)
// - options: { ultraBeast, goldenNest, saveSafariBall, strongBallPokemons }
function chooseBall({ pokemon, isSpecial = false, sharesType = false, hour = new Date().getHours(), options = {} }) {
  const level = Number(pokemon?.level) || 0;
  const diff = Number(pokemon?.catchDiff) || 0;

  // Ultra Bestia: po walce dostepny jest wylacznie beastball.
  if (options.ultraBeast) {
    return { ball: 'beastball', kind: 'beast', reason: 'Ultra Bestia' };
  }

  // Golden Nest ma pierwszenstwo przed wszystkim innym (takze lista mocnych
  // kul) - inaczej nie poszloby powiadomienie, a bot uznalby gniazdo za
  // nieudane i zablokowal sie na lokacji. W lokacji specjalnej safariball
  // jest jedyna kula, wiec oszczedzanie safariballi tu nie obowiazuje.
  if (options.goldenNest === true) {
    return {
      ball: isSpecial ? 'safariball' : 'cherishball',
      kind: 'goldenNest',
      reason: 'Golden Nest',
    };
  }

  // Oszczedzanie safariballi (panel web). Wlaczone = rzucamy tylko przy
  // diff >= 3; wylaczone = w lokacji specjalnej rzucamy zawsze.
  const saveSafariBall = options.saveSafariBall !== false;
  if (isSpecial && (!saveSafariBall || diff >= 3)) {
    return { ball: 'safariball', kind: 'normal', reason: 'lokacja specjalna' };
  }

  const strongList = Array.isArray(options.strongBallPokemons) ? options.strongBallPokemons : [];
  const name = normalizePokemonName(pokemon?.pokemon);
  if (strongList.some((n) => normalizePokemonName(n) === name)) {
    return { ball: 'ultraball', fallback: 'premierball', kind: 'normal', reason: 'lista mocnych kul' };
  }

  if (level < LURE_BALL_MAX_LV && diff <= 2 && sharesType) {
    return { ball: 'lureball', kind: 'normal', reason: 'wspolny typ' };
  }
  if (diff === 1 && level < 13) return { ball: 'pokeball', kind: 'normal', reason: 'diff 1' };
  if (diff === 2 && level < 30) return { ball: 'friendball', kind: 'normal', reason: 'diff 2' };

  // Ultraball tylko na najtrudniejsze (diff 5) do 70 poziomu.
  if (diff >= 5 && level < ULTRA_BALL_MAX_LV) {
    return { ball: 'ultraball', fallback: 'premierball', kind: 'normal', reason: 'diff 5' };
  }
  // Diff 4 zawsze levelballem - takze ponizej 30 poziomu.
  if (diff === 4) return { ball: 'levelball', kind: 'normal', reason: 'diff 4' };
  if (level >= LVL_BALL_MIN_LV) return { ball: 'levelball', kind: 'normal', reason: 'poziom 30+' };
  if (isNightHour(hour)) return { ball: 'nightball', kind: 'normal', reason: 'noc' };
  // Diff 3 i wyzej ponizej 20 poziomu pomija nestballa i schodzi do greatballa.
  if (level < NEST_BALL_MAX_LV && diff < 3) return { ball: 'nestball', kind: 'normal', reason: 'niski poziom' };
  return { ball: 'greatball', kind: 'normal', reason: 'domyslnie' };
}

module.exports = { chooseBall, normalizePokemonName, isNightHour };
