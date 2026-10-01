const fs = require('fs');
const path = require('path');
const { saveToFile } = require('./fileOperations');

// Plik stanu roboczego - patrz logic/runtime.js. W .gitignore, wiec
// auto-update (git stash) go nie rusza.
const RUNTIME_PATH = path.resolve(__dirname, '..', '..', 'config', 'runtime-state.json');

// Brak pliku albo uszkodzony plik = brak stanu (bot zacznie od configu).
function loadRuntime(filePath = RUNTIME_PATH) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

async function saveRuntime(runtime, filePath = RUNTIME_PATH) {
  await saveToFile(filePath, { ...runtime, updatedAt: new Date().toISOString() });
}

module.exports = { RUNTIME_PATH, loadRuntime, saveRuntime };
