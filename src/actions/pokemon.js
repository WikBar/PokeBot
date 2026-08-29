const { SELL_THRESHOLD, MAX_SELL_CLICK, CLICK_DELAY } = require('./constants');
const { logger } = require('../utils/logger');

const log = logger.child({ module: 'pokemon' });

// Domyslne limity, uzywane gdy config.json ich nie definiuje.
const DIFF3_KEEP = 5;
const DIFF4_KEEP = 5;

// Liczba z configu, z fallbackiem gdy brak wartosci lub jest niepoprawna.
function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Zamyka otwarte okno modalne (np. "opcje-budynku"), ktore przykrywa strone
// i przechwytuje klikniecia. Nie rzuca - brak modala to normalny stan.
async function closeOpenModal(page) {
  try {
    const modal = page.locator('.modal.in, .modal.show').first();
    if (await modal.count() === 0) return false;

    log.debug('Wykryto otwarte okno modalne - zamykam.');
    // Najpierw przycisk zamkniecia, potem Escape jako zapas.
    const closeBtn = modal.locator('button.close, .modal-header .close').first();
    if (await closeBtn.count() > 0) {
      await closeBtn.click({ timeout: 3000 }).catch(() => {});
    } else {
      await page.keyboard.press('Escape').catch(() => {});
    }

    // Czekamy az zniknie, zeby nie klikac w chowajace sie okno.
    await modal.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    return true;
  } catch (e) {
    log.debug('Nie udało się zamknąć okna modalnego', { error: String(e) });
    return false;
  }
}

async function SellPokemon(page, pokemonToSell, diff3Pokemons = [], protectedPokemon = [], diff4Pokemons = [], options = {}) {
  if (!Array.isArray(pokemonToSell) || pokemonToSell.length === 0) {
    log.info("Brak listy pokemonów do sprzedaży.");
    return;
  }

  // Ustawienia z config.json (panel web). Brak wartosci = dotychczasowe domyslne.
  const sellThreshold = numberOr(options.sellThreshold, SELL_THRESHOLD);
  const diff3Keep = numberOr(options.diff3Keep, DIFF3_KEEP);
  const diff4Keep = numberOr(options.diff4Keep, DIFF4_KEEP);
  const limitsEnabled = options.limitsEnabled !== false;   // domyslnie wlaczone

  // Lista chroniona ma pierwszeństwo — nawet jeśli pokemon jest na sellablePokemon
  // lub przekracza limit diff3, nie trafi do sprzedaży.
  const protectedList = Array.isArray(protectedPokemon) ? protectedPokemon : [];
  if (protectedList.length > 0) {
    log.info(`Chronione przed sprzedażą: ${protectedList.join(', ')}`);
  }
  // Otwarte okno "opcje-budynku" przykrywa strone i przechwytuje klikniecia -
  // Playwright ponawia je wtedy przez 30 s i konczy TimeoutError. Zamykamy je,
  // zanim sprobujemy kliknac ikone sprzedazy.
  await closeOpenModal(page);

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

  // true, jeśli tekst przycisku pasuje do któregokolwiek chronionego pokemona
  const isProtected = (text) =>
    protectedList.some(name => new RegExp(escapeRegExp(name)).test(text));

  for (let i = 0; i < texts.length; i++) {
    if (isProtected(texts[i])) continue;
    const matchedName = pokemonToSell.find(name => new RegExp(escapeRegExp(name)).test(texts[i]));
    if (matchedName) {
      if (seenTypes.has(matchedName)) {
        matchedIndexes.push(i);
      } else {
        seenTypes.add(matchedName);
      }
    }
  }

  // Pokemony diff3/diff4: sprzedajemy nadwyżki powyżej ustalonego limitu sztuk.
  // Indeksy juz zakwalifikowane pomijamy, zeby nie klikac dwa razy w ten sam wpis.
  const limitSurplus = (list, keep, label) => {
    const names = Array.isArray(list) ? list : [];
    if (names.length === 0) return;

    const counts = new Map();
    for (let i = 0; i < texts.length; i++) {
      if (isProtected(texts[i]) || matchedIndexes.includes(i)) continue;
      const matchedName = names.find(name => new RegExp(escapeRegExp(name)).test(texts[i]));
      if (matchedName) {
        const current = counts.get(matchedName) || { count: 0, indexes: [] };
        current.count++;
        current.indexes.push(i);
        counts.set(matchedName, current);
      }
    }

    for (const [name, { count, indexes }] of counts) {
      if (count > keep) {
        const toSell = indexes.slice(keep);
        log.info(`${label}: ${name} ma ${count} sztuk – sprzedaję ${toSell.length} nadwyżek`);
        for (const idx of toSell) {
          matchedIndexes.push(idx);
        }
      }
    }
  };

  if (limitsEnabled) {
    limitSurplus(diff3Pokemons, diff3Keep, 'diff3');
    limitSurplus(diff4Pokemons, diff4Keep, 'diff4');
  } else {
    log.info('Limity diff3/diff4 wyłączone – sprzedaję tylko z listy sellable.');
  }

  log.info(`Zachowuję po jednym: ${[...seenTypes].join(', ')}`);
  log.info(`Dopasowane do sprzedaży ${matchedIndexes.length} pokemonów`);

  if (matchedIndexes.length > sellThreshold) {
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
