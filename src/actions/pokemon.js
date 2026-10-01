const { SELL_THRESHOLD, MAX_SELL_CLICK, CLICK_DELAY } = require('./constants');
const { logger } = require('../utils/logger');
const { planSale } = require('../logic/sell');

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

  const texts = await buttons.allInnerTexts();

  // Wybor jest w logic/sell.js (testowalny bez przegladarki).
  const plan = planSale(texts, {
    sellable: pokemonToSell,
    protectedList,
    diff3: diff3Pokemons,
    diff4: diff4Pokemons,
    diff3Keep,
    diff4Keep,
    limitsEnabled,
  });

  // TOP 5 najliczniejszych pokemonów w zbiorze (na podstawie tekstów w hodowli)
  const top5 = [...plan.counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));
  log.info(`TOP 5 najliczniejszych pokemonów w zbiorze: ${top5.map(t => `${t.name} (${t.count})`).join(', ')}`);

  for (const s of plan.surplus) {
    log.info(`${s.label}: ${s.name} ma ${s.count} sztuk – sprzedaję ${s.sold} nadwyżek`);
  }
  if (!limitsEnabled) {
    log.info('Limity diff3/diff4 wyłączone – sprzedaję tylko z listy sellable.');
  }

  const matchedIndexes = plan.indexes;
  log.info(`Zachowuję po jednym: ${plan.keptOne.join(', ')}`);
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
