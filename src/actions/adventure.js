const { Pokeballe } = require('./constants');
const { ClickContinue } = require('./activity');
const { logger } = require('../utils/logger');
const { notifyGoldenNest } = require('../utils/notifier');
const { sharesType } = require('./team');

const log = logger.child({ module: 'adventure' });

async function GetLevel(page) {
  try {
    const levelLocator = page.locator('div.col-xs-12.hidden-md').filter({ hasText: 'Poziom' });
    const levelText = await levelLocator.first().innerText();
    const match = levelText.match(/\d+/);
    return match ? parseInt(match[0], 10) : undefined;
  } catch (e) {
    log.debug("Nie udało się znaleźć poziomu", { error: String(e) });
  }
}

async function GetTypes(page) {
  try {
    const typeStr = await page.locator('div.col-xs-4.nopadding.text-center').first().innerText();
    return typeStr.trim().split(/\s+/).filter(Boolean);
  } catch (e) {
    log.debug("Nie udało się znaleźć typów", { error: String(e) });
  }
}

async function ClickAdventure(page, account, locations) {
  log.info(`Próba rozpoczęcia przygody ${account.adventureNr} w Regionie ${account.region}.`);

  const region = locations[account.region];
  const spotName = region[String(account.adventureNr)]?.name;
  if (!spotName) {
    log.error("Niepoprawny numer przygody", { adventureNr: account.adventureNr, region: account.region });
    return;
  }

  const statsVisible = await page.locator('div.panel-heading:has-text("Statystyki")').isVisible();
  const activityVisible = await page.locator('div.panel-heading:has-text("Aktywność")').isVisible() ||
                          await page.locator('div.panel-heading:has-text("Centrum")').isVisible();
  const adventureActive = statsVisible || activityVisible;

  if (adventureActive) {
    await page.getByRole('link', { name: spotName }).click();
    await page.waitForLoadState('networkidle');
    log.info('Wyprawa kliknięta', { location: spotName });
    return;
  }

  // Brak aktywnej wyprawy — strona główna / lista lokacji
  if (account.adventureChanged) {
    log.info("Zmiana wyprawy wykryta – pomijam 'Kontynuuj', klikam nową lokację.");
    account.adventureChanged = false;
  } else {
    log.info("Brak aktywnej wyprawy – klikam 'Kontynuuj'");
    await ClickContinue(page);
    return;
  }

  await page.getByRole('link', { name: spotName }).click();
  await page.waitForLoadState('networkidle');
  log.info('Wyprawa kliknięta', { location: spotName });
}

// Ultra Bestia: podczas wyprawy potrafi pojawic sie szczelina w czasoprzestrzeni
// z przyciskiem "Walcz z Ultra Bestia". Klikniecie przenosi przez portal
// i rozpoczyna walke; po wygranej Bestie mozna zlapac WYLACZNIE beastballem
// (poza masterballem, ktorego nie ruszamy - jest go kilka sztuk).
// Zwraca true, gdy portal zostal wykryty i klikniety.
async function CheckUltraBeast(page) {
  try {
    const btn = page.locator('button:has-text("Walcz z Ultra Bestią"), a:has-text("Walcz z Ultra Bestią"), input[value*="Walcz z Ultra Bestią"]').first();
    if (await btn.count() === 0) return false;

    log.info('Ultra Bestia: wykryto szczelinę - wchodzę w portal.');
    await btn.click();
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch { /* ignore */ }
    await page.waitForTimeout(2000);
    return true;
  } catch (e) {
    log.warn('Ultra Bestia: błąd przy wejściu w portal', { error: String(e) });
    return false;
  }
}

async function CheckIfPokemon(page) {
  const element = await page.$('div.panel.panel-primary.nopadding.nomargin');
  const pokemonInfo = {};
  if (element) {
    log.info('Pokemon został znaleziony!');
    const textContent = await element.textContent();
    pokemonInfo.isPokemon = true;
    pokemonInfo.pokemon = String(textContent || '').split('\n').map(s => s.trim()).find(s => s.length > 0) || '';
    pokemonInfo.level = await GetLevel(page);
    pokemonInfo.types = await GetTypes(page);
    pokemonInfo.catchDiff = await checkCatchingDiff(page);
    log.info(`Pokemon info: ${pokemonInfo.pokemon} Poziom: ${pokemonInfo.level} Typy: ${pokemonInfo.types?.join(', ')} Trudność łapania: ${pokemonInfo.catchDiff}/5`);
  } else {
    log.debug('Pokemon nie został znaleziony.');
    pokemonInfo.isPokemon = false;
  }
  return pokemonInfo;
}

async function ClickPokemon(page, PokemonIndex) {
  const btn = await page.$$('button.btn-wybor_pokemona');
  if (btn[PokemonIndex]) {
    await btn[PokemonIndex].click({ force: true });
    log.info("Kliknięto przycisk wysyłania Pokémona.");
  } else {
    log.warn("Nie znaleziono przycisku w tym kontenerze.", { PokemonIndex });
  }
}

