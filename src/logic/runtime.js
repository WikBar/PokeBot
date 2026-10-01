// Stan roboczy bota (config/runtime-state.json) - czysta logika.
//
// config.json trzyma ustawienia uzytkownika, a biezaca lokacje z rotacji
// (tryb Shiny / randomAdventure) i stan Shiny trzymamy osobno:
// - auto-update (git stash) nie kasuje ich przy kazdej aktualizacji,
// - restart nie gubi blokady Golden Nest,
// - zapis configu w edytorze / panelu ze stara wartoscia adventureNr nie
//   przestawia lokacji, ktora bot wybral sam.
//
// Ksztalt: { region, baseAdventureNr, adventureNr, shiny, updatedAt }
// baseAdventureNr = adventureNr z configu, od ktorego zaczela sie rotacja.
// Gdy uzytkownik zmieni region albo adventureNr w configu, stan sie resetuje.

function freshRuntime(cfg) {
  return { region: cfg.region, baseAdventureNr: cfg.adventureNr, adventureNr: cfg.adventureNr, shiny: null };
}

// Zwraca { runtime, status }, status: 'kept' | 'new' | 'reset' | 'invalid'.
// region - lokacje regionu z locations.json (do sprawdzenia, czy zapisana
// lokacja nadal istnieje).
function resolveRuntime(cfg, saved, region) {
  if (!saved || typeof saved !== 'object') return { runtime: freshRuntime(cfg), status: 'new' };
  if (saved.region !== cfg.region || saved.baseAdventureNr !== cfg.adventureNr) {
    return { runtime: freshRuntime(cfg), status: 'reset' };
  }
  if (!Number.isInteger(saved.adventureNr) || !region?.[String(saved.adventureNr)]) {
    return { runtime: freshRuntime(cfg), status: 'invalid' };
  }
  return { runtime: saved, status: 'kept' };
}

module.exports = { freshRuntime, resolveRuntime };
