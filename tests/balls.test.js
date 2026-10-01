const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseBall } = require('../src/logic/balls');

const DAY = 12;
const NIGHT = 22;
const pick = (pokemon, extra = {}) => chooseBall({ pokemon, hour: DAY, ...extra });
const mon = (level, catchDiff, name = 'Testmon') => ({ pokemon: name, level, catchDiff });

test('Ultra Bestia - zawsze beastball', () => {
  assert.equal(pick(mon(90, 5), { options: { ultraBeast: true, goldenNest: true } }).ball, 'beastball');
});

test('Golden Nest - cherishball, w lokacji specjalnej safariball', () => {
  const r = pick(mon(90, 4), { options: { goldenNest: true } });
  assert.equal(r.ball, 'cherishball');
  assert.equal(r.kind, 'goldenNest');
  assert.equal(pick(mon(90, 4), { isSpecial: true, options: { goldenNest: true } }).ball, 'safariball');
});

test('Golden Nest ma pierwszenstwo przed lista mocnych kul (regresja)', () => {
  const r = pick(mon(90, 4, 'Hitmontop'), { options: { goldenNest: true, strongBallPokemons: ['hitmontop'] } });
  assert.equal(r.kind, 'goldenNest');
  assert.equal(r.ball, 'cherishball');
});

test('lokacja specjalna - safariball przy diff>=3 albo gdy oszczedzanie wylaczone', () => {
  assert.equal(pick(mon(40, 3), { isSpecial: true }).ball, 'safariball');
  assert.notEqual(pick(mon(40, 2), { isSpecial: true }).ball, 'safariball');
  assert.equal(pick(mon(40, 1), { isSpecial: true, options: { saveSafariBall: false } }).ball, 'safariball');
});

test('lista mocnych kul - ultraball z premierballem jako zapas, odporna na wielkosc liter', () => {
  const r = pick(mon(10, 1, 'Pikachu'), { options: { strongBallPokemons: ['  PIKACHU '] } });
  assert.equal(r.ball, 'ultraball');
  assert.equal(r.fallback, 'premierball');
});

test('lureball przy wspolnym typie, poziom < 30 i diff <= 2', () => {
  assert.equal(pick(mon(20, 2), { sharesType: true }).ball, 'lureball');
  assert.notEqual(pick(mon(30, 2), { sharesType: true }).ball, 'lureball');
  assert.notEqual(pick(mon(20, 3), { sharesType: true }).ball, 'lureball');
});

test('pokeball (diff 1, < 13) i friendball (diff 2, < 30)', () => {
  assert.equal(pick(mon(12, 1)).ball, 'pokeball');
  assert.equal(pick(mon(29, 2)).ball, 'friendball');
});

test('diff 5 ponizej 70 - ultraball, od 70 - levelball', () => {
  assert.equal(pick(mon(69, 5)).ball, 'ultraball');
  assert.equal(pick(mon(70, 5)).ball, 'levelball');
});

test('diff 4 zawsze levelball, takze nisko i w nocy', () => {
  assert.equal(pick(mon(5, 4)).ball, 'levelball');
  assert.equal(chooseBall({ pokemon: mon(5, 4), hour: NIGHT }).ball, 'levelball');
});

test('poziom 30+ - levelball', () => {
  assert.equal(pick(mon(30, 3)).ball, 'levelball');
  assert.equal(pick(mon(55, 1)).ball, 'levelball');
});

test('noc (18-6) ponizej 30 - nightball', () => {
  assert.equal(chooseBall({ pokemon: mon(25, 3), hour: 18 }).ball, 'nightball');
  assert.equal(chooseBall({ pokemon: mon(25, 3), hour: 5 }).ball, 'nightball');
  assert.notEqual(chooseBall({ pokemon: mon(25, 3), hour: 6 }).ball, 'nightball');
});

test('w dzien: nestball (< 20, diff < 3), inaczej greatball', () => {
  assert.equal(pick(mon(15, 1)).ball, 'nestball');
  assert.equal(pick(mon(19, 1)).ball, 'nestball');
  assert.equal(pick(mon(20, 1)).ball, 'greatball');
  assert.equal(pick(mon(15, 3)).ball, 'greatball');
  assert.equal(pick(mon(25, 3)).ball, 'greatball');
});
