const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createShinyState, shinyStep, maxTriesFrom,
  SHINY_HOLD_ITERATIONS, SHINY_HOLD_NOTIFY_EVERY, SHINY_HUNT_TRIES_DEFAULT,
} = require('../src/logic/shiny');

const run = (st, n, ev) => {
  let action;
  for (let i = 0; i < n; i++) ({ state: st, action } = shinyStep(st, ev));
  return { state: st, action };
};

test('proby bez Golden Nest - zmiana lokacji po maxTries', () => {
  const ev = { adventureNr: 3, maxTries: 5 };
  let r = run(createShinyState(3), 4, ev);
  assert.equal(r.action.type, 'try');
  assert.equal(r.state.tries, 4);
  r = shinyStep(r.state, ev);
  assert.equal(r.action.type, 'advance');
  assert.equal(r.action.reason, 'tries');
  assert.equal(r.state.tries, 0);
});

test('Golden Nest zlapany - od razu zmiana lokacji', () => {
  const r = shinyStep({ tries: 7, hold: 0, locationNr: 2 }, { adventureNr: 2, goldenNestFound: true, goldenNestCaught: true, maxTries: 20 });
  assert.deepEqual(r.action, { type: 'advance', reason: 'caught' });
  assert.equal(r.state.tries, 0);
});

test('Golden Nest nie zlapany - blokada i odliczanie z raportem co N', () => {
  let r = shinyStep(createShinyState(5), { adventureNr: 5, goldenNestFound: true, maxTries: 20 });
  assert.equal(r.action.type, 'holdStart');
  assert.equal(r.state.hold, SHINY_HOLD_ITERATIONS);

  r = run(r.state, SHINY_HOLD_NOTIFY_EVERY, { adventureNr: 5, maxTries: 20 });
  assert.equal(r.action.type, 'hold');
  assert.equal(r.action.notify, true);
  assert.equal(r.state.hold, SHINY_HOLD_ITERATIONS - SHINY_HOLD_NOTIFY_EVERY);

  // Blokada nie zmienia lokacji, nawet po wielu wyprawach ponad maxTries.
  r = run(r.state, SHINY_HOLD_ITERATIONS - SHINY_HOLD_NOTIFY_EVERY, { adventureNr: 5, maxTries: 20 });
  assert.equal(r.action.type, 'hold');
  assert.equal(r.action.notify, false);   // przy zerze bez raportu
  assert.equal(r.state.hold, 0);

  r = shinyStep(r.state, { adventureNr: 5, maxTries: 20 });
  assert.equal(r.action.type, 'try');
});

test('zmiana lokacji z panelu kasuje proby i blokade', () => {
  const r = shinyStep({ tries: 10, hold: 40, locationNr: 2 }, { adventureNr: 4, maxTries: 20 });
  assert.equal(r.action.type, 'try');
  assert.equal(r.state.tries, 1);
  assert.equal(r.state.hold, 0);
  assert.equal(r.state.locationNr, 4);
});

test('maxTriesFrom - domyslna wartosc i minimum 1', () => {
  assert.equal(maxTriesFrom({}), SHINY_HUNT_TRIES_DEFAULT);
  assert.equal(maxTriesFrom({ shinyHuntTries: 0 }), SHINY_HUNT_TRIES_DEFAULT);
  assert.equal(maxTriesFrom({ shinyHuntTries: -3 }), 1);
  assert.equal(maxTriesFrom({ shinyHuntTries: 30 }), 30);
});
