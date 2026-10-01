// Przechowalnia - czysta logika decyzji o sprzedazy.

// Od tego zapelnienia sprzedajemy nawet wtedy, gdy pasujacych pokemonow
// jest mniej niz sellThreshold - inaczej przy pelnej przechowalni bot
// czekalby, az uzbiera sie paczka do sprzedazy.
const FORCE_SELL_RATIO = 0.95;

function isStorageNearlyFull(storage) {
  const current = Number(storage?.current);
  const max = Number(storage?.max);
  return Number.isFinite(current) && Number.isFinite(max) && max > 0 && current / max >= FORCE_SELL_RATIO;
}

// Opcje dla SellPokemon z configu; przy prawie pelnej przechowalni prog 0.
function sellOptions(cfg, storage) {
  const forced = isStorageNearlyFull(storage);
  return {
    sellThreshold: forced ? 0 : cfg.sellThreshold,
    limitsEnabled: cfg.limitsEnabled,
    diff3Keep: cfg.diff3Keep,
    diff4Keep: cfg.diff4Keep,
    forced,
  };
}

module.exports = { FORCE_SELL_RATIO, isStorageNearlyFull, sellOptions };
