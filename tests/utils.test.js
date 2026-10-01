const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { saveToFile, loadFromFile } = require('../src/utils/fileOperations');
const { acquireLock, releaseLock, isProcessAlive } = require('../src/utils/instanceLock');
const { parseItemLabel, thresholdFor } = require('../src/actions/equipment');
const { getDailyRunKey, isLeagueBlockedNow } = require('../src/dailyActions');
const { buildGoldenNestMessage, buildShinyHoldMessage } = require('../src/utils/notifier');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pokebot-test-'));

test('saveToFile zapisuje atomowo i nie zostawia pliku .tmp', async () => {
  const dir = tmp();
  try {
    const file = path.join(dir, 'c.json');
    await saveToFile(file, { a: 1 });
    await saveToFile(file, { a: 2, lista: ['x'] });
    assert.deepEqual(await loadFromFile(file), { a: 2, lista: ['x'] });
    assert.deepEqual(fs.readdirSync(dir), ['c.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadFromFile zwraca undefined dla pliku z samymi zerami', async () => {
  const dir = tmp();
  try {
    const file = path.join(dir, 'c.json');
    fs.writeFileSync(file, Buffer.alloc(64));
    assert.equal(await loadFromFile(file), undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('blokada instancji: zywy PID blokuje, martwy jest przejmowany', () => {
  const dir = tmp();
  try {
    const lock = path.join(dir, 'bot.lock');
    assert.equal(acquireLock(lock, 111111).ok, true);
    // "Inny" proces = biezacy, ktory na pewno zyje.
    fs.writeFileSync(lock, String(process.pid));
    const r = acquireLock(lock, 222222);
    assert.equal(r.ok, false);
    assert.equal(r.pid, process.pid);
    // Martwy PID - przejmujemy.
    fs.writeFileSync(lock, '999999999');
    assert.equal(acquireLock(lock, 222222).ok, true);
    releaseLock(lock, 222222);
    assert.equal(fs.existsSync(lock), false);
    assert.equal(isProcessAlive(process.pid), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parseItemLabel: oba formaty i "X Atak III"', () => {
  assert.deepEqual(parseItemLabel('1 679 x Pokeballe'), { name: 'Pokeballe', value: 1679 });
  assert.deepEqual(parseItemLabel('x3 Leftovers'), { name: 'Leftovers', value: 3 });
  assert.equal(parseItemLabel('X Atak III').name, 'X Atak III');
});

test('thresholdFor: wlasny prog, potem default', () => {
  assert.equal(thresholdFor({ Ultraballe: 100, default: 0 }, 'Ultraballe'), 100);
  assert.equal(thresholdFor({ default: 7 }, 'Cokolwiek'), 7);
});

test('dzien daily zmienia sie o 00:40', () => {
  assert.equal(getDailyRunKey(new Date(2026, 9, 2, 0, 39)), '2026-10-01');
  assert.equal(getDailyRunKey(new Date(2026, 9, 2, 0, 40)), '2026-10-02');
});

test('liga zablokowana w poniedzialek przed 13:00', () => {
  assert.equal(isLeagueBlockedNow(new Date(2026, 9, 5, 12, 59)), true);
  assert.equal(isLeagueBlockedNow(new Date(2026, 9, 5, 13, 0)), false);
  assert.equal(isLeagueBlockedNow(new Date(2026, 9, 6, 9, 0)), false);
});

test('powiadomienia podaja przekazana lokacje', () => {
  assert.match(buildGoldenNestMessage({ region: 'Johto', location: 'Ruiny Miasta', pokemon: 'Hitmontop', level: 100 }), /w lokacji Ruiny Miasta spotkano Shiny pokemona Hitmontop/);
  assert.match(buildShinyHoldMessage({ location: 'Wulkan', remaining: 40 }), /Wulkan jeszcze 40/);
});
