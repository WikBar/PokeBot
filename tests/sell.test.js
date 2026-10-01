const test = require('node:test');
const assert = require('node:assert/strict');
const { planSale, extractName } = require('../src/logic/sell');

const btn = (name, level = 20) => `${name} ♂\n${level} poz`;

test('extractName usuwa plec, poziom i liczby', () => {
  assert.equal(extractName('Meowth Alola ♀\n55 poz'), 'Meowth Alola');
  assert.equal(extractName('Typhlosion 87'), 'Typhlosion');
  assert.equal(extractName('Pikachu (shiny)'), 'Pikachu');
});

test('sellable - zostawia po jednej sztuce, sprzedaje reszte', () => {
  const texts = [btn('Zubat'), btn('Zubat'), btn('Zubat'), btn('Eevee')];
  const r = planSale(texts, { sellable: ['Zubat'] });
  assert.deepEqual(r.indexes, [1, 2]);
  assert.deepEqual(r.keptOne, ['Zubat']);
});

test('dokladna nazwa: "Klink" nie sprzedaje Klinklanga, "Meowth" nie sprzedaje Meowth Alola (regresja)', () => {
  const texts = [btn('Klinklang'), btn('Klinklang'), btn('Meowth Alola'), btn('Meowth Alola')];
  const r = planSale(texts, { sellable: ['Klink', 'Meowth'] });
  assert.deepEqual(r.indexes, []);
});

test('chronione nigdy nie sa sprzedawane (takze formy z dopiskiem)', () => {
  const texts = [btn('Flabébé'), btn('Flabébé'), btn('Flabébé Blue'), btn('Flabébé Blue')];
  const r = planSale(texts, { sellable: ['Flabébé', 'Flabébé Blue'], protectedList: ['Flabébé'] });
  assert.deepEqual(r.indexes, []);
});

test('limity diff3/diff4 - sprzedaje nadwyzke ponad keep', () => {
  const texts = [...Array(7)].map(() => btn('Stunfisk'));
  const r = planSale(texts, { diff3: ['Stunfisk'], diff3Keep: 5 });
  assert.deepEqual(r.indexes, [5, 6]);
  assert.deepEqual(r.surplus, [{ label: 'diff3', name: 'Stunfisk', count: 7, sold: 2 }]);
});

test('limity wylaczone - tylko sellable', () => {
  const texts = [...Array(7)].map(() => btn('Stunfisk'));
  assert.deepEqual(planSale(texts, { diff3: ['Stunfisk'], diff3Keep: 5, limitsEnabled: false }).indexes, []);
});

test('pokemon na sellable i diff3 nie jest liczony dwa razy', () => {
  const texts = [...Array(4)].map(() => btn('Houndour'));
  const r = planSale(texts, { sellable: ['Houndour'], diff3: ['Houndour'], diff3Keep: 1 });
  assert.deepEqual(r.indexes, [1, 2, 3]);
});
