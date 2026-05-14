require('dotenv').config(); // Wczytujemy login i hasło z pliku .env
const { chromium } = require('playwright'); // Importujemy przeglądarkę
const { CheckPA, ClickAdventure, CheckIfPokemon,
   CatchPokemon, ClickPokemon,
   CancelActivity, StartActivity,
   CheckHP, ClickHospital,
   SellPokemon, login, isSessionAlive }  = require('./actions');
const { loadFromFile, saveToFile } = require('./utils/fileOperations');
const { CheckIfGoodEvent,CheckIfBadEvent, CheckActivity}=require('./events');
const path = require('path');
const { runDailyActions } = require('./dailyActions');
const { logger } = require('./utils/logger');

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

  const loggedIn = await login(page, credentials);
  if (!loggedIn) {
    log.error('Logowanie nieudane. Sprawdź dane logowania w pliku .env.');
    await browser.close();
    return;
  }

while (true){
  try {
    if (!(await isSessionAlive(page))) {
      log.warn('Sesja wygasła, ponawiam logowanie...');
      const relogged = await login(page, credentials);
      if (!relogged) {
        log.error('Ponowne logowanie nieudane. Przerywam.');
        break;
      }
    }
  const accountConfig= await loadFromFile(configPath);
  if (process.env.POKE_ADVENTURE_NR) {
    const parsedAdventureNr = parseInt(process.env.POKE_ADVENTURE_NR, 10);
    if (!Number.isNaN(parsedAdventureNr)) {
      accountConfig.adventureNr = parsedAdventureNr;
    } else {
      log.warn("Niepoprawna wartość POKE_ADVENTURE_NR, używam wartości z config.json");
    }
  }
  log.info(`Załadowana konfiguracja: Region ${accountConfig.region}, Atakujący pokemon ${accountConfig.pokemonIndex + 1}, Numer przygody ${accountConfig.adventureNr}`);
  const region=locations[accountConfig.region];
  const locationKey = String(accountConfig.adventureNr);
  const locationInfo = region[locationKey];
  const paBuffer = accountConfig.paBuffer || 0;
  await runDailyActions(page);
  await SellPokemon(page, accountConfig.sellablePokemon);

  if( (await CheckPA(page)).currentPA > locationInfo.requiredPA + paBuffer ){
    if (await CheckActivity(page)){
      await CancelActivity(page);
    }

  while ((await CheckPA(page)).currentPA >= locationInfo.requiredPA + paBuffer){
    log.info("Wystarczająca ilość PA");

    if ((await CheckHP(page)).currentHP < HP_THRESHOLD){
      log.warn("Niskie HP, idę do Centrum Pokemon");
      await ClickHospital(page);
    }
    
    await ClickAdventure(page,accountConfig,locations);

    await CheckIfGoodEvent(page)
    await CheckIfBadEvent(page)
    const pokemonInfo= await CheckIfPokemon(page);
      if (pokemonInfo.isPokemon){
        if (pokemonInfo.level>45){
            await ClickPokemon(page,accountConfig.pokemonIndex);
        }else{
          await ClickPokemon(page,0);
        }

        if (await CheckIfGoodEvent(page)==3){
          await CatchPokemon(page,pokemonInfo,locationInfo);
          }

      }else{
        log.info("Brak Pokemona na przygodzie");
      }
      await page.waitForTimeout(ADVENTURE_TIMEOUT);
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

    if (await CheckActivity(page)==false && (await CheckPA(page)).currentPA<locationInfo.requiredPA){
      await StartActivity(page);
    }
    await page.reload();
    log.info("Czekam na odnowienie punktów akcji");

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
  

