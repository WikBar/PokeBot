#!/usr/bin/env node
// Analiza logow bota - wykrywa anomalie: druga instancja, przestoje po
// bledzie krytycznym, przerwy w logu, serie bledow, przerwana blokada
// Golden Nest, brak kul, pelna przechowalnia, uszkodzony zapis pliku.
//
// Uzycie:
//   npm run verify:logs                      # ostatnie 24 h
//   node scripts/verify-logs.js --since 48h
//   node scripts/verify-logs.js --file logs/app-2026-10-01.log --since all
//   node scripts/verify-logs.js --telegram   # podsumowanie na Telegram
//
// Kod wyjscia 1, gdy sa znaleziska o wadze "error".

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, process.env.NODE_ENV === 'production' ? '.env.production' : '.env') });
process.env.LOG_TO_FILE = 'false';

const { analyzeLogs } = require('../src/logic/logAnalysis');
const { listLogFiles, readEntries } = require('../src/utils/logReader');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function parseSince(value) {
  if (value === 'all') return 0;
  const m = /^(\d+)\s*([hd])$/.exec(value);
  if (!m) throw new Error(`Niepoprawne --since: ${value} (np. 24h, 2d, all)`);
  return Date.now() - Number(m[1]) * (m[2] === 'd' ? 86400000 : 3600000);
}

async function main() {
  const since = parseSince(arg('--since', '24h'));
  const fileArg = arg('--file', null);
  const files = fileArg ? [path.resolve(fileArg)] : listLogFiles(since);

  if (files.length === 0) {
    console.log('Brak plików logów w podanym okresie.');
    return;
  }

  const { entries, nullBytes } = readEntries(files);
  const { findings, stats } = analyzeLogs(entries, { since, nullBytes });
  const fmt = (ts) => (ts ? new Date(ts).toLocaleString('pl-PL', { hour12: false }) : '-');

  console.log(`Logi: ${files.map((f) => path.basename(f)).join(', ')}`);
  console.log(`Okres: ${fmt(stats.from)} → ${fmt(stats.to)}, ${stats.lines} wpisów`);
  console.log(`Starty: ${stats.starts}, błędy pętli: ${stats.errors}, krytyczne: ${stats.fatal}`);
  console.log(`Łapanie: ${stats.caught}, Golden Nest: ${stats.goldenNests} (złapane ${stats.goldenNestsCaught}), sprzedaże: ${stats.sales}\n`);

  if (findings.length === 0) console.log('Brak anomalii.');
  for (const f of findings) {
    console.log(`${f.severity === 'error' ? 'BŁĄD ' : 'UWAGA'}  [${f.rule}] ${f.message}`);
  }

  if (process.argv.includes('--telegram') && findings.length > 0) {
    const { sendNotification } = require('../src/utils/notifier');
    const lines = findings.slice(0, 10).map((f) => `- ${f.message}`);
    await sendNotification(`PokeBot - analiza logów (${findings.length}):\n${lines.join('\n')}`);
  }

  process.exitCode = findings.some((f) => f.severity === 'error') ? 1 : 0;
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 2;
});
