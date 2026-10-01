const fs = require('fs');
const path = require('path');
const { saveToFile } = require('./fileOperations');

// Pliki stanu roboczego - w .gitignore, wiec auto-update (git stash) ich
// nie rusza.
// - runtime-state.json: biezaca lokacja z rotacji + stan Shiny (logic/runtime.js)
// - shiny-stats.json: statystyki Golden Nest per lokacja (logic/shinyStats.js)
const RUNTIME_PATH = path.resolve(__dirname, '..', '..', 'config', 'runtime-state.json');
const SHINY_STATS_PATH = path.resolve(__dirname, '..', '..', 'config', 'shiny-stats.json');

// Brak pliku albo uszkodzony plik = brak danych.
function loadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

function loadRuntime(filePath = RUNTIME_PATH) {
  return loadJson(filePath);
}

async function saveRuntime(runtime, filePath = RUNTIME_PATH) {
  await saveToFile(filePath, { ...runtime, updatedAt: new Date().toISOString() });
}

function loadShinyStats(filePath = SHINY_STATS_PATH) {
  return loadJson(filePath) || {};
}

async function saveShinyStats(stats, filePath = SHINY_STATS_PATH) {
  await saveToFile(filePath, stats);
}

module.exports = {
  RUNTIME_PATH, SHINY_STATS_PATH,
  loadJson, loadRuntime, saveRuntime, loadShinyStats, saveShinyStats,
};
