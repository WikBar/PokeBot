// Walidator plikow konfiguracyjnych - bez bibliotek, bez Playwrighta.
// Uzywany przez bota (start + kazde przeladowanie), panel (POST /api/config),
// scripts/verify-config.js i auto-update.sh.
//
// Kazda funkcja zwraca { errors: string[], warnings: string[] }.
// errors = bot nie moze bezpiecznie dzialac na tym configu,
// warnings = dziala, ale cos jest prawdopodobnie nie tak.

const LIST_KEYS = [
  'sellablePokemon', 'protectedPokemon',
  'diff0CatchPokemons', 'diff3CatchPokemons', 'diff4CatchPokemons', 'diff5CatchPokemons',
  'strongBallPokemons',
];

// Listy, ktore bot tylko uzupelnia - zadna decyzja z nich nie korzysta.
const WRITE_ONLY_LISTS = ['diff0CatchPokemons', 'diff5CatchPokemons'];

// [klucz, min, max, czyCalkowita, wymagany]
const NUMBER_RULES = [
  ['adventureNr', 1, Infinity, true, true],
  ['pokemonIndex', 0, 5, true, true],
  ['SecondPokemonIndex', 0, 5, true, true],
  ['secondPokMaxLv', 1, 100, false, false],
  ['paBuffer', 0, Infinity, false, false],
  ['sellThreshold', 0, Infinity, false, false],
  ['diff3Keep', 0, Infinity, true, false],
  ['diff4Keep', 0, Infinity, true, false],
  ['autoRepelTier', 1, 3, true, false],
  ['autoRepelMin', 0, Infinity, false, false],
  ['adventureDelay', 300, Infinity, false, false],
  ['shinyHuntTries', 1, Infinity, true, false],
  ['marketScanMinutes', 15, Infinity, false, false],
];

const BOOL_KEYS = [
  'randomAdventure', 'limitsEnabled', 'autoRepelEnabled', 'saveSafariBall', 'shinyHunt',
  'marketScanEnabled',
];

const ENUM_RULES = [
  ['autoRepelKind', ['repel', 'tepel']],
  ['activityMode', ['trening', 'praca']],
];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const norm = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();

function validateLocations(locations) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(locations)) {
    return { errors: ['locations.json: brak pliku albo niepoprawny JSON'], warnings };
  }
  for (const [regionName, region] of Object.entries(locations)) {
    if (!isPlainObject(region) || Object.keys(region).length === 0) {
      errors.push(`locations.json: region ${regionName} nie ma lokacji`);
      continue;
    }
    for (const [key, loc] of Object.entries(region)) {
      const where = `locations.json: ${regionName}/${key}`;
      if (!/^\d+$/.test(key)) errors.push(`${where}: klucz lokacji musi być liczbą`);
      if (!isPlainObject(loc)) { errors.push(`${where}: niepoprawny wpis`); continue; }
      if (typeof loc.name !== 'string' || !loc.name.trim()) errors.push(`${where}: brak nazwy`);
      if (!Number.isFinite(loc.requiredPA) || loc.requiredPA <= 0) errors.push(`${where}: requiredPA musi być liczbą > 0`);
      if (loc.isSpecial !== undefined && typeof loc.isSpecial !== 'boolean') errors.push(`${where}: isSpecial musi być true/false`);
    }
  }
  return { errors, warnings };
}

