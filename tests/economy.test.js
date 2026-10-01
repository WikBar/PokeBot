const test = require('node:test');
const assert = require('node:assert/strict');
const { sellOptions, isStorageNearlyFull } = require('../src/logic/storage');
const { parseYen, parseLine, analyzeLogs } = require('../src/logic/logAnalysis');

test('przechowalnia: od 95% sprzedaz bez progu', () => {
  const cfg = { sellThreshold: 10, limitsEnabled: true, diff3Keep: 5, diff4Keep: 15 };
  assert.equal(isStorageNearlyFull({ current: 2432, max: 2560 }), true);
  assert.equal(isStorageNearlyFull({ current: 2398, max: 2560 }), false);
  assert.equal(isStorageNearlyFull({ current: 0, max: 0 }), false);
  assert.deepEqual(sellOptions(cfg, { current: 2500, max: 2560 }), { ...cfg, sellThreshold: 0, forced: true });
  assert.deepEqual(sellOptions(cfg, { current: 100, max: 2560 }), { ...cfg, forced: false });
});

test('parseYen: walka i mineraly, kropka jako separator tysiecy', () => {
  assert.equal(parseYen('Wygrywasz walkę i otrzymujesz 209.847 ¥! Twoje Pokemony'), 209847);
  assert.equal(parseYen('Wykopujesz je. Otrzymujesz 442.150 Yen za sprzedaż Minerałów.'), 442150);
  assert.equal(parseYen('Otrzymujesz Pokeball'), 0);
});

test('analyzeLogs sumuje przychod', () => {
  const entries = [
    parseLine('[2.10.2026T10:00:00] [INFO] Wygrywasz walkę i otrzymujesz 1.000 ¥!'),
    parseLine('[2.10.2026T10:00:05] [INFO] Otrzymujesz 2.500 Yen za sprzedaż Minerałów.'),
  ];
  assert.equal(analyzeLogs(entries).stats.yen, 3500);
});
