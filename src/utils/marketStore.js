const fs = require('fs');
const path = require('path');
const { saveToFile } = require('./fileOperations');

// Historia ofert targu: config/market-history.jsonl (poza gitem), jedna
// obserwacja na linie: { id, item, unitPrice, quantity, seller, ts }.
// Dopisywanie linii jest tanie; przy wczytaniu odrzucamy wpisy starsze niz
// KEEP_DAYS i od czasu do czasu przepisujemy plik bez nich.
const HISTORY_PATH = path.resolve(__dirname, '..', '..', 'config', 'market-history.jsonl');
const SUMMARY_PATH = path.resolve(__dirname, '..', '..', 'config', 'market-summary.json');
const KEEP_DAYS = 14;

function loadHistory(filePath = HISTORY_PATH, now = Date.now()) {
  if (!fs.existsSync(filePath)) return [];
  const since = now - KEEP_DAYS * 86400000;
  const out = [];
  let dropped = 0;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o.ts >= since) out.push(o); else dropped++;
    } catch {
      dropped++;   // uszkodzona linia (np. przerwany zapis)
    }
  }
  // Stare/uszkodzone wpisy stanowia wiekszosc pliku - przepisujemy go.
  if (dropped > out.length) {
    fs.writeFileSync(filePath, out.map((o) => JSON.stringify(o)).join('\n') + (out.length ? '\n' : ''), 'utf8');
  }
  return out;
}

function appendHistory(observations, filePath = HISTORY_PATH) {
  if (!observations.length) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, observations.map((o) => JSON.stringify(o)).join('\n') + '\n', 'utf8');
}

function loadSummary(filePath = SUMMARY_PATH) {
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null;
  } catch {
    return null;
  }
}

async function saveSummary(summary, filePath = SUMMARY_PATH) {
  await saveToFile(filePath, summary);
}

module.exports = { HISTORY_PATH, SUMMARY_PATH, KEEP_DAYS, loadHistory, appendHistory, loadSummary, saveSummary };
