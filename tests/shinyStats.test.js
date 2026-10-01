const test = require('node:test');
const assert = require('node:assert/strict');
const { recordTrip, summarize } = require('../src/logic/shinyStats');
const { reportMissingBall, _reset } = require('../src/utils/ballAlerts');

test('recordTrip liczy wyprawy i Golden Nesty per lokacja', () => {
  let s = {};
  for (let i = 0; i < 9; i++) s = recordTrip(s, { region: 'Johto', location: 5, name: 'Ruiny Miasta' });
  s = recordTrip(s, { region: 'Johto', location: 5, name: 'Ruiny Miasta', goldenNest: true, caught: false, at: 'T' });
  s = recordTrip(s, { region: 'Johto', location: 2, name: 'Puszcza' });
  assert.deepEqual(s.Johto['5'], { name: 'Ruiny Miasta', trips: 10, goldenNests: 1, caught: 0, lastGoldenNest: 'T' });
  assert.equal(s.Johto['2'].trips, 1);
});

test('recordTrip nie modyfikuje wejscia', () => {
  const s = {};
  recordTrip(s, { region: 'Johto', location: 1 });
  assert.deepEqual(s, {});
});

test('summarize sortuje po czestotliwosci Golden Nest', () => {
  let s = {};
  for (let i = 0; i < 100; i++) s = recordTrip(s, { region: 'Johto', location: 1, goldenNest: i === 0 });
  for (let i = 0; i < 100; i++) s = recordTrip(s, { region: 'Johto', location: 3, goldenNest: i < 3 });
  const list = summarize(s, 'Johto');
  assert.deepEqual(list.map((l) => l.nr), [3, 1]);
  assert.equal(list[0].perThousand, 30);
  assert.deepEqual(summarize(s, 'Kanto'), []);
});

test('alarm o braku kuli - raz dziennie na rodzaj', async () => {
  _reset();
  const day = new Date(2026, 9, 2, 10);
  assert.equal(await reportMissingBall('ultraballe', day), true);
  assert.equal(await reportMissingBall('ultraballe', day), false);
  assert.equal(await reportMissingBall('cherishballe', day), true);
  assert.equal(await reportMissingBall('ultraballe', new Date(2026, 9, 3, 10)), true);
});
