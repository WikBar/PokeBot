const { Pokeballe } = require('./constants');
const { ClickContinue } = require('./activity');

async function GetLevel(page) {
  try {
    const levelText = await page.locator('div.col-xs-12.hidden-md >> text=Poziom').innerText();
    const level = parseInt(levelText.match(/\d+/)[0], 10);
    return level;
  } catch (e) {
    console.log("Nie udało się znaleźc poziomu");
  }
}

async function GetTypes(page) {
  try {
    const typeStr = await page.locator('div.col-xs-4.nopadding.text-center').innerText();
    const types = typeStr.split(" ");
    return types;
  } catch (e) {
    console.log("Nie udało sie znaleźć typów");
  }
}

async function ClickAdventure(page, account, locations) {
  console.log(`🚶‍♂️ Próba rozpoczęcia przygody nr ${account.adventureNr} w regionie ${account.region}`);

  const statsVisible = await page.locator('div.panel-heading:has-text("Statystyki")').isVisible();
  const activityVisible = await page.locator('div.panel-heading:has-text("Aktywność")').isVisible() ||
                          await page.locator('div.panel-heading:has-text("Centrum")').isVisible();

  const adventureHeader = statsVisible || activityVisible;

  if (!adventureHeader) {
    console.log("ℹ️ Brak aktywnej wyprawy – klikam 'Kontynuuj'");
    await ClickContinue(page);
    return;
  }

  const pokemonPanel = await page.$('div.panel-primary:has-text("Poziom")');
  if (pokemonPanel) {
    console.log("🟡 Wykryto Pokémona – pomijam kliknięcie 'Kontynuuj'");
  }
  const region = locations[account.region];
  const spotName = region[String(account.adventureNr)].name;
  if (!spotName) {
    console.log("❌ Niepoprawny numer przygody");
    return;
  }

  const linkRegex = spotName;
  await page.getByRole('link', { name: linkRegex }).click();
  await page.waitForLoadState('networkidle');

  console.log(`✅ Wyprawa do lokacji ${String(linkRegex).replace(/\//g, "")} zakończona pomyślnie`);
}

async function CheckIfPokemon(page) {
  const element = await page.$('div.panel.panel-primary.nopadding.nomargin');
  const pokemonInfo = {};
  if (element) {
    console.log('Pokemon został znaleziony!');
    textContent = await element.textContent();
    pokemonInfo.isPokemon = true;
    pokemonInfo.level = await GetLevel(page);
    pokemonInfo.types = await GetTypes(page);
    console.log(`Poziom Pokemona: ${pokemonInfo.level} Typy: ${pokemonInfo.types.join(", ")}`);
  } else {
    console.log('Pokemon nie został znaleziony.');
    pokemonInfo.isPokemon = false;
  }
  return pokemonInfo;
}

async function ClickPokemon(page, PokemonIndex) {
  const btn = await page.$$('button.btn-wybor_pokemona');
  if (btn[PokemonIndex]) {
    await btn[PokemonIndex].click({ force: true });
    console.log("✅ Kliknięto przycisk wysyłania Pokémona.");
  } else {
    console.log("⚠️ Nie znaleziono przycisku w tym kontenerze.");
  }
}

async function CatchPokemon(page, pokemon, regionInfo) {
  console.log(new Date().toLocaleTimeString());
  const NestBallMaxLvl = 20;
  const LvlBallMinLvl = 40;
  const time = new Date().getHours();
  if (regionInfo.isSpecial) {
    await ClickXBall(page, Pokeballe.safariball);
  } else {
    if ((time >= 18 || time < 6) && await pokemon.level >= NestBallMaxLvl && await pokemon.level < LvlBallMinLvl) {
      await ClickXBall(page, Pokeballe.nightball);
    } else if (await pokemon.level < NestBallMaxLvl) {
      await ClickXBall(page, Pokeballe.nestball);
    } else if (await pokemon.level >= LvlBallMinLvl) {
      await ClickXBall(page, Pokeballe.levelball);
    } else {
      await ClickXBall(page, Pokeballe.greatball);
    }
  }
  return;
}

async function ClickXBall(page, pokeball) {
  const buttons = await page.$$(`label[aria-label]`);
  for (const btn of buttons) {
    const label = await btn.getAttribute('aria-label');
    if (label === pokeball) {
      await btn.click();
      console.log(`Kliknięto w: ${label}`);
    }
  }
}

module.exports = {
  ClickAdventure,
  CheckIfPokemon,
  ClickPokemon,
  CatchPokemon
};
