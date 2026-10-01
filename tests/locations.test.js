const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { pickNextLocation, isSpecialLocationDay } = require('../src/logic/locations');

const johto = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'locations.json'), 'utf8')).Johto;

test('rotacja po nie-specjalnych lokacjach z zawinieciem', () => {
  assert.deepEqual(pickNextLocation(johto, 1).nr, 2);
  assert.deepEqual(pickNextLocation(johto, 5).nr, 1);   // 6 jest specjalna
  assert.equal(pickNextLocation(johto, 4).name, johto['5'].name);
});

test('pominiete lokacje sa omijane', () => {
  assert.equal(pickNextLocation(johto, 1, [2, 3]).nr, 4);
  assert.equal(pickNextLocation(johto, 5, ['1']).nr, 2);
});

test('wszystkie pominiete - filtr ignorowany', () => {
  const r = pickNextLocation(johto, 2, [1, 2, 3, 4, 5]);
  assert.equal(r.nr, 3);
  assert.equal(r.ignoredSkipped, true);
});

test('biezaca lokacja specjalna albo pominieta - pierwsza dostepna', () => {
  assert.equal(pickNextLocation(johto, 6).nr, 1);
  assert.equal(pickNextLocation(johto, 2, [2]).nr, 1);
});

test('fromStart - zawsze pierwsza dostepna', () => {
  assert.equal(pickNextLocation(johto, 4, [1], { fromStart: true }).nr, 2);
});

test('region bez nie-specjalnych lokacji - null', () => {
  assert.equal(pickNextLocation({ 1: { name: 'X', requiredPA: 10, isSpecial: true } }, 1), null);
});

test('lokacje specjalne tylko pt/sob/nd', () => {
  assert.equal(isSpecialLocationDay(new Date(2026, 9, 2)), true);   // piatek
  assert.equal(isSpecialLocationDay(new Date(2026, 9, 4)), true);   // niedziela
  assert.equal(isSpecialLocationDay(new Date(2026, 9, 5)), false);  // poniedzialek
});
