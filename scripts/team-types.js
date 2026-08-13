// Wyszukuje typy pokemonów po nazwie (PokeAPI) i zapisuje je do config/team.json
// wraz z nazwą i poziomem.
//
// Użycie:
//   npm run team:types -- "Wishiwashi:49" "Kingambit:95" "Iron Treads:93"
//   npm run team:types                  (odświeża typy dla drużyny z team.json)
//
// PokeAPI jest darmowe i nie wymaga klucza.

const path = require('path');
const { loadFromFile, saveToFile } = require('../src/utils/fileOperations');

const TEAM_PATH = path.resolve(__dirname, '..', 'config', 'team.json');
const POKEAPI = 'https://pokeapi.co/api/v2/pokemon';

// Mapowanie typów EN -> PL. Nazwy muszą zgadzać się z types.json panelu web,
// inaczej lista rozwijana nie pokaże wartości.
const TYPE_PL = {
  normal: 'Normalny',
  fire: 'Ognisty',
  water: 'Wodny',
  electric: 'Elektryczny',
  grass: 'Trawiasty',
  ice: 'Lodowy',
  fighting: 'Walczący',
  poison: 'Trujący',
  ground: 'Ziemny',
  flying: 'Latający',
  psychic: 'Psychiczny',
  bug: 'Robak',
  rock: 'Skalny',
  ghost: 'Duchowy',
  dragon: 'Smok',
  dark: 'Mroczny',
  steel: 'Stalowy',
  fairy: 'Wróżkowy',
};

// "Iron Treads" -> "iron-treads", "Kommo-o" -> "kommo-o"
function toApiName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/\s+/g, '-');
}

// Część pokemonów występuje w PokeAPI wyłącznie pod nazwą formy
// (np. Wishiwashi -> wishiwashi-solo). Dla nich próbujemy też wariantów.
const NAME_FALLBACKS = ['-solo', '-normal', '-standard', '-ordinary', '-average'];

async function fetchTypes(name) {
  const base = toApiName(name);
  const candidates = [base, ...NAME_FALLBACKS.map((suffix) => base + suffix)];

  let data = null;
  let lastStatus = 0;
  for (const candidate of candidates) {
    const response = await fetch(`${POKEAPI}/${candidate}`);
    if (response.ok) {
      data = await response.json();
      break;
    }
    lastStatus = response.status;
  }

  if (!data) {
    throw new Error(`nie znaleziono w PokeAPI (HTTP ${lastStatus})`);
  }
  const types = (data.types || [])
    .sort((a, b) => a.slot - b.slot)
    .map((t) => TYPE_PL[t.type.name] || t.type.name);

  return { type1: types[0] || '', type2: types[1] || '' };
}

// Argumenty w formacie "Nazwa:poziom" lub samo "Nazwa".
function parseArgs(args) {
  return args.map((arg) => {
    const idx = arg.lastIndexOf(':');
    if (idx === -1) return { name: arg.trim(), level: null };
    const level = parseInt(arg.slice(idx + 1), 10);
    return Number.isNaN(level)
      ? { name: arg.trim(), level: null }
      : { name: arg.slice(0, idx).trim(), level };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const current = (await loadFromFile(TEAM_PATH))?.team || [];

  const wanted = args.length > 0
    ? parseArgs(args)
    : current.map((s) => ({ name: s.name, level: s.level ?? null }));

  if (wanted.length === 0 || wanted.every((w) => !w.name)) {
    console.error('Brak nazw pokemonów.');
    console.error('Użycie: npm run team:types -- "Wishiwashi:49" "Kingambit:95"');
    process.exit(1);
  }

  const team = [];
  for (const { name, level } of wanted) {
    if (!name) {
      team.push({ name: '', level: null, type1: '', type2: '' });
      continue;
    }
    try {
      const { type1, type2 } = await fetchTypes(name);
      const slot = { name, level, type1, type2 };
      team.push(slot);
      console.log(`${name} (${level ?? '?'} poz.) -> ${type1}${type2 ? ' / ' + type2 : ''}`);
    } catch (e) {
      const previous = current.find((s) => s.name === name);
      team.push(previous || { name, level, type1: '', type2: '' });
      console.error(`${name}: ${String(e.message || e)} — zostawiam poprzednie typy`);
    }
  }

  await saveToFile(TEAM_PATH, { team });
  console.log(`\nZapisano ${team.length} pokemonów do config/team.json`);
}

main().catch((e) => {
  console.error('BŁĄD:', String(e));
  process.exit(1);
});
