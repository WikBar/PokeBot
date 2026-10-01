require('dotenv').config({ path: require('path').resolve(__dirname, '..', process.env.NODE_ENV === 'production' ? '.env.production' : '.env') }); // Wczytujemy login i hasło z pliku .env
const { chromium } = require('playwright'); // Importujemy przeglądarkę
const { CheckPA, CheckStorage, ClickAdventure, CheckIfPokemon,
   CatchPokemon, ClickPokemon, CheckUltraBeast, IsGoldenNest,
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
const { notifyShinyHold, notifyShinyNextLocation, notifyGoldenNest, notifyGoldenNestResult, sendNotification } = require('./utils/notifier');
const { acquireLock, releaseLock } = require('./utils/instanceLock');
const { validateConfig, validateLocations } = require('./validation/config');
const { startServer } = require('./server');
const state = require('./state');
const { isSpecialLocationDay, pickNextLocation } = require('./logic/locations');
const { createShinyState, maxTriesFrom, shinyStep } = require('./logic/shiny');
const { targetListFor } = require('./logic/categorize');
const { decideRepelUse } = require('./logic/repel');
const { resolveRuntime } = require('./logic/runtime');
const { loadRuntime, saveRuntime } = require('./utils/runtimeStore');

const log = logger.child({ module: 'main' });

// Constants
const HP_THRESHOLD = 15;
// Przerwa po kazdej wyprawie. ClickAdventure czeka juz na networkidle,
// wiec to tylko zapas bezpieczenstwa - stad da sie ja skrocic.
// Regulowana z panelu (adventureDelay w config.json); ponizej 300 ms
// nie schodzimy, zeby nie zasypywac serwera gry zadaniami.
const ADVENTURE_TIMEOUT_DEFAULT = 3000;
const ADVENTURE_TIMEOUT_MIN = 300;
const REGEN_WAIT_MINUTES = 12;
const REGEN_ITERATIONS = 10;
// Prog Golden Nest - uzywany tylko przy przegranej walce, gdy CatchPokemon
// (ktore normalnie rozpoznaje gniazdo) w ogole sie nie wykonuje.
const GOLDEN_NEST_MIN_LV = 75;
// Poniżej tego poziomu wybieramy do walki pokemona o wspólnym typie.
const SAME_TYPE_MAX_LV = 50;

(async () => {
  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection', { reason: String(reason) });
  });
  process.on('uncaughtException', (error) => {
    log.error('Uncaught exception', { error: String(error), stack: error?.stack });
  });

  // Druga instancja na tym samym katalogu = dwa boty na jednym koncie,
  // ktore nadpisuja sobie config. Konczymy, zanim cokolwiek uruchomimy.
  const lock = acquireLock();
  if (!lock.ok) {
    log.error(`Bot już działa (PID ${lock.pid}) - kończę, żeby nie uruchomić drugiej instancji.`);
    process.exit(1);
  }
  process.on('exit', () => releaseLock());

  const locationsPath = path.resolve(__dirname, '..', 'config', 'locations.json');
  const configPath = path.resolve(__dirname, '..', 'config', 'config.json');
  const teamPath = path.resolve(__dirname, '..', 'config', 'team.json');
  const locations = await loadFromFile(locationsPath);
  // Bez poprawnych lokacji bot nie ruszy - lepiej zakonczyc od razu niz
  // krecic petla bledow (pm2 zrestartuje proces).
  const locationsCheck = validateLocations(locations);
  if (locationsCheck.errors.length > 0) {
    log.error('locations.json niepoprawny', { errors: locationsCheck.errors });
    await sendNotification(`PokeBot: locations.json niepoprawny - bot nie wystartuje.\n- ${locationsCheck.errors.join('\n- ')}`);
    process.exit(1);
  }


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
    // Serwer Express trzymalby proces przy zyciu - pm2 nie zrobilby restartu.
    process.exit(1);
  }


