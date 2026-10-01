const fs = require('fs');
const path = require('path');
const { parseLine } = require('../logic/logAnalysis');

const LOGS_DIR = path.resolve(__dirname, '..', '..', 'logs');

// Pliki app-*.log zmienione od `since` (ms).
function listLogFiles(since = 0, dir = LOGS_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /^app-\d{4}-\d{2}-\d{2}.*\.log$/.test(f))
    .map((f) => path.join(dir, f))
    .filter((f) => fs.statSync(f).mtimeMs >= since);
}

// Wpisy z plikow posortowane po czasie + liczba bajtow zerowych (slad
// przerwanego zapisu - zanik pradu, twardy reset).
function readEntries(files) {
  const entries = [];
  let nullBytes = 0;
  for (const file of files) {
    const buf = fs.readFileSync(file);
    for (const b of buf) if (b === 0) nullBytes++;
    for (const line of buf.toString('utf8').replace(/\0+/g, '\n').split(/\r?\n/)) {
      const e = parseLine(line.trim());
      if (e) entries.push(e);
    }
  }
  entries.sort((a, b) => a.ts - b.ts);
  return { entries, nullBytes };
}

module.exports = { LOGS_DIR, listLogFiles, readEntries };
