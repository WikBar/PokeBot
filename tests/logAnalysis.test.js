const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLine, analyzeLogs } = require('../src/logic/logAnalysis');

const L = (time, msg, level = 'INFO') => parseLine(`[1.10.2026T${time}] [${level}] ${msg}`);
const rules = (entries, opts) => analyzeLogs(entries, opts).findings.map((f) => f.rule);

test('parseLine - format bota, data bez zera wiodacego', () => {
  const e = parseLine('[1.10.2026T02:47:51] [INFO] Golden Nest potwierdzony: Hitmontop (poziom 100).');
  assert.equal(new Date(e.ts).getHours(), 2);
  assert.equal(e.level, 'INFO');
  assert.equal(parseLine('smieci'), null);
});

test('Fatal error bez restartu przez > 5 min (regresja 01.10: 3,5 h przestoju)', () => {
  const r = rules([
    L('12:08:23', 'Fatal error {"error":"x"}', 'ERROR'),
    L('15:33:22', 'Uruchamiam skrypt... Login to: X'),
  ]);
  assert.ok(r.includes('fatal-no-restart'));
  assert.ok(r.includes('gap'));
});

test('szybki restart po Fatal error jest OK', () => {
  const r = rules([
    L('12:08:23', 'Fatal error {"error":"x"}', 'ERROR'),
    L('12:08:30', 'Uruchamiam skrypt... Login to: X'),
  ]);
  assert.ok(!r.includes('fatal-no-restart'));
});

test('nocna przerwa serwera nie jest luka', () => {
  const r = rules([
    L('00:00:10', 'Trwa przerwa na serwerze - czekamy 30 minut'),
    L('00:30:10', 'Odnowienie PA'),
  ]);
  assert.ok(!r.includes('gap'));
});

test('przerwana blokada Golden Nest', () => {
  const r = rules([
    L('02:47:57', 'Shiny: Golden Nest (Hitmontop, poziom 100) NIE złapany - zostaję na lokacji 5 na 100 wypraw.'),
    L('02:48:03', 'Shiny: blokada po Golden Nest - zostaję na lokacji 5 jeszcze 99 wypraw.'),
    L('02:49:19', 'Zmiana wyprawy: 5 → 2 - flaga adventureChanged ustawiona.'),
  ]);
  assert.ok(r.includes('hold-broken'));
});

test('dwie instancje - przeplatajace sie proby Shiny', () => {
  const r = rules([
    L('01:14:00', 'Shiny: próba 4/20 na lokacji 4 - brak Golden Nest.'),
    L('01:14:02', 'Shiny: próba 9/20 na lokacji 2 - brak Golden Nest.'),
    L('01:14:04', 'Shiny: próba 5/20 na lokacji 4 - brak Golden Nest.'),
  ]);
  assert.deepEqual(r.filter((x) => x === 'duplicate-instance').length, 1);
});

test('normalna rotacja lokacji nie jest duplikatem', () => {
  const r = rules([
    L('01:14:00', 'Shiny: próba 20/20 na lokacji 4 - brak Golden Nest.'),
    L('01:14:01', 'Shiny: 20 wypraw bez Golden Nest → lokacja 5 (Ruiny Miasta)'),
    L('01:14:04', 'Shiny: próba 1/20 na lokacji 5 - brak Golden Nest.'),
    L('01:14:08', 'Shiny: próba 2/20 na lokacji 5 - brak Golden Nest.'),
  ]);
  assert.deepEqual(r, []);
});

test('bajty zerowe, brak kul, pelna przechowalnia', () => {
  const r = rules([
    L('10:00:00', 'Brak ultraballi i premierballi na ekranie łapania.', 'WARN'),
    L('10:00:01', 'Przechowalnia: 2550/2560'),
  ], { nullBytes: 10 });
  assert.ok(r.includes('null-bytes'));
  assert.ok(r.includes('no-balls'));
  assert.ok(r.includes('storage'));
});
