const { SELL_THRESHOLD, MAX_SELL_CLICK, CLICK_DELAY } = require('./constants');
const { logger } = require('../utils/logger');

const log = logger.child({ module: 'pokemon' });

async function SellPokemon(page, pokemonToSell, diff3Pokemons = []) {
  if (!Array.isArray(pokemonToSell) || pokemonToSell.length === 0) {
    log.info("Brak listy pokemonów do sprzedaży.");
    return;
  }
  await page.getByRole('img', { name: 'Sprzedaj Pokemony z Przechowalni' }).click();
  log.info("Jesteś w Hodowli Pokemonów");
  await page.waitForSelector('label.btn-hodowla', { timeout: 10000 });

  const buttons = page.locator('label.btn-hodowla');
  const total = await buttons.count();
  if (total === 0) return;

  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const texts = await buttons.allInnerTexts();

  // TOP 5 najliczniejszych pokemonów w zbiorze (na podstawie tekstów w hodowli)
  const extractName = (raw) => {
    const firstLine = String(raw || '').split('\n')[0].trim();
    const cleaned = firstLine
      .replace(/\s{2,}/g, ' ')
      .replace(/♀|♂/g, '')
      .replace(/[+>]/g, '')
      .replace(/\d+\s*poz\b/gi, '')
      .replace(/\b(poziom|lvl|lv)\s*\d+\b/gi, '')
      .replace(/\b\d+\b/g, '')
      .replace(/\(.*\)$/g, '')
      .trim();
    return cleaned.length ? cleaned : firstLine;
  };

  const counts = new Map();
  for (const t of texts) {
    const name = extractName(t);
    counts.set(name, (counts.get(name) || 0) + 1);
  }

  const top5 = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  log.info(`TOP 5 najliczniejszych pokemonów w zbiorze: ${top5.map(t => `${t.name} (${t.count})`).join(', ')}`);

  const matchedIndexes = [];
  const seenTypes = new Set();

  for (let i = 0; i < texts.length; i++) {
    const matchedName = pokemonToSell.find(name => new RegExp(escapeRegExp(name)).test(texts[i]));
    if (matchedName) {
      if (seenTypes.has(matchedName)) {
        matchedIndexes.push(i);
      } else {
        seenTypes.add(matchedName);
      }
    }
  }

  // Pokemony diff3: sprzedajemy wszystkie nadwyżki powyżej 7 sztuk danego gatunku
  const diff3List = Array.isArray(diff3Pokemons) ? diff3Pokemons : [];
  if (diff3List.length > 0) {
    const diff3Counts = new Map();
    for (let i = 0; i < texts.length; i++) {
      const matchedName = diff3List.find(name => new RegExp(escapeRegExp(name)).test(texts[i]));
      if (matchedName) {
        const current = diff3Counts.get(matchedName) || { count: 0, indexes: [] };
        current.count++;
        current.indexes.push(i);
        diff3Counts.set(matchedName, current);
      }
    }
    for (const [name, { count, indexes }] of diff3Counts) {
      if (count > 7) {
        const toSell = indexes.slice(7);
        log.info(`diff3: ${name} ma ${count} sztuk – sprzedaję ${toSell.length} nadwyżek`);
        for (const idx of toSell) {
          matchedIndexes.push(idx);
        }
      }
    }
  }

  log.info(`Zachowuję po jednym: ${[...seenTypes].join(', ')}`);
  log.info(`Dopasowane do sprzedaży ${matchedIndexes.length} pokemonów`);

  if (matchedIndexes.length > SELL_THRESHOLD) {
    let clicked = 0;
    for (const index of matchedIndexes) {
      await buttons.nth(index).click();
      clicked++;
      await page.waitForTimeout(CLICK_DELAY);
      if (clicked >= MAX_SELL_CLICK) {
        break;
      }
    }
    log.info("Pokemony zaznaczone do sprzedaży");
    await page.click('text=Sprzedaj Zaznaczone');
    log.info("Kliknięto 'Sprzedaj Zaznaczone'");
    await page.click('text=Potwierdź');
    log.info("Potwierdzono sprzedaż Pokemonów");
    await page.waitForTimeout(2000);
    await page.reload();
  } else {
    log.info("Za mało pokemonów do sprzedaży – pomijam");
    await page.reload();
    return;
  }
}

module.exports = {
  SellPokemon
};
