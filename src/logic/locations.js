// Wybor lokacji - czysta logika, wspolna dla trybu Shiny i randomAdventure.

// Lokacje specjalne sa dostepne tylko w piatek, sobote i niedziele
// (getDay(): 0 = niedziela, 5 = piatek, 6 = sobota).
const SPECIAL_LOCATION_DAYS = [0, 5, 6];

function isSpecialLocationDay(date = new Date()) {
  return SPECIAL_LOCATION_DAYS.includes(date.getDay());
}

// Nie-specjalne lokacje regionu posortowane po numerze: [[key, loc], ...].
function nonSpecialLocations(region) {
  return Object.entries(region || {})
    .filter(([, loc]) => !loc.isSpecial)
    .sort(([a], [b]) => Number(a) - Number(b));
}

// Kolejna lokacja w rotacji. Zwraca { nr, name, ignoredSkipped } albo null,
// gdy region nie ma zadnej nie-specjalnej lokacji.
// - skipped: numery wypraw pominietych w panelu web; wartosci spoza regionu
//   sa ignorowane, a gdy pominieto wszystkie - filtr jest pomijany, inaczej
//   bot nie mialby dokad isc.
// - fromStart: pierwsza dostepna lokacja zamiast kolejnej (np. gdy bot stoi
//   na lokacji specjalnej w dzien, w ktorym jest niedostepna).
// Gdy biezaca lokacja jest pominieta lub specjalna, findIndex zwraca -1
// i trafiamy na pierwsza dostepna.
function pickNextLocation(region, currentNr, skipped = [], { fromStart = false } = {}) {
  const all = nonSpecialLocations(region);
  if (all.length === 0) return null;

  const skippedSet = new Set(
    (Array.isArray(skipped) ? skipped : []).map(Number).filter(Number.isFinite)
  );
  let pool = all.filter(([key]) => !skippedSet.has(Number(key)));
  let ignoredSkipped = false;
  if (pool.length === 0) {
    pool = all;
    ignoredSkipped = true;
  }

  const nextIdx = fromStart
    ? 0
    : (pool.findIndex(([key]) => Number(key) === Number(currentNr)) + 1) % pool.length;
  const [key, loc] = pool[nextIdx];
  return { nr: Number(key), name: loc.name, ignoredSkipped };
}

module.exports = { SPECIAL_LOCATION_DAYS, isSpecialLocationDay, nonSpecialLocations, pickNextLocation };
