// Do ktorej listy w config.json trafia zlapany pokemon - czysta logika.

const DIFF_LIST_MAP = {
  0: 'diff0CatchPokemons',
  3: 'diff3CatchPokemons',
  4: 'diff4CatchPokemons',
  5: 'diff5CatchPokemons',
};

// Zwraca { listKey } albo { skip: 'protected' | 'unknown' }.
// Trudnosc 1-2 idzie do sprzedazy, chyba ze pokemon jest chroniony.
function targetListFor(diff, name, protectedList = []) {
  if (!name) return { skip: 'unknown' };
  if (diff !== 0 && diff <= 2) {
    const list = Array.isArray(protectedList) ? protectedList : [];
    if (list.includes(name)) return { skip: 'protected' };
    return { listKey: 'sellablePokemon' };
  }
  const listKey = DIFF_LIST_MAP[diff];
  return listKey ? { listKey } : { skip: 'unknown' };
}

module.exports = { DIFF_LIST_MAP, targetListFor };
