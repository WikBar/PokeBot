const test = require('node:test');
const assert = require('node:assert/strict');
const { targetListFor } = require('../src/logic/categorize');
const { decideRepelUse } = require('../src/logic/repel');
const { sharesType, findMatchingTeamIndex } = require('../src/actions/team');

test('kategoryzacja: diff 1-2 do sprzedazy, chronione pomijane, 3-5 do list', () => {
  assert.deepEqual(targetListFor(1, 'Zubat'), { listKey: 'sellablePokemon' });
  assert.deepEqual(targetListFor(2, 'Flabébé', ['Flabébé']), { skip: 'protected' });
  assert.deepEqual(targetListFor(3, 'Stunfisk'), { listKey: 'diff3CatchPokemons' });
  assert.deepEqual(targetListFor(5, 'Sawk'), { listKey: 'diff5CatchPokemons' });
  assert.deepEqual(targetListFor(4, ''), { skip: 'unknown' });
});

test('repel: zlecenie z panelu ma pierwszenstwo', () => {
  const r = decideRepelUse({ repel: { value: 50 }, useRepelRequest: { kind: 'tepel', tier: 2 } }, { autoRepelEnabled: false });
  assert.deepEqual(r.use, { kind: 'tepel', tier: 2 });
  assert.equal(r.source, 'panel');
});

test('repel: wylaczony / licznik wystarczy / brak licznika', () => {
  assert.equal(decideRepelUse({ repel: { value: 0 } }, { autoRepelEnabled: false }).skip, 'disabled');
  assert.equal(decideRepelUse({ repel: { value: 5 } }, { autoRepelMin: 2 }).skip, 'enough');
  assert.deepEqual(decideRepelUse({ repel: null }, {}).use, { kind: 'repel', tier: 1 });
});

test('repel: zapas z innego poziomu albo brak w plecaku', () => {
  const cfg = { autoRepelKind: 'repel', autoRepelTier: 3, autoRepelMin: 2 };
  const r = decideRepelUse({ repel: { value: 1 }, stock: { 'repel-1': 0, 'repel-2': 4, 'repel-3': 0 } }, cfg);
  assert.deepEqual(r.use, { kind: 'repel', tier: 2 });
  assert.equal(r.fallbackFrom, 3);
  assert.equal(decideRepelUse({ repel: { value: 1 }, stock: {} }, cfg).skip, 'noStock');
});

test('wspolny typ: nazwy typow z gry (Smoczy, Robaczy, Kamienny, Duch) pasuja do druzyny (regresja)', () => {
  assert.equal(sharesType(['Smoczy'], { type1: 'Smok', type2: 'Walczący' }), true);
  assert.equal(sharesType(['Robaczy'], { type1: 'Robak' }), true);
  assert.equal(sharesType(['Kamienny', 'Lodowy'], { type1: 'Skalny' }), true);
  assert.equal(sharesType(['Duch'], { type1: 'Duchowy' }), true);
  assert.equal(sharesType(['Wodny'], { type1: 'Ognisty' }), false);
});

test('findMatchingTeamIndex wybiera najwyzszy poziom', () => {
  const team = [
    { name: 'A', level: 40, type1: 'Smok' },
    { name: 'B', level: 90, type1: 'Smok' },
    { name: '', level: null, type1: '' },
  ];
  assert.equal(findMatchingTeamIndex(team, ['Smoczy']), 1);
  assert.equal(findMatchingTeamIndex(team, ['Wodny']), -1);
});
