const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  parseAmount, parseHodowla, parsePokemonOfDay, parsePokemonOffers,
} = require('../src/logic/pokemonParse');
const { groupBySpecies, speciesToCheck, analyzeSpecies, analyzeHodowla } = require('../src/logic/pokemonSale');
const { formatSaleReport } = require('../src/logic/telegramCommands');

const fixture = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

test('parseAmount: formaty kwot z gry', () => {
  assert.deepEqual(
    ['235k ¥', '1.5kk', '500.000 Yen', '2.200 PZ', '19 PZ', '-----', '<b>100</b>'].map(parseAmount),
    [235000, 1500000, 500000, 2200, 19, null, 100],
  );
});

test('parseHodowla i Pokemon Dnia (prawdziwa strona, wycinek)', () => {
  const html = fixture('hodowla-sample.html');
  const list = parseHodowla(html);
  assert.equal(list.length, 12);
  assert.deepEqual(list[0], { id: 376021866, name: 'Oricorio Sensu', level: 66, value: 339282 });
  assert.ok(list.some((p) => p.name === 'Prinplup'));
  assert.deepEqual(parsePokemonOfDay(html), { day: 'Ledyba', guild: 'Tandemaus' });
});

test('parsePokemonOffers: trenowany Prinplup (¥ i PZ) i shiny Typhlosion (tylko PZ)', () => {
  assert.deepEqual(parsePokemonOffers(fixture('pokemon-offers-prinplup.html')), [{
    id: 376254132, level: 73, trainings: 84, value: 215000, yenPrice: 500000, meritPrice: 19, shiny: false, seller: 'Gracz1',
  }]);
  const [ty] = parsePokemonOffers(fixture('pokemon-offers-typhlosion.html'));
  assert.deepEqual([ty.shiny, ty.level, ty.yenPrice, ty.meritPrice, ty.value], [true, 100, null, 2200, 235000]);
  assert.deepEqual(parsePokemonOffers('<div>brak</div>'), []);
});

const mine = [
  { id: 1, name: 'Typhlosion', level: 80, value: 400000 },
  { id: 2, name: 'Typhlosion', level: 60, value: 300000 },
  { id: 3, name: 'Prinplup', level: 50, value: 25000000 },   // wyjatkowy egzemplarz
  { id: 4, name: 'Prinplup', level: 52, value: 120000 },
  { id: 5, name: 'Prinplup', level: 40, value: 100000 },
  { id: 6, name: 'Ledyba', level: 70, value: 90000 },
];
const offer = (o) => ({ id: 1, level: 75, trainings: 0, value: 0, yenPrice: null, meritPrice: null, shiny: false, seller: 'X', ...o });

test('groupBySpecies / speciesToCheck: najcenniejsze najpierw, swieze pomijane', () => {
  const groups = groupBySpecies(mine);
  assert.deepEqual(groups.map((g) => [g.name, g.count]), [['Prinplup', 3], ['Typhlosion', 2], ['Ledyba', 1]]);
  const now = 1e12;
  assert.deepEqual(speciesToCheck(groups, { Prinplup: { ts: now - 3600e3 } }, { now, limit: 5 }), ['Typhlosion', 'Ledyba']);
  assert.deepEqual(speciesToCheck(groups, { Prinplup: { ts: now - 48 * 3600e3 } }, { now, limit: 1 }), ['Prinplup']);
});

test('analyzeSpecies: targ tylko przy porownywalnych ofertach min. 30% ponad skup', () => {
  const [ty] = groupBySpecies(mine.filter((p) => p.name === 'Typhlosion'));
  const comparable = [offer({ level: 78, yenPrice: 700000 }), offer({ level: 85, yenPrice: 650000 })];
  const r = analyzeSpecies(ty, comparable);
  assert.equal(r.verdict, 'targ');
  assert.equal(r.suggestedPrice, 649999);
  assert.equal(r.gainPerPokemon, 249999);

  assert.equal(analyzeSpecies(ty, [offer({ yenPrice: 450000 })]).verdict, 'skup');
  // Tylko trenowane, shiny albo za zaslugi - nie ma z czym porownac.
  assert.equal(analyzeSpecies(ty, [
    offer({ trainings: 84, yenPrice: 2000000 }), offer({ shiny: true, yenPrice: 5000000 }), offer({ meritPrice: 20 }),
  ]).verdict, 'brak-porownywalnych');
  assert.equal(analyzeSpecies(ty, []).verdict, 'brak-ofert');
  assert.equal(analyzeSpecies(ty, undefined).verdict, 'nie-sprawdzono');
});

test('analyzeSpecies: wyjatkowo cenny egzemplarz oznaczony i pomijany przy porownaniu', () => {
  const [pr] = groupBySpecies(mine.filter((p) => p.name === 'Prinplup'));
  const r = analyzeSpecies(pr, []);
  assert.deepEqual(r.highValue, [{ id: 3, level: 50, value: 25000000 }]);
  assert.equal(r.best.id, 4);
});

test('analyzeHodowla + /sprzedaz', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const report = {
    updatedAt: new Date(now).toISOString(),
    ...analyzeHodowla(mine, {
      Typhlosion: { offers: [offer({ level: 78, yenPrice: 700000 })] },
      Ledyba: { offers: [] },
    }, { pokemonOfDay: { day: 'Ledyba', guild: 'Tandemaus' } }),
  };
  assert.deepEqual([report.pokemon, report.species, report.checked], [6, 3, 2]);
  assert.equal(report.totalValue, 26010000);
  assert.deepEqual(report.market.map((s) => s.name), ['Typhlosion']);
  assert.deepEqual(report.pokemonOfDay.map((p) => p.name), ['Ledyba']);

  const text = formatSaleReport(report, now + 60000);
  // toLocaleString('pl-PL') rozdziela tysiace twarda spacja - stad \s.
  assert.match(text, /6 pokemonów, 3 gatunków, skup razem 26\s010\s000 ¥/);
  assert.match(text, /Pokemon Dnia \(\+140% skupu, jeśli złapany dziś\): Ledyba ×1/);
  assert.match(text, /- Prinplup 50 poz\.: skup 25\s000\s000 ¥/);
  assert.match(text, /- Typhlosion 80 poz\.: targ ~699\s999 ¥ vs skup 400\s000 ¥/);
  assert.match(formatSaleReport(null), /Brak analizy Hodowli/);
});

test('/sprzedaz: informacja o pominietych drogich egzemplarzach', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const cheap = mine.filter((p) => p.value <= 800000);
  const report = {
    updatedAt: new Date(now).toISOString(),
    excluded: { count: mine.length - cheap.length, maxValue: 800000 },
    ...analyzeHodowla(cheap, {}),
  };
  assert.equal(report.pokemon, 5);
  assert.deepEqual(report.highValue, []);   // Prinplup za 25 mln odfiltrowany
  assert.match(formatSaleReport(report, now), /Pominięte \(skup powyżej 800\s000 ¥\): 1\./);
});