async function CatchPokemon(page, pokemon, regionInfo, regionName, battleSlot = null, options = {}) {
  log.info(`Łapię: ${pokemon?.pokemon} Poziom: ${pokemon?.level} o ${new Date().toLocaleTimeString()}`);
  const NestBallMaxLvl = 20;
  const LvlBallMinLvl = 40;
  const LureBallMaxLvl = 30;
  const time = new Date().getHours();

  // Oszczedzanie safariballi (panel web). Wlaczone = rzucamy tylko przy
  // catchDiff >= 3; wylaczone = w lokacji specjalnej rzucamy bez wzgledu
  // na trudnosc. Brak ustawienia traktujemy jak wlaczone.
  const saveSafariBall = options.saveSafariBall !== false;
  const useSafari = regionInfo.isSpecial && (!saveSafariBall || pokemon.catchDiff >= 3);

  // Ultra Bestia: po walce dostepny jest wylacznie beastball (i masterball,
  // ktorego nie ruszamy). Sprawdzamy jako pierwsze - kazdy inny warunek
  // probowalby rzucic kula, ktorej nie ma na ekranie.
  if (options.ultraBeast) {
    const thrown = await ClickXBall(page, Pokeballe.beastball);
    if (!thrown) log.warn('Ultra Bestia: nie znaleziono beastballa na ekranie łapania.');
    return;
  }

  // Poziom >75 = Golden Nest. Sprawdzamy jako pierwsze, żeby alert wyszedł
  // także w lokacjach specjalnych (inaczej przechwyciłby je warunek safariball).
   if (useSafari) {
    await ClickXBall(page, Pokeballe.safariball);
  } else if (pokemon.level < LureBallMaxLvl && pokemon.catchDiff <= 2 && sharesType(pokemon.types, battleSlot)) {
      // Lureball ma pierwszenstwo przed pokeballem i friendballem: ponizej 30
      // poziomu, trudnosc <=2 i typ wspolny z pokemonem wyslanym do walki.
      log.info(`Wspólny typ z ${battleSlot?.name} — rzucam lureball`);
      await ClickXBall(page, Pokeballe.lureball );
  }  else if (pokemon.catchDiff === 1 && pokemon.level < 13) {
      await ClickXBall(page, Pokeballe.pokeball);
  } else if (pokemon.catchDiff === 2 && pokemon.level < 30) {
    await ClickXBall(page, Pokeballe.friendball);
  } else if (pokemon.catchDiff >= 4 && pokemon.level < 70) {
    await ClickXBall(page, Pokeballe.ultraball );
  } else if (pokemon.level > 75 ) {
    // Rzut wykonujemy zawsze; wynik decyduje tylko o powiadomieniu.
    // W lokacji specjalnej safariball jest jedyna dostepna kula, wiec
    // oszczedzanie (saveSafariBall) tu nie obowiazuje.
    const thrown = regionInfo.isSpecial
      ? await ClickXBall(page, Pokeballe.safariball)
      : await ClickXBall(page, Pokeballe.cherishball);

    if (thrown) {
      await notifyGoldenNest({
        region: regionName,
        location: regionInfo.name,
        pokemon: pokemon.pokemon,
        level: pokemon.level,
      });
    }
  } else if ((time >= 18 || time < 6) && pokemon.level >= NestBallMaxLvl && pokemon.level < LvlBallMinLvl) {
    await ClickXBall(page, Pokeballe.nightball);
  } else if (pokemon.level < NestBallMaxLvl) {
    await ClickXBall(page, Pokeballe.nestball);
  } else if (pokemon.level >= LvlBallMinLvl) {
    await ClickXBall(page, Pokeballe.levelball);
  } else {
    await ClickXBall(page, Pokeballe.greatball);
  }
}

async function ClickXBall(page, pokeball) {
  const buttons = await page.$$(`label[aria-label]`);
  let clicked = false;
  for (const btn of buttons) {
    const label = await btn.getAttribute('aria-label');
    if (label === pokeball) {
      await btn.click();
      log.info(`Kliknięto w ${label}`);
        clicked = true;
    }
  }
  return clicked;
}

async function checkCatchingDiff(page) {
  const pokeballs = await page.$$('div.col-xs-12.col-md-8 img');
  let filteredCount = 0;
  for (const ball of pokeballs) {
    const style = await ball.getAttribute('style');
    if (style && (style.includes('grayscale') || style.includes('opacity(0.3)'))) {
      filteredCount++;
    }
  }
  const diff = Math.max(1, Math.min(5, 5 - filteredCount));
  log.debug(`Trudność łapania: ${diff} (${filteredCount} pokeballi wyszarzonych)`);
  return diff;
}

module.exports = {
  CheckUltraBeast,
  ClickAdventure,
  CheckIfPokemon,
  ClickPokemon,
  CatchPokemon,
  checkCatchingDiff
};