// team - opcjonalnie tablica slotow z team.json (do ostrzezen o sprzedazy
// pokemonow z druzyny).
function validateConfig(cfg, locations, team = null) {
  const errors = [];
  const warnings = [];

  if (!isPlainObject(cfg)) {
    return { errors: ['config.json: brak pliku albo niepoprawny JSON'], warnings };
  }

  // Region i lokacja - bez nich petla glowna rzuca wyjatek w kolko.
  const regions = isPlainObject(locations) ? locations : {};
  const region = regions[cfg.region];
  if (typeof cfg.region !== 'string' || !region) {
    errors.push(`region "${cfg.region}" nie istnieje w locations.json (dostępne: ${Object.keys(regions).join(', ')})`);
  }

  for (const [key, min, max, integer, required] of NUMBER_RULES) {
    const v = cfg[key];
    if (v === undefined || v === null) {
      if (required) errors.push(`${key}: brak wartości`);
      continue;
    }
    // Liczba zapisana jako tekst psuje porownania === w bocie.
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors.push(`${key}: musi być liczbą (jest ${JSON.stringify(v)})`);
      continue;
    }
    if (integer && !Number.isInteger(v)) errors.push(`${key}: musi być liczbą całkowitą (jest ${v})`);
    if (v < min || v > max) {
      errors.push(`${key}: ${v} poza zakresem ${min}-${max === Infinity ? '∞' : max}`);
    }
  }

  if (region && Number.isInteger(cfg.adventureNr) && !region[String(cfg.adventureNr)]) {
    errors.push(`adventureNr ${cfg.adventureNr} nie istnieje w regionie ${cfg.region} (dostępne: ${Object.keys(region).join(', ')})`);
  }

  for (const key of BOOL_KEYS) {
    if (cfg[key] !== undefined && typeof cfg[key] !== 'boolean') {
      errors.push(`${key}: musi być true/false (jest ${JSON.stringify(cfg[key])})`);
    }
  }

  for (const [key, allowed] of ENUM_RULES) {
    if (cfg[key] !== undefined && !allowed.includes(cfg[key])) {
      errors.push(`${key}: "${cfg[key]}" - dozwolone: ${allowed.join(', ')}`);
    }
  }

  // Rotacja lokacji potrzebuje choc jednej nie-specjalnej lokacji.
  if (region && (cfg.shinyHunt || cfg.randomAdventure)) {
    const nonSpecial = Object.values(region).filter((l) => !l?.isSpecial);
    if (nonSpecial.length === 0) {
      errors.push(`region ${cfg.region} nie ma nie-specjalnych lokacji, a shinyHunt/randomAdventure są włączone`);
    }
  }

  if (cfg.skippedAdventures !== undefined) {
    if (!Array.isArray(cfg.skippedAdventures)) {
      errors.push('skippedAdventures: musi być listą numerów');
    } else if (region) {
      const outside = cfg.skippedAdventures.filter((n) => !region[String(n)]);
      if (outside.length) warnings.push(`skippedAdventures: ${outside.join(', ')} - brak takich lokacji w regionie ${cfg.region}`);
      const nonSpecialKeys = Object.entries(region).filter(([, l]) => !l?.isSpecial).map(([k]) => Number(k));
      if (nonSpecialKeys.length && nonSpecialKeys.every((k) => cfg.skippedAdventures.map(Number).includes(k))) {
        warnings.push('skippedAdventures: pominięto wszystkie lokacje - bot zignoruje tę listę');
      }
    }
  }

  // Listy pokemonow.
  const lists = {};
  for (const key of LIST_KEYS) {
    const v = cfg[key];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
      errors.push(`${key}: musi być listą nazw (tekstów)`);
      continue;
    }
    const empty = v.filter((x) => !x.trim());
    if (empty.length) warnings.push(`${key}: ${empty.length} pustych wpisów`);
    const seen = new Set();
    const dups = new Set();
    for (const name of v) {
      const n = norm(name);
      if (seen.has(n)) dups.add(name);
      seen.add(n);
    }
    if (dups.size) warnings.push(`${key}: duplikaty - ${[...dups].join(', ')}`);
    lists[key] = new Set(v.map(norm));
  }

  // Nakladanie list - bot wtedy robi cos innego niz sugeruje lista.
  const overlap = (a, b, msg) => {
    if (!lists[a] || !lists[b]) return;
    const both = (cfg[a] || []).filter((n) => lists[b].has(norm(n)));
    if (both.length) warnings.push(`${a} i ${b}: ${[...new Set(both)].join(', ')} - ${msg}`);
  };
  overlap('sellablePokemon', 'protectedPokemon', 'chronione, więc nie zostaną sprzedane');
  overlap('sellablePokemon', 'diff3CatchPokemons', 'sprzedaż wygrywa, limit diff3Keep nie działa');
  overlap('sellablePokemon', 'diff4CatchPokemons', 'sprzedaż wygrywa, limit diff4Keep nie działa');
  overlap('diff3CatchPokemons', 'diff4CatchPokemons', 'limit diff3 liczony przed diff4');

  // Pokemony z druzyny na liscie sprzedazy - lapane okazy pojda do sprzedazy
  // (pokemony w druzynie nie sa w Hodowli, ale to zwykle pomylka).
  if (Array.isArray(team) && lists.sellablePokemon) {
    const inTeam = team
      .map((s) => s?.name)
      .filter((n) => n && lists.sellablePokemon.has(norm(n)) && !(lists.protectedPokemon && lists.protectedPokemon.has(norm(n))));
    if (inTeam.length) warnings.push(`sellablePokemon zawiera pokemony z drużyny: ${inTeam.join(', ')}`);
  }

  for (const key of WRITE_ONLY_LISTS) {
    if (Array.isArray(cfg[key]) && cfg[key].length) {
      warnings.push(`${key}: lista tylko uzupełniana - bot z niej nie korzysta przy decyzjach`);
    }
  }

  if (cfg.adventureChanged === true) {
    warnings.push('adventureChanged: true zapisane na dysku - to flaga robocza bota, nie ustawienie');
  }

  return { errors, warnings };
}

const TEAM_SIZE = 6;

// validTypes - lista dopuszczalnych nazw typow (TYPE_PL + aliasy z gry).
function validateTeam(teamFile, validTypes = null) {
  const errors = [];
  const warnings = [];
  const team = teamFile?.team;
  if (!Array.isArray(team)) {
    return { errors: ['team.json: brak listy "team"'], warnings };
  }
  if (team.length !== TEAM_SIZE) errors.push(`team.json: ${team.length} slotów zamiast ${TEAM_SIZE}`);
  team.forEach((slot, i) => {
    const where = `team.json: slot ${i + 1}`;
    if (!isPlainObject(slot)) { errors.push(`${where}: niepoprawny wpis`); return; }
    if (!slot.name) return;   // pusty slot jest dozwolony
    if (slot.level !== null && slot.level !== undefined && !(Number.isInteger(slot.level) && slot.level >= 1 && slot.level <= 100)) {
      errors.push(`${where} (${slot.name}): poziom ${slot.level} poza zakresem 1-100`);
    }
    for (const t of ['type1', 'type2']) {
      if (slot[t] && validTypes && !validTypes.includes(slot[t])) {
        warnings.push(`${where} (${slot.name}): nieznany typ "${slot[t]}"`);
      }
    }
    if (!slot.type1) warnings.push(`${where} (${slot.name}): brak typu - wspólny typ nie zadziała`);
    if (slot.type1 && slot.type1 === slot.type2) errors.push(`${where} (${slot.name}): type1 i type2 są takie same`);
  });
  return { errors, warnings };
}

module.exports = { validateConfig, validateLocations, validateTeam, LIST_KEYS };
