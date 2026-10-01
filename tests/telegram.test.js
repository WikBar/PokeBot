const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCommand, formatStatus, formatShiny, formatReport } = require('../src/logic/telegramCommands');
const { respond } = require('../src/utils/telegramBot');
const state = require('../src/state');

test('parseCommand: aliasy, @nazwa bota, wielkosc liter, zwykly tekst', () => {
  assert.equal(parseCommand('/pauza'), 'pause');
  assert.equal(parseCommand('/Pause@PokeBot teraz'), 'pause');
  assert.equal(parseCommand('/wznów'), 'resume');
  assert.equal(parseCommand('/szpital'), 'hospital');
  assert.equal(parseCommand('/cokolwiek'), 'unknown');
  assert.equal(parseCommand('hej'), null);
});

test('formatStatus', () => {
  const now = Date.parse('2026-10-02T10:00:00Z');
  const text = formatStatus({
    region: 'Johto', adventureNr: 5, pa: { current: 700, max: 2540 }, hp: { current: 88, max: 100 },
    shiny: { tries: 3, maxTries: 20, hold: 0 }, lastLogAt: '2026-10-02T09:58:00Z',
  }, now);
  assert.match(text, /Bot działa/);
  assert.match(text, /Johto 5/);
  assert.match(text, /PA: 700\/2540/);
  assert.match(text, /próba 3\/20/);
  assert.match(text, /2 min temu/);
  assert.match(formatStatus({ isPaused: true }), /wstrzymany/);
  assert.match(formatStatus({ shiny: { hold: 40 } }), /blokada po Golden Nest, jeszcze 40/);
});

test('formatShiny i formatReport', () => {
  assert.match(formatShiny({ region: 'Johto', runtime: null, locations: [] }), /Brak statystyk/);
  const t = formatShiny({
    region: 'Johto',
    runtime: { adventureNr: 5, shiny: { tries: 2, hold: 0 } },
    locations: [{ nr: 5, name: 'Ruiny Miasta', perThousand: 4.2, goldenNests: 3, trips: 710, caught: 1 }],
  });
  assert.match(t, /Ruiny Miasta: 4.2‰ \(3\/710, złapane 1\)/);
  const stats = { caught: 10, goldenNests: 1, errors: 0, fatal: 0 };
  assert.match(formatReport({ findings: [], stats }), /Brak anomalii/);
  assert.match(formatReport({ findings: [{ message: 'X' }], stats }), /- X/);
});

test('respond: pauza i wznowienie przez flagi stanu', () => {
  respond('pause');
  assert.equal(state.getState().isPaused, true);
  respond('resume');
  assert.equal(state.getState().isPaused, false);
  respond('hospital');
  assert.equal(state.getState().forceHospital, true);
  state.setForceHospital(false);
  assert.match(respond('unknown'), /Nieznana komenda/);
});
