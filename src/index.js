require('dotenv').config({ path: require('path').resolve(__dirname, '..', process.env.NODE_ENV === 'production' ? '.env.production' : '.env') }); // Wczytujemy login i hasło z pliku .env
const { chromium } = require('playwright'); // Importujemy przeglądarkę
const { CheckPA, CheckStorage, ClickAdventure, CheckIfPokemon,
   CatchPokemon, ClickPokemon, CheckUltraBeast,
   CancelActivity, StartActivity,
   CheckHP, ClickHospital,
   SellPokemon, login, isSessionAlive, UpdateTeamIfDue }  = require('./actions');
const { loadTeam, findMatchingTeamIndex } = require('./actions/team');
const { loadFromFile, saveToFile } = require('./utils/fileOperations');
const { CheckIfGoodEvent,CheckIfBadEvent, CheckActivity}=require('./events');
const path = require('path');
const { runDailyActions, runCareIfNeeded, runAssociationPAIfNeeded, runPABerriesIfNeeded, areAllDailysDone, getDailyRunKey, navigateViaMenu } = require('./dailyActions');
const { OpenBackpackAndUpdate, PublishSavedEquipment, UseRepel } = require('./actions/equipment');
const { logger } = require('./utils/logger');
const { startServer } = require('./server');
const state = require('./state');

const log = logger.child({ module: 'main' });

// Constants
const HP_THRESHOLD = 15;
const ADVENTURE_TIMEOUT = 3000;
const REGEN_WAIT_MINUTES = 12;
const REGEN_ITERATIONS = 10;
// Poniżej tego poziomu wybieramy do walki pokemona o wspólnym typie.
const SAME_TYPE_MAX_LV = 50;

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

  // Na serwerze (VPS bez pulpitu) ustaw HEADLESS=true w .env.
  // Lokalnie domyślnie widoczne okno przeglądarki.
  const headless = String(process.env.HEADLESS || '').toLowerCase() === 'true';
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  startServer();

  // Panel od razu pokazuje ostatnio znany stan plecaka,
  // zanim bot po raz pierwszy do niego zajrzy.
  await PublishSavedEquipment();

  const loggedIn = await login(page, credentials);
  if (!loggedIn) {
    log.error('Logowanie nieudane. Sprawdź dane logowania w pliku .env.');
    await browser.close();
    return;
  }

// Domyślne ustawienia auto-Tepela/Repela, gdy brak ich w config.json.
const AUTO_REPEL_DEFAULT_MIN = 2;

// Aktywuje Tepel/Repel, gdy licznik spadł poniżej progu, albo gdy panel web
// zlecił użycie konkretnego przedmiotu. Uruchamiane tuż po sprawdzeniu HP,
// przed wysłaniem na wyprawę. Nigdy nie przerywa głównej pętli.
async function AutoUseRepelIfNeeded(page, accountConfig) {
  try {
    const { repel, useRepelRequest, equipment } = state.getState();

    // Zlecenie z panelu ma pierwszeństwo przed automatem.
    if (useRepelRequest) {
      const { kind, tier } = useRepelRequest;
      state.setUseRepelRequest(null);   // czyścimy od razu, by nie powtórzyć
      log.info(`Tepel/Repel: zlecenie z panelu - ${kind} ${tier}.`);
      await UseRepel(page, kind, tier, navigateViaMenu);
      return;
    }

    if (accountConfig.autoRepelEnabled === false) return;

    const min = Number.isFinite(Number(accountConfig.autoRepelMin))
      ? Number(accountConfig.autoRepelMin)
      : AUTO_REPEL_DEFAULT_MIN;

    // Brak licznika = nic nie działa, więc też odnawiamy.
    const value = repel?.value;
    if (value !== undefined && value !== null && value >= min) return;

    const kind = accountConfig.autoRepelKind === 'tepel' ? 'tepel' : 'repel';
    const tier = Number(accountConfig.autoRepelTier) || 1;

    // Wybrany poziom może się skończyć — wtedy bierzemy inny, jaki mamy.
    const stock = equipment?.repels;
    let useTier = tier;
    if (stock && !(stock[`${kind}-${tier}`] > 0)) {
      const fallback = [1, 2, 3].find(t => stock[`${kind}-${t}`] > 0);
      if (!fallback) {
        log.warn(`Tepel/Repel: brak ${kind}i w plecaku - pomijam aktywację.`);
        return;
      }
      log.info(`Tepel/Repel: brak poziomu ${tier}, używam ${fallback}.`);
      useTier = fallback;
    }

    log.info(`Tepel/Repel: licznik ${value ?? 'brak'} < ${min} - aktywuję.`);
    await UseRepel(page, kind, useTier, navigateViaMenu);
  } catch (e) {
    log.warn('Tepel/Repel: auto-aktywacja nieudana', { error: String(e) });
  }
}

