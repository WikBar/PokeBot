#!/usr/bin/env node
// Sprawdza config/config.json, locations.json i team.json.
//
// Uzycie:
//   npm run verify:config            # bledy -> kod wyjscia 1
//   node scripts/verify-config.js --dir /sciezka/do/config
//
// Uruchamiany tez przez auto-update.sh po pobraniu nowej wersji - przy
// bledach aktualizacja jest wycofywana.

process.env.LOG_TO_FILE = process.env.LOG_TO_FILE || 'false';

const fs = require('fs');
const path = require('path');
const { validateConfig, validateLocations, validateTeam } = require('../src/validation/config');
const { TYPE_PL, TYPE_ALIASES } = require('../src/actions/team');

function readJson(file) {
  if (!fs.existsSync(file)) return { missing: true };
  const raw = fs.readFileSync(file);
  // Plik wypelniony zerami po zaniku pradu - osobny komunikat, bo JSON.parse
  // daje tu malo czytelny blad.
  if (raw.length > 0 && raw.every((b) => b === 0)) return { error: 'plik zawiera same bajty zerowe (uszkodzony zapis)' };
  try {
    return { data: JSON.parse(raw.toString('utf8')) };
  } catch (e) {
    return { error: `niepoprawny JSON - ${e.message}` };
  }
}

function main() {
  const dirArg = process.argv.indexOf('--dir');
  const dir = dirArg !== -1 ? path.resolve(process.argv[dirArg + 1]) : path.resolve(__dirname, '..', 'config');

  const errors = [];
  const warnings = [];
  const collect = (prefix, res) => {
    errors.push(...res.errors.map((e) => (e.startsWith(prefix) ? e : `${prefix}: ${e}`)));
    warnings.push(...res.warnings.map((w) => (w.startsWith(prefix) ? w : `${prefix}: ${w}`)));
  };

  const locations = readJson(path.join(dir, 'locations.json'));
  const config = readJson(path.join(dir, 'config.json'));
  const team = readJson(path.join(dir, 'team.json'));

  if (locations.missing || locations.error) {
    errors.push(`locations.json: ${locations.error || 'brak pliku'}`);
  } else {
    collect('locations.json', validateLocations(locations.data));
  }

  if (config.missing || config.error) {
    errors.push(`config.json: ${config.error || 'brak pliku'}`);
  } else {
    collect('config.json', validateConfig(config.data, locations.data, team.data?.team));
  }

  // team.json jest w .gitignore - na swiezym klonie moze go nie byc.
  if (team.error) {
    errors.push(`team.json: ${team.error}`);
  } else if (team.data) {
    const validTypes = [...Object.values(TYPE_PL), ...Object.keys(TYPE_ALIASES)];
    collect('team.json', validateTeam(team.data, validTypes));
  }

  for (const w of warnings) console.log(`UWAGA  ${w}`);
  for (const e of errors) console.log(`BŁĄD   ${e}`);
  console.log(errors.length
    ? `\nWeryfikacja configu: ${errors.length} błędów, ${warnings.length} ostrzeżeń.`
    : `\nWeryfikacja configu: OK (${warnings.length} ostrzeżeń).`);
  process.exit(errors.length ? 1 : 0);
}

main();