// Aktywuje Tepel/Repel, gdy licznik spadł poniżej progu, albo gdy panel web
// zlecił użycie konkretnego przedmiotu. Uruchamiane tuż po sprawdzeniu HP,
// przed wysłaniem na wyprawę. Nigdy nie przerywa głównej pętli.
async function AutoUseRepelIfNeeded(page, accountConfig) {
  try {
    const { repel, useRepelRequest, equipment } = state.getState();
    const decision = decideRepelUse({ repel, useRepelRequest, stock: equipment?.repels }, accountConfig);

    if (decision.source === 'panel') {
      state.setUseRepelRequest(null);   // czyścimy od razu, by nie powtórzyć
      log.info(`Tepel/Repel: zlecenie z panelu - ${decision.use.kind} ${decision.use.tier}.`);
    } else if (decision.skip === 'noStock') {
      log.warn(`Tepel/Repel: brak ${decision.kind}i w plecaku - pomijam aktywację.`);
      return;
    } else if (decision.skip) {
      return;
    } else {
      if (decision.fallbackFrom) {
        log.info(`Tepel/Repel: brak poziomu ${decision.fallbackFrom}, używam ${decision.use.tier}.`);
      }
      log.info(`Tepel/Repel: licznik ${decision.value ?? 'brak'} < ${decision.min} - aktywuję.`);
    }
    await UseRepel(page, decision.use.kind, decision.use.tier, navigateViaMenu);
  } catch (e) {
    log.warn('Tepel/Repel: auto-aktywacja nieudana', { error: String(e) });
  }
}

// Ostatni config, ktory przeszedl walidacje, i klucze juz zgloszonych
// problemow (zeby nie zasypywac logu i Telegrama co wyprawe).
let lastGoodConfig = null;
let reportedConfigErrors = '';
let reportedConfigWarnings = '';
// Stan roboczy (biezaca lokacja z rotacji + stan Shiny) - patrz
// logic/runtime.js. Wczytany z dysku, wiec blokada Golden Nest przezywa
// restart; loadCheckedConfig odrzuci go, jesli config wskazuje inna lokacje.
let runtime = loadRuntime();
// Stan trybu Shiny - patrz logic/shiny.js.
let shiny = runtime?.shiny || null;
let firstConfigLoad = true;

// Wczytuje config.json z walidacja. Zepsuty plik (np. same zera po zaniku
// pradu) albo bledne wartosci nie zatrzymuja bota: zostaje na ostatnim
// poprawnym configu, a problem idzie raz do logu i na Telegram.
// Rzuca wyjatek tylko wtedy, gdy poprawnego configu nie bylo jeszcze nigdy.
async function loadCheckedConfig() {
  let cfg = await loadFromFile(configPath);
  const team = (await loadFromFile(teamPath))?.team || null;
  const { errors, warnings } = validateConfig(cfg, locations, team);

  if (errors.length > 0) {
    const key = errors.join('|');
    if (key !== reportedConfigErrors) {
      reportedConfigErrors = key;
      log.error('Config niepoprawny', { errors });
      await sendNotification(`PokeBot: config.json niepoprawny${lastGoodConfig ? ' - zostaję na poprzednim' : ''}:\n- ${errors.join('\n- ')}`);
    }
    if (!lastGoodConfig) {
      // Bez poprawnego configu nie da sie nic zrobic - czekamy dluzej niz
      // zwykle 5 s petli glownej, zeby nie mielic logu.
      await new Promise((resolve) => setTimeout(resolve, 60 * 1000));
      throw new Error(`Brak poprawnego config.json: ${errors[0]}`);
    }
    cfg = { ...lastGoodConfig };
  } else {
    if (reportedConfigErrors) {
      log.info('Config znów poprawny.');
      reportedConfigErrors = '';
    }
    const warnKey = warnings.join('|');
    if (warnings.length > 0 && warnKey !== reportedConfigWarnings) {
      log.warn('Ostrzeżenia configu', { warnings });
    }
    reportedConfigWarnings = warnKey;
    lastGoodConfig = { ...cfg };
  }

  // Biezaca lokacja z rotacji (runtime-state.json) zamiast adventureNr
  // z configu - chyba ze uzytkownik zmienil region albo lokacje w configu.
  const resolved = resolveRuntime(cfg, runtime, locations[cfg.region]);
  if (resolved.status !== 'kept') {
    if (resolved.status === 'reset') {
      log.info(`Zmiana lokacji w configu (${cfg.region} ${cfg.adventureNr}) - rotacja i stan Shiny od nowa.`);
    } else if (resolved.status === 'invalid') {
      log.warn('runtime-state.json wskazuje nieistniejącą lokację - zaczynam od configu.');
    }
    runtime = resolved.runtime;
    shiny = createShinyState(runtime.adventureNr);
    await saveRuntime(runtime);
  }
  cfg.adventureNr = runtime.adventureNr;

  if (process.env.POKE_ADVENTURE_NR) {
    const parsedAdventureNr = parseInt(process.env.POKE_ADVENTURE_NR, 10);
    if (!Number.isNaN(parsedAdventureNr)) {
      cfg.adventureNr = parsedAdventureNr;
    } else {
      log.warn("Niepoprawna wartość POKE_ADVENTURE_NR, używam wartości z config.json");
    }
  }

  // Po starcie nie wiemy, na jakiej wyprawie gra zostala - klikamy lokacje
  // wprost zamiast "Kontynuuj".
  if (firstConfigLoad) {
    cfg.adventureChanged = true;
    firstConfigLoad = false;
  } else {
    delete cfg.adventureChanged;
  }
  return cfg;
}

