require('dotenv').config({ path: require('path').resolve(__dirname, '..', process.env.NODE_ENV === 'production' ? '.env.production' : '.env') }); // Wczytujemy login i hasło z pliku .env
const { chromium } = require('playwright'); // Importujemy przeglądarkę
const { CheckPA, CheckStorage, ClickAdventure, CheckIfPokemon,
   CatchPokemon, ClickPokemon,
   CancelActivity, StartActivity,
   CheckHP, ClickHospital,
   SellPokemon, login, isSessionAlive }  = require('./actions');
const { loadFromFile, saveToFile } = require('./utils/fileOperations');
const { CheckIfGoodEvent,CheckIfBadEvent, CheckActivity}=require('./events');
const path = require('path');
const { runDailyActions, runCareIfNeeded, runAssociationPAIfNeeded, runPABerriesIfNeeded } = require('./dailyActions');
const { logger } = require('./utils/logger');
const { startServer } = require('./server');
const state = require('./state');

const log = logger.child({ module: 'main' });

// Constants
const HP_THRESHOLD = 15;
const ADVENTURE_TIMEOUT = 3000;
const REGEN_WAIT_MINUTES = 12;
const REGEN_ITERATIONS = 10;

(async () => {
  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection', { reason: String(reason) });
  });
  process.on('uncaughtException', (error) => {
    log.error('Uncaught exception', { error: String(error), stack: error?.stack });
  });

  const locationsPath = path.resolve(__dirname, '..', 'config', 'locations.json');
  const configPath = path.resolve(__dirname, '..', 'config', 'config.json');
  const locations = await loadFromFile(locationsPath);


  const credentials = {
    login: process.env.POKE1_LOGIN,
    password: process.env.POKE_PASSWORD,
  };
  log.info(`Uruchamiam skrypt... Login to: ${credentials.login}`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  startServer();

  const loggedIn = await login(page, credentials);
  if (!loggedIn) {
    log.error('Logowanie nieudane. Sprawdź dane logowania w pliku .env.');
    await browser.close();
    return;
  }

async function categorizePokemon(pokemonInfo, accountConfig, configPath) {
  if (!pokemonInfo.pokemon) return;
  const diff = pokemonInfo.catchDiff;

  const diffListMap = {
    0: 'diff0CatchPokemons',
    3: 'diff3CatchPokemons',
    4: 'diff4CatchPokemons',
    5: 'diff5CatchPokemons',
  };

  if (diff !== 0 && diff <= 2) {
    if (!accountConfig.sellablePokemon.includes(pokemonInfo.pokemon)) {
      accountConfig.sellablePokemon.push(pokemonInfo.pokemon);
      await saveToFile(configPath, accountConfig);
      log.info(`Dodano do sellablePokemon (trudność ${diff}): ${pokemonInfo.pokemon}`);
    }
    return;
  }

  const listKey = diffListMap[diff];
  if (!listKey) return;

  if (!Array.isArray(accountConfig[listKey])) accountConfig[listKey] = [];
  if (!accountConfig[listKey].includes(pokemonInfo.pokemon)) {
    accountConfig[listKey].push(pokemonInfo.pokemon);
    await saveToFile(configPath, accountConfig);
    log.info(`Dodano do ${listKey} (trudność ${diff}): ${pokemonInfo.pokemon}`);
  }
}

while (true){
  if (state.getState().emergencyStop) {
    log.warn('Emergency stop via API');
    break;
  }
  while (state.getState().isPaused) {
    log.info('Bot paused via API, waiting...');
    await page.waitForTimeout(5000);
  }
  try {
    if (!(await isSessionAlive(page))) {
      log.warn('Sesja wygasła, ponawiam logowanie...');
      const relogged = await login(page, credentials);
      if (!relogged) {
        log.error('Ponowne logowanie nieudane. Przerywam.');
        break;
      }
    }
  const storageResult = await CheckStorage(page);
  state.updateStats({ storage: { current: storageResult.current, max: storageResult.max } });
  let accountConfig = await loadFromFile(configPath);
  if (process.env.POKE_ADVENTURE_NR) {
    const parsedAdventureNr = parseInt(process.env.POKE_ADVENTURE_NR, 10);
    if (!Number.isNaN(parsedAdventureNr)) {
      accountConfig.adventureNr = parsedAdventureNr;
    } else {
      log.warn("Niepoprawna wartość POKE_ADVENTURE_NR, używam wartości z config.json");
    }
  }
  state.updateStats({ region: accountConfig.region, adventureNr: accountConfig.adventureNr });
  log.info(`Załadowana konfiguracja: Region ${accountConfig.region}, Atakujący pokemon ${accountConfig.pokemonIndex + 1}, Numer przygody ${accountConfig.adventureNr}`);
  const region=locations[accountConfig.region];
  const locationKey = String(accountConfig.adventureNr);
  const locationInfo = region[locationKey];
  const paBuffer = accountConfig.paBuffer || 0;
  await runDailyActions(page);
  await SellPokemon(page, accountConfig.sellablePokemon,accountConfig.diff3CatchPokemons);

  let paResult = await CheckPA(page);
  state.updateStats({ pa: { current: paResult.currentPA, max: paResult.maxPA } });
  if (paResult.currentPA > locationInfo.requiredPA + paBuffer) {
    const activityActive = await CheckActivity(page);
    state.updateStats({ activity: { active: !!activityActive } });
    if (activityActive === 'care') {
      log.info('Wykryto aktywną Opiekę - przekazuję do dailyActions.');
      await runDailyActions(page);
    } else if (activityActive) {
      await CancelActivity(page);
    }

  paResult = await CheckPA(page);
  state.updateStats({ pa: { current: paResult.currentPA, max: paResult.maxPA } });
  while (paResult.currentPA >= locationInfo.requiredPA + paBuffer){
    log.info("Wystarczająca ilość PA");

    const hpResult = await CheckHP(page);
    state.updateStats({ hp: { current: hpResult.currentHP, max: hpResult.maxHP } });
    if (hpResult.currentHP < HP_THRESHOLD){
      log.warn("Niskie HP, idę do Centrum Pokemon");
      const hpAfterHospital = await ClickHospital(page);
      state.updateStats({ hp: { current: hpAfterHospital.currentHP, max: hpAfterHospital.maxHP } });
    }
    
    await runCareIfNeeded(page);
    state.updateStats({ lastEvent: 'adventure_started' });
    await ClickAdventure(page,accountConfig,locations);

    await CheckIfGoodEvent(page)
    await CheckIfBadEvent(page)
    const pokemonInfo= await CheckIfPokemon(page);
      if (pokemonInfo.isPokemon){
        await categorizePokemon(pokemonInfo, accountConfig, configPath);
         if( pokemonInfo.types[0] === "Wróżkowy" && pokemonInfo.types[1] === "Stalowy"){
          await ClickPokemon(page,2);
        }else  
        if (pokemonInfo.level>accountConfig.secondPokMaxLv ){
            await ClickPokemon(page,accountConfig.pokemonIndex);
        }else{
          await ClickPokemon(page,accountConfig.SecondPokemonIndex);
        }

        if (await CheckIfGoodEvent(page)==3){
          await CatchPokemon(page,pokemonInfo,locationInfo);
          state.updateStats({ lastEvent: 'pokemon_caught' });
          }

      }else{
        log.info("Brak Pokemona na przygodzie");
      }
      await page.waitForTimeout(ADVENTURE_TIMEOUT);
      paResult = await CheckPA(page);
      state.updateStats({ pa: { current: paResult.currentPA, max: paResult.maxPA } });

      while (state.getState().isPaused) {
        log.info('Bot paused via API, waiting...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      if (state.getState().emergencyStop) {
        log.warn('Emergency stop via API');
        process.exit(0);
      }
      if (state.getState().forceHospital) {
        log.info('Force hospital via API');
        const hpAfterForce = await ClickHospital(page);
        state.updateStats({ hp: { current: hpAfterForce.currentHP, max: hpAfterForce.maxHP } });
        state.setForceHospital(false);
      }

      const prevAdventureNr = accountConfig.adventureNr;
      accountConfig = await loadFromFile(configPath);
      if (process.env.POKE_ADVENTURE_NR) {
        const parsedAdventureNr = parseInt(process.env.POKE_ADVENTURE_NR, 10);
        if (!Number.isNaN(parsedAdventureNr)) accountConfig.adventureNr = parsedAdventureNr;
      }
      if (accountConfig.adventureNr !== prevAdventureNr) {
        log.info(`Zmiana wyprawy: ${prevAdventureNr} → ${accountConfig.adventureNr} - flaga adventureChanged ustawiona.`);
        accountConfig.adventureChanged = true;
      }
      state.updateStats({ region: accountConfig.region, adventureNr: accountConfig.adventureNr });

      await runAssociationPAIfNeeded(page);
      await runPABerriesIfNeeded(page);
    }
    }
    if (accountConfig.randomAdventure) {
      const nonSpecial = Object.entries(region)
        .filter(([, loc]) => !loc.isSpecial)
        .sort(([a], [b]) => Number(a) - Number(b));
      const currentIdx = nonSpecial.findIndex(([key]) => Number(key) === accountConfig.adventureNr);
      const nextIdx = (currentIdx + 1) % nonSpecial.length;
      accountConfig.adventureNr = Number(nonSpecial[nextIdx][0]);
      await saveToFile(configPath, accountConfig);
      log.info(`randomAdventure: następna lokacja → ${accountConfig.adventureNr} (${nonSpecial[nextIdx][1].name})`);
    }

    const activityCheck = await CheckActivity(page);
    state.updateStats({ activity: { active: !!activityCheck } });
    const paCheck = await CheckPA(page);
    state.updateStats({ pa: { current: paCheck.currentPA, max: paCheck.maxPA } });
    if (activityCheck === false && paCheck.currentPA < locationInfo.requiredPA){
      await StartActivity(page);
      state.updateStats({ activity: { active: true } });
    }
    await page.reload();
    log.info("Czekam na odnowienie punktów akcji");
    state.updateStats({ lastEvent: 'waiting_for_pa_regen' });
    await SellPokemon(page, accountConfig.sellablePokemon, accountConfig.diff3CatchPokemons);
    for (let i = 0; i < REGEN_ITERATIONS; i++){
        await page.waitForTimeout(REGEN_WAIT_MINUTES * 60 * 1000);
        await page.reload();
        log.info("Odnowienie PA", {
          time: new Date().toLocaleTimeString(),
          minutesLeft: (REGEN_ITERATIONS - 1 - i) * REGEN_WAIT_MINUTES
        });
    }

    if (new Date().getHours()==0 && new Date().getMinutes()<30){
      log.info("Trwa przerwa na serwerze - czekamy 30 minut");
      await page.waitForTimeout(30*60*1000);
    }
  } catch (error) {
    log.error("Error in main loop", { error: String(error), stack: error?.stack });
    await page.waitForTimeout(5000); // Wait before retrying
  }
}
})().catch((error) => {
  log.error('Fatal error', { error: String(error), stack: error?.stack });
});

// 6. (Opcjonalnie) robimy zrzut ekranu po zalogowaniu
  
// 7. Zamykamy przeglądarkę po kilku sekundach (dla testów)
  

