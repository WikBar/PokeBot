const { Pokeballe } = require('./constants');
const { ClickContinue } = require('./activity');
const { logger } = require('../utils/logger');

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

  const statsVisible = await page.locator('div.panel-heading:has-text("Statystyki")').isVisible();
  const activityVisible = await page.locator('div.panel-heading:has-text("Aktywność")').isVisible() ||
                          await page.locator('div.panel-heading:has-text("Centrum")').isVisible();

  const adventureHeader = statsVisible || activityVisible;

  if (!adventureHeader) {
    log.info("Brak aktywnej wyprawy – klikam 'Kontynuuj'");
    await ClickContinue(page);
    return;
  }

  const pokemonPanel = await page.$('div.panel-primary:has-text("Poziom")');
  if (pokemonPanel) {
    log.info("Wykryto Pokémona – pomijam kliknięcie 'Kontynuuj'");
  }
  const region = locations[account.region];
  const spotName = region[String(account.adventureNr)].name;
  if (!spotName) {
    log.error("Niepoprawny numer przygody", { adventureNr: account.adventureNr, region: account.region });
    return;
  }

  const linkRegex = spotName;
  await page.getByRole('link', { name: linkRegex }).click();
  await page.waitForLoadState('networkidle');

  log.info('Wyprawa zakończona', { location: String(linkRegex).replace(/\//g, "") });
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
    log.info(`Pokemon info: ${pokemonInfo.pokemon} Poziom: ${pokemonInfo.level} Typy: ${pokemonInfo.types?.join(', ')}`);
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

async function CatchPokemon(page, pokemon, regionInfo) {
  log.info(`Łapię: ${pokemon?.pokemon} Poziom: ${pokemon?.level} o ${new Date().toLocaleTimeString()}`);
  const NestBallMaxLvl = 20;
  const LvlBallMinLvl = 40;
  const time = new Date().getHours();

  if (regionInfo.isGoldenNest) {
    await ClickXBall(page, Pokeballe.ultraball);
  } else if (regionInfo.isSpecial) {
    await ClickXBall(page, Pokeballe.safariball);
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
  for (const btn of buttons) {
    const label = await btn.getAttribute('aria-label');
    if (label === pokeball) {
      await btn.click();
      log.info(`Kliknięto w ${label}`);
    }
  }
}

module.exports = {
  ClickAdventure,
  CheckIfPokemon,
  ClickPokemon,
  CatchPokemon
};