// Zapisuje stan Shiny w runtime-state.json (przezywa restart).
async function persistShiny() {
  runtime = { ...runtime, shiny };
  await saveRuntime(runtime);
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

// Przechodzi na kolejna nie-specjalna lokacje w regionie (tryb Shiny
// i randomAdventure - wybor w logic/locations.js).
// Nowa lokacja idzie do runtime-state.json, nie do config.json - config
// zostaje ustawieniem uzytkownika (patrz logic/runtime.js).
// Zwraca { nr, name } albo null, gdy zmiana sie nie powiodla.
async function advanceToNextLocation(region, accountConfig, reason, options = {}) {
  const label = options.label || 'Shiny';
  const next = pickNextLocation(region, accountConfig.adventureNr, accountConfig.skippedAdventures, options);
  if (!next) {
    log.warn(`${label}: brak nie-specjalnych lokacji w regionie - zostaje na miejscu.`);
    return null;
  }
  if (next.ignoredSkipped) {
    log.warn(`${label}: pominięto wszystkie lokacje w regionie - ignoruję listę pominiętych.`);
  }

  runtime = { ...runtime, adventureNr: next.nr };
  await saveRuntime(runtime);

  accountConfig.adventureNr = next.nr;
  accountConfig.adventureChanged = true;   // wymusza klikniecie nowej lokacji
  log.info(`${label}: ${reason} → lokacja ${next.nr} (${next.name})`);
  return { nr: next.nr, name: next.name };
}

async function categorizePokemon(pokemonInfo, accountConfig, configPath) {
  const diff = pokemonInfo.catchDiff;
  const target = targetListFor(diff, pokemonInfo.pokemon, accountConfig.protectedPokemon);
  if (target.skip === 'protected') {
    // Pokemony chronione nigdy nie trafiają na listę do sprzedaży.
    log.info(`Pominięto dodanie do sellablePokemon – pokemon chroniony: ${pokemonInfo.pokemon}`);
    return;
  }
  if (!target.listKey) return;

  if (!Array.isArray(accountConfig[target.listKey])) accountConfig[target.listKey] = [];
  const added = await appendToConfigList(configPath, accountConfig, target.listKey, pokemonInfo.pokemon);
  if (added) log.info(`Dodano do ${target.listKey} (trudność ${diff}): ${pokemonInfo.pokemon}`);
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
  let accountConfig = await loadCheckedConfig();
  state.updateStats({ region: accountConfig.region, adventureNr: accountConfig.adventureNr });
  log.info(`Załadowana konfiguracja: Region ${accountConfig.region}, Atakujący pokemon ${accountConfig.pokemonIndex + 1}, Numer przygody ${accountConfig.adventureNr}`);
  const region=locations[accountConfig.region];
  const locationKey = String(accountConfig.adventureNr);
  // Nie const - tryb Shiny zmienia lokacje w trakcie petli wypraw.
  let locationInfo = region[locationKey];
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
  // Stan trybu Shiny (proby, blokada Golden Nest) zyje poza petla glowna -
  // wczesniej zerowal sie po kazdym odnowieniu PA i blokada przepadala.
  if (!shiny) shiny = createShinyState(accountConfig.adventureNr);
  // Przezywa przeladowanie configu z dysku - inaczej flaga adventureChanged
  // ginie i bot klika "Kontynuuj" zamiast wejsc na nowa lokacje.
  let shinyLocationChanged = false;

  // Lokacja specjalna poza piatkiem/sobota/niedziela jest niedostepna -
  // wracamy na pierwsza lokacje, zanim bot sprobuje tam wyruszyc.
  if (accountConfig.shinyHunt && locationInfo?.isSpecial && !isSpecialLocationDay()) {
    const reset = await advanceToNextLocation(
      region, accountConfig,
      'lokacja specjalna niedostępna w tym dniu - wracam na początek',
      { fromStart: true });
    if (reset !== null) {
      locationInfo = region[String(reset.nr)] || locationInfo;
      shiny = createShinyState(reset.nr);
      await persistShiny();
      shinyLocationChanged = true;
      state.updateStats({ adventureNr: reset.nr });
    }
  }
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
    // Ustawiane przez CatchPokemon dokladnie wtedy, gdy poszlo powiadomienie
    // o Golden Nest (pokemon 75+ faktycznie do zlapania). Zerowane co wyprawe.
    let goldenNestFound = false;
    let goldenNestCaught = false;
    await ClickAdventure(page,accountConfig,locations);

    await CheckIfGoodEvent(page)
    await CheckIfBadEvent(page)

    // Szczelina z Ultra Bestią pojawia się zamiast zwykłego spotkania.
    // Po wejściu w portal Bestia czeka jak zwykły pokemon — trzeba wysłać
    // do niej pokemona z drużyny, a dopiero po wygranej rzucić beastballem.
    const ultraBeast = await CheckUltraBeast(page);

    const pokemonInfo= await CheckIfPokemon(page);

    // Golden Nest = drugi przycisk "Kontynuuj" AND pokemon powyzej 75 poziomu.
    // Sam przycisk nie wystarcza: bywa aktywny takze przy Ultra Bestii
    // i na ekranach bez pokemona. Sprawdzamy przed klinieciem czegokolwiek.
    const isGoldenNest = !ultraBeast
      && pokemonInfo.isPokemon
      && pokemonInfo.level > GOLDEN_NEST_MIN_LV
      && await IsGoldenNest(page);
    if (isGoldenNest) {
      log.info(`Golden Nest potwierdzony: ${pokemonInfo.pokemon} (poziom ${pokemonInfo.level}).`);
    }

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

        const battleWon = await CheckIfGoodEvent(page) == 3;
        if (battleWon){
          const catchResult = await CatchPokemon(page,pokemonInfo,locationInfo,accountConfig.region,battleSlot,
            { saveSafariBall: accountConfig.saveSafariBall, goldenNest: isGoldenNest,
              strongBallPokemons: accountConfig.strongBallPokemons });
          // goldenNest=false przy potwierdzonym gniezdzie = kuli nie bylo na
          // ekranie, wiec nie bylo rzutu i nie ma czego pilnowac blokada.
          if (isGoldenNest && catchResult?.goldenNest) {
            goldenNestFound = true;
            goldenNestCaught = !!catchResult.caught;
          } else if (isGoldenNest) {
            log.warn('Golden Nest: brak rzutu (nie było kuli) - nie blokuję lokacji.');
          }
          state.updateStats({ lastEvent: 'pokemon_caught' });
          }
        else if (isGoldenNest) {
          // Przegrana walka w Golden Nescie: CatchPokemon w ogole sie nie
          // wykonuje, wiec powiadomienia musza wyjsc stad. Gniazdo zostaje
          // aktywne, wiec traktujemy to jak nieudana probe (blokada).
          log.warn(`Golden Nest: przegrana walka z ${pokemonInfo.pokemon} (poziom ${pokemonInfo.level}).`);
          await notifyGoldenNest({
            region: accountConfig.region,
            location: locationInfo?.name,
            pokemon: pokemonInfo.pokemon,
            level: pokemonInfo.level,
          });
          await notifyGoldenNestResult({
            pokemon: pokemonInfo.pokemon,
            level: pokemonInfo.level,
            caught: false,
            reason: 'przegrana walka',
          });
          goldenNestFound = true;
          goldenNestCaught = false;
        }

      }else{
        log.info("Brak Pokemona na przygodzie");
      }

      // Tryb Shiny: liczymy wyprawy na tej lokacji. Golden Nest (pokemon
      // powyzej 75 poziomu) zeruje licznik - zostajemy i szukamy dalej.
      // Po wyczerpaniu prob idziemy na kolejna lokacje.
      if (accountConfig.shinyHunt) {
        // Decyzja w logic/shiny.js, tutaj tylko wykonanie akcji.
        const maxTries = maxTriesFrom(accountConfig);
        const step = shinyStep(shiny, {
          adventureNr: accountConfig.adventureNr,
          goldenNestFound,
          goldenNestCaught,
          maxTries,
        });
        shiny = step.state;
        const action = step.action;

        if (action.type === 'advance' && action.reason === 'caught') {
          log.info(`Shiny: Golden Nest (${pokemonInfo.pokemon}, poziom ${pokemonInfo.level}) złapany na lokacji ${accountConfig.adventureNr}.`);
          const next = await advanceToNextLocation(
            region, accountConfig, 'Golden Nest złapany');
          if (next !== null) {
            shiny.locationNr = next.nr;
            shinyLocationChanged = true;
            await notifyShinyNextLocation({
              pokemon: pokemonInfo.pokemon,
              nextLocation: next.name,
            });
          }
        } else if (action.type === 'holdStart') {
          log.info(`Shiny: Golden Nest (${pokemonInfo.pokemon}, poziom ${pokemonInfo.level}) NIE złapany - zostaję na lokacji ${accountConfig.adventureNr} na ${shiny.hold} wypraw.`);
        } else if (action.type === 'hold') {
          log.info(`Shiny: blokada po Golden Nest - zostaję na lokacji ${accountConfig.adventureNr} jeszcze ${shiny.hold} wypraw.`);
          if (action.notify) {
            await notifyShinyHold({
              location: locationInfo?.name,
              remaining: shiny.hold,
            });
          }
        } else {
          log.info(`Shiny: próba ${action.tries}/${maxTries} na lokacji ${accountConfig.adventureNr} - brak Golden Nest.`);
          if (action.type === 'advance') {
            const next = await advanceToNextLocation(
              region, accountConfig, `${maxTries} wypraw bez Golden Nest`);
            if (next !== null) {
              shiny.locationNr = next.nr;
              shinyLocationChanged = true;
            }
          }
        }
        state.updateStats({ shiny: { tries: shiny.tries, maxTries, hold: shiny.hold, location: accountConfig.adventureNr } });
        await persistShiny();
      }

      // Wartosc czytana z configu przy kazdej iteracji, wiec zmiana
      // w panelu dziala od razu, bez restartu bota.
      const adventureDelay = Math.max(
        ADVENTURE_TIMEOUT_MIN,
        Number(accountConfig.adventureDelay) || ADVENTURE_TIMEOUT_DEFAULT
      );
      await page.waitForTimeout(adventureDelay);
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
      accountConfig = await loadCheckedConfig();
      // Tryb Shiny zmienil lokacje i zapisal ja na dysk, wiec porownanie
      // ponizej jej nie wykryje (prev == nowa). Flage trzeba przeniesc
      // recznie - przeladowanie configu skasowalo ta z pamieci.
      if (shinyLocationChanged) {
        accountConfig.adventureChanged = true;
        shinyLocationChanged = false;
      }
      if (accountConfig.adventureNr !== prevAdventureNr) {
        log.info(`Zmiana wyprawy: ${prevAdventureNr} → ${accountConfig.adventureNr} - flaga adventureChanged ustawiona.`);
        accountConfig.adventureChanged = true;
      }
      // locationInfo odswiezamy zawsze, nie tylko przy wykrytej zmianie:
      // tryb Shiny zmienia adventureNr w pamieci przed przeladowaniem, wiec
      // prev == nowa i stara lokacja zostawala (zla nazwa w powiadomieniach,
      // zle requiredPA i isSpecial przy wyborze kuli).
      const currentLocation = region[String(accountConfig.adventureNr)];
      if (currentLocation) {
        locationInfo = currentLocation;
      } else {
        log.warn(`Brak lokacji ${accountConfig.adventureNr} w regionie - zostawiam poprzednią.`);
      }
      state.updateStats({ region: accountConfig.region, adventureNr: accountConfig.adventureNr });

      await runAssociationPAIfNeeded(page);
      await runPABerriesIfNeeded(page);
    }
    }
    // Tryb Shiny sam przelacza lokacje po wyczerpaniu prob, wiec rotacja
    // randomAdventure musi ustapic - inaczej zmiana nastapilaby dwa razy.
    // Wspolna funkcja z trybem Shiny, wiec respektuje tez skippedAdventures.
    if (accountConfig.randomAdventure && !accountConfig.shinyHunt) {
      const next = await advanceToNextLocation(
        region, accountConfig, 'następna lokacja', { label: 'randomAdventure' });
      if (next) locationInfo = region[String(next.nr)] || locationInfo;
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
})().catch(async (error) => {
  log.error('Fatal error', { error: String(error), stack: error?.stack });
  // Serwer Express trzyma proces przy zyciu, wiec bez exit pm2 nigdy nie
  // zrestartowalby bota (01.10 bot stal tak 3,5 h). Kod 1 = restart przez pm2.
  await sendNotification(`PokeBot: błąd krytyczny, restartuję proces. ${String(error).slice(0, 200)}`);
  process.exit(1);
});

// 6. (Opcjonalnie) robimy zrzut ekranu po zalogowaniu
  
// 7. Zamykamy przeglądarkę po kilku sekundach (dla testów)
  

