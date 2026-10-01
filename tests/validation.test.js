const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { validateConfig, validateLocations, validateTeam } = require('../src/validation/config');

const ROOT = path.join(__dirname, '..');
const locations = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'locations.json'), 'utf8'));

const base = () => ({
  region: 'Johto', adventureNr: 4, pokemonIndex: 3, SecondPokemonIndex: 2,
  sellablePokemon: ['Zubat'], protectedPokemon: [],
});

test('poprawny config - bez bledow', () => {
  assert.deepEqual(validateConfig(base(), locations).errors, []);
});

test('obecne config/locations.json jest poprawne', () => {
  assert.deepEqual(validateLocations(locations).errors, []);
});

test('brak configu / zly region / lokacja spoza regionu', () => {
  assert.equal(validateConfig(undefined, locations).errors.length, 1);
  assert.match(validateConfig({ ...base(), region: 'Mars' }, locations).errors.join(), /region "Mars"/);
  assert.match(validateConfig({ ...base(), adventureNr: 9 }, locations).errors.join(), /adventureNr 9 nie istnieje/);
});

test('liczba jako tekst to blad (porownania === w bocie)', () => {
  assert.match(validateConfig({ ...base(), adventureNr: '4' }, locations).errors.join(), /adventureNr: musi być liczbą/);
});

test('zakresy i enumy', () => {
  const errs = validateConfig({
    ...base(), pokemonIndex: 6, autoRepelTier: 4, adventureDelay: 100, shinyHuntTries: 0,
    autoRepelKind: 'spray', activityMode: 'spanie', shinyHunt: 'tak',
  }, locations).errors.join('\n');
  for (const key of ['pokemonIndex', 'autoRepelTier', 'adventureDelay', 'shinyHuntTries', 'autoRepelKind', 'activityMode', 'shinyHunt']) {
    assert.match(errs, new RegExp(key));
  }
});

test('ostrzezenia: nakladanie list, duplikaty, druzyna na sprzedazy, flaga robocza', () => {
  const cfg = {
    ...base(),
    sellablePokemon: ['Houndour', 'Goodra', 'zubat', 'Zubat'],
    diff3CatchPokemons: ['Houndour'],
    adventureChanged: true,
  };
  const { errors, warnings } = validateConfig(cfg, locations, [{ name: 'Goodra' }]);
  assert.deepEqual(errors, []);
  const w = warnings.join('\n');
  assert.match(w, /sellablePokemon i diff3CatchPokemons: Houndour/);
  assert.match(w, /duplikaty/);
  assert.match(w, /z drużyny: Goodra/);
  assert.match(w, /adventureChanged/);
});

test('druzyna: rozmiar, poziom, takie same typy', () => {
  const team = { team: [{ name: 'A', level: 120, type1: 'Smok', type2: 'Smok' }] };
  const errs = validateTeam(team, ['Smok']).errors.join('\n');
  assert.match(errs, /1 slotów zamiast 6/);
  assert.match(errs, /poziom 120/);
  assert.match(errs, /takie same/);
});

test('verify-config.js: plik z samymi zerami -> kod 1', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokebot-verify-'));
  try {
    fs.copyFileSync(path.join(ROOT, 'config', 'locations.json'), path.join(dir, 'locations.json'));
    fs.writeFileSync(path.join(dir, 'config.json'), Buffer.alloc(100));
    let code = 0;
    let out = '';
    try {
      execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'verify-config.js'), '--dir', dir], { encoding: 'utf8' });
    } catch (e) {
      code = e.status;
      out = e.stdout;
    }
    assert.equal(code, 1);
    assert.match(out, /bajty zerowe/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