// Dokleja pokemona do listy w config.json bez nadpisywania zmian z panelu web.
// Czyta świeży plik z dysku, dopisuje tylko do wskazanej listy, zapisuje i
// synchronizuje kopię w pamięci (accountConfig), by kolejne zapisy bota nie
// przywróciły starego stanu.
async function appendToConfigList(configPath, accountConfig, listKey, pokemon) {
  const fresh = await loadFromFile(configPath);
  if (!fresh) {
    log.warn(`Nie udało się wczytać config.json — pomijam zapis ${listKey}: ${pokemon}`);
    return false;
  }
  if (!Array.isArray(fresh[listKey])) fresh[listKey] = [];
  if (fresh[listKey].includes(pokemon)) {
    accountConfig[listKey] = fresh[listKey];   // sync in-memory z dyskiem
    return false;
  }
  fresh[listKey].push(pokemon);
  await saveToFile(configPath, fresh);
  accountConfig[listKey] = fresh[listKey];      // sync in-memory z dyskiem
  return true;
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
    // Pokemony chronione nigdy nie trafiają na listę do sprzedaży.
    const protectedList = Array.isArray(accountConfig.protectedPokemon) ? accountConfig.protectedPokemon : [];
    if (protectedList.includes(pokemonInfo.pokemon)) {
      log.info(`Pominięto dodanie do sellablePokemon – pokemon chroniony: ${pokemonInfo.pokemon}`);
      return;
    }
    if (!Array.isArray(accountConfig.sellablePokemon)) accountConfig.sellablePokemon = [];
    const added = await appendToConfigList(configPath, accountConfig, 'sellablePokemon', pokemonInfo.pokemon);
    if (added) log.info(`Dodano do sellablePokemon (trudność ${diff}): ${pokemonInfo.pokemon}`);
    return;
  }

  const listKey = diffListMap[diff];
  if (!listKey) return;

  if (!Array.isArray(accountConfig[listKey])) accountConfig[listKey] = [];
  const added = await appendToConfigList(configPath, accountConfig, listKey, pokemonInfo.pokemon);
  if (added) log.info(`Dodano do ${listKey} (trudność ${diff}): ${pokemonInfo.pokemon}`);
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
  // Odczyt drużyny nie częściej niż raz na 30 minut. Błąd/brak panelu jest
  // pomijany — kolejna próba nastąpi w następnym przebiegu pętli.
  // Przycisk w panelu web ustawia forceTeamUpdate i wymusza odczyt od razu.
  const forceTeam = state.getState().forceTeamUpdate;
  const teamResult = await UpdateTeamIfDue(page, { force: forceTeam });
  if (forceTeam) state.setForceTeamUpdate(false);
  if (teamResult?.team) state.setTeamLastUpdated(new Date().toISOString());
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
  await SellPokemon(page, accountConfig.sellablePokemon, accountConfig.diff3CatchPokemons, accountConfig.protectedPokemon, accountConfig.diff4CatchPokemons, {
    sellThreshold: accountConfig.sellThreshold,
    limitsEnabled: accountConfig.limitsEnabled,
    diff3Keep: accountConfig.diff3Keep,
    diff4Keep: accountConfig.diff4Keep,
  });

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
    state.updateStats({ hp: { current: hpResult.currentHP, max: hpResult.maxHP }, repel: hpResult.repel });
    if (hpResult.currentHP < HP_THRESHOLD){
      log.warn("Niskie HP, idę do Centrum Pokemon");
      const hpAfterHospital = await ClickHospital(page);
      state.updateStats({ hp: { current: hpAfterHospital.currentHP, max: hpAfterHospital.maxHP }, repel: hpAfterHospital.repel });
    }
    
    // Tepel/Repel odnawiamy tuż przed wyprawą — licznik jest już świeży
    // po odczycie HP powyżej (oba pola czytane są z tego samego kontenera).
    await AutoUseRepelIfNeeded(page, accountConfig);

    await runCareIfNeeded(page);
    state.updateStats({ lastEvent: 'adventure_started' });
    await ClickAdventure(page,accountConfig,locations);

    await CheckIfGoodEvent(page)
    await CheckIfBadEvent(page)

    // Szczelina z Ultra Bestią pojawia się zamiast zwykłego spotkania.
    // Po wejściu w portal Bestia czeka jak zwykły pokemon — trzeba wysłać
    // do niej pokemona z drużyny, a dopiero po wygranej rzucić beastballem.
    const ultraBeast = await CheckUltraBeast(page);

    const pokemonInfo= await CheckIfPokemon(page);

    if (ultraBeast) {
      state.updateStats({ lastEvent: 'ultra_beast' });
      if (pokemonInfo.isPokemon) {
        log.info(`Ultra Bestia: ${pokemonInfo.pokemon} (poziom ${pokemonInfo.level}) - wysyłam pokemona do walki.`);

        // Bestie są wysokopoziomowe, więc do walki idzie główny pokemon.
        const team = await loadTeam();
        const battleIndex = accountConfig.pokemonIndex;
        await ClickPokemon(page, battleIndex);

        // Beastballa rzucamy dopiero po wygranej (tak jak przy zwykłym
        // spotkaniu) — inaczej ekranu łapania jeszcze nie ma.
        if (await CheckIfGoodEvent(page) == 3) {
          log.info('Ultra Bestia: walka wygrana - rzucam beastballem.');
          await CatchPokemon(page, pokemonInfo, locationInfo, accountConfig.region,
            team[battleIndex] || null, { ultraBeast: true });
          state.updateStats({ lastEvent: 'ultra_beast_caught' });
        } else {
          log.warn('Ultra Bestia: walka nie zakończyła się zwycięstwem.');
        }
      } else {
        log.info('Ultra Bestia: po przejściu portalu brak pokemona.');
      }
    }

      if (pokemonInfo.isPokemon && !ultraBeast){
        await categorizePokemon(pokemonInfo, accountConfig, configPath);

        // Poniżej 50 poziomu wysyłamy do walki pokemona o typie wspólnym
        // z łapanym. Gdy takiego nie ma, wracamy do wyboru wg poziomu.
        const team = await loadTeam();
        let battleIndex = null;
        if (pokemonInfo.level < SAME_TYPE_MAX_LV) {
          const matchIndex = findMatchingTeamIndex(team, pokemonInfo.types);
          if (matchIndex !== -1) {
            battleIndex = matchIndex;
            log.info(`Wspólny typ – wysyłam ${team[matchIndex].name} (slot ${matchIndex + 1})`);
          }
        }
        if (battleIndex === null) {
          battleIndex = pokemonInfo.level > accountConfig.secondPokMaxLv
            ? accountConfig.pokemonIndex
            : accountConfig.SecondPokemonIndex;
        }
        await ClickPokemon(page, battleIndex);
        const battleSlot = team[battleIndex] || null;

        if (await CheckIfGoodEvent(page)==3){
          await CatchPokemon(page,pokemonInfo,locationInfo,accountConfig.region,battleSlot,
            { saveSafariBall: accountConfig.saveSafariBall });
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
        state.updateStats({ hp: { current: hpAfterForce.currentHP, max: hpAfterForce.maxHP }, repel: hpAfterForce.repel });
        state.setForceHospital(false);
      }
      // Przycisk "Odczytaj z gry" — obsługujemy też tutaj, bo bot spędza
      // większość czasu w tej pętli, a nie na początku pętli głównej.
      if (state.getState().forceTeamUpdate) {
        log.info('Wymuszony odczyt drużyny z panelu web');
        await UpdateTeamIfDue(page, { force: true });
        state.setForceTeamUpdate(false);
        state.setTeamLastUpdated(new Date().toISOString());
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
      // Zapisz TYLKO adventureNr na świeżej kopii z dysku, by nie nadpisać
      // zmian list zrobionych w panelu web.
      const fresh = await loadFromFile(configPath);
      if (fresh) {
        fresh.adventureNr = accountConfig.adventureNr;
        await saveToFile(configPath, fresh);
      } else {
        await saveToFile(configPath, accountConfig);
      }
      log.info(`randomAdventure: następna lokacja → ${accountConfig.adventureNr} (${nonSpecial[nextIdx][1].name})`);
    }

    const activityCheck = await CheckActivity(page);
    state.updateStats({ activity: { active: !!activityCheck } });
    const paCheck = await CheckPA(page);
    state.updateStats({ pa: { current: paCheck.currentPA, max: paCheck.maxPA } });
    if (activityCheck === false && paCheck.currentPA < locationInfo.requiredPA){
      // activityMode z panelu web: 'trening' (domyslnie) albo 'praca'.
      const mode = accountConfig.activityMode === 'praca' ? 'praca' : 'trening';
      await StartActivity(page, mode);
      state.updateStats({ activity: { active: true } });
      // Po wysłaniu na trening odświeżamy stan plecaka. Ustawienia auto-Tepela
      // decyduja, o ktorym Tepelu/Repelu w ogole alarmowac.
      await OpenBackpackAndUpdate(page, navigateViaMenu, {
        autoRepelKind: accountConfig.autoRepelKind,
        autoRepelTier: accountConfig.autoRepelTier,
      });
    }
    await page.reload();
    log.info("Czekam na odnowienie punktów akcji");
    state.updateStats({ lastEvent: 'waiting_for_pa_regen' });
    await SellPokemon(page, accountConfig.sellablePokemon, accountConfig.diff3CatchPokemons, accountConfig.protectedPokemon, accountConfig.diff4CatchPokemons, {
    sellThreshold: accountConfig.sellThreshold,
    limitsEnabled: accountConfig.limitsEnabled,
    diff3Keep: accountConfig.diff3Keep,
    diff4Keep: accountConfig.diff4Keep,
  });
    let lastDailyCheckHour = -1;
    let lastDailyCheckKey = null;
    for (let i = 0; i < REGEN_ITERATIONS; i++){
        await page.waitForTimeout(REGEN_WAIT_MINUTES * 60 * 1000);
        await page.reload();
        log.info("Odnowienie PA", {
          time: new Date().toLocaleTimeString(),
          minutesLeft: (REGEN_ITERATIONS - 1 - i) * REGEN_WAIT_MINUTES
        });
        // Przycisk "Odczytaj z gry" działa też podczas oczekiwania na PA.
        if (state.getState().forceTeamUpdate) {
          log.info('Wymuszony odczyt drużyny z panelu web');
          await UpdateTeamIfDue(page, { force: true });
          state.setForceTeamUpdate(false);
          state.setTeamLastUpdated(new Date().toISOString());
        }
        // Sprawdzamy raz na godzinę, ale też natychmiast po przekroczeniu
        // godziny resetu dziennego - inaczej pierwsza szansa na nowe dailys
        // wypadałaby dopiero przy najbliższej pełnej godzinie.
        const currentHour = new Date().getHours();
        const currentDayKey = getDailyRunKey();
        const dayRolled = lastDailyCheckKey !== null && currentDayKey !== lastDailyCheckKey;
        if (currentHour !== lastDailyCheckHour || dayRolled) {
          lastDailyCheckHour = currentHour;
          lastDailyCheckKey = currentDayKey;
          if (!areAllDailysDone()) {
            const reason = dayRolled ? 'reset dzienny' : 'sprawdzenie co godzinę';
            log.info(`${reason}: nie wszystkie daily wykonane - uruchamiam runDailyActions.`);
            await runDailyActions(page);
          } else {
            log.info('Sprawdzenie co godzinę: wszystkie daily wykonane.');
          }
        }
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
  

