const fs = require('fs');
const path = require('path');
const { logger } = require('./utils/logger');
const botState = require('./state');
const { CheckPA } = require('./actions/stats');

const log = logger.child({ module: 'dailyActions' });

const DAILY_RESET_HOUR = 0;
const DAILY_RESET_MINUTE = 30;
const DAILY_STATE_PATH = path.resolve(__dirname, '..', 'config', 'daily-state.json');


function getDailyRunKey(now = new Date()) {
  const shiftedDate = new Date(now);
  if (
    shiftedDate.getHours() < DAILY_RESET_HOUR ||
    (shiftedDate.getHours() === DAILY_RESET_HOUR && shiftedDate.getMinutes() < DAILY_RESET_MINUTE)
  ) {
    shiftedDate.setDate(shiftedDate.getDate() - 1);
  }
  return shiftedDate.toISOString().slice(0, 10);
}

function loadDailyState() {
  try {
    if (!fs.existsSync(DAILY_STATE_PATH)) return { actions: {} };
    const raw = fs.readFileSync(DAILY_STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return { actions: parsed.actions || {} };
  } catch (error) {
    log.warn('Nie udało się odczytać daily-state.json, tworzę nowy.', { error: String(error) });
    return { actions: {} };
  }
}

function saveDailyState(state) {
  fs.writeFileSync(DAILY_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function isActionDone(state, key, dayKey) {
  return state.actions[key] === dayKey;
}

function markActionDone(state, key, dayKey) {
  state.actions[key] = dayKey;
  saveDailyState(state);
}


async function navigateViaMenu(page, menuText, itemText) {
  await page.click(`a.dropdown-toggle:has-text("${menuText}")`);
  await page.click(`ul.dropdown-menu >> text=${itemText}`);
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch {
    // ignore timeout
  }
}

async function doDailyLottery(page) {
  await navigateViaMenu(page, 'Miejsca', 'Mini Loteria');
  await page.waitForTimeout(1500);

  let clicked = 0;
  const MAX_LOTTERY_CLICKS = 4;

  while (clicked < MAX_LOTTERY_CLICKS) {
    const costContainer = page.locator('div.text-center:has(b:has-text("Koszt losu"))').first();
    if (await costContainer.count() === 0) {
      log.info('Loteria: nie znaleziono kontenera "Koszt losu" - przerywam.');
      break;
    }
    const costText = await costContainer.innerText().catch(() => null);
    if (!costText) {
      log.info('Loteria: nie udało się odczytać kosztu losu - przerywam.');
      break;
    }

    const isFree = /DARMOWY/i.test(costText);
    if (!isFree) {
      log.info(`Loteria nie jest darmowa (${costText.trim()}) - zaznaczam jako wykonaną.`);
      return true;
    }

    const btn = page.locator('button:has-text("Spróbuj szczęścia")').first();
    if (await btn.count() === 0) {
      log.info('Loteria: przycisk "Spróbuj szczęścia" nie znaleziony - przerywam.');
      break;
    }

    await btn.click();
    clicked++;
    log.info(`Loteria: kliknięto darmowy los (${clicked}/${MAX_LOTTERY_CLICKS}).`);
    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch { /* ignore */ }
    await page.waitForTimeout(1000);
  }

  if (clicked === 0) log.info('Loteria: nie kliknięto żadnego losu.');
  return clicked > 0;
}

async function doDailyFarmVisit(page) {
  await navigateViaMenu(page, 'Miejsca', 'Farma Jagód');

  try {
    await page.waitForSelector('.farma-pole', { timeout: 4000 });
  } catch {
    log.warn('Farma: nie załadowano pól farmy w ciągu 10s.');
    return false;
  }

  const allPoles = await page.locator('.farma-pole').count();
  log.info(`Farma: załadowano ${allPoles} pól.`);

  let acted = false;

  // Krok 1: zbierz dojrzałe jagody (data-etap="4")
  const ripe = await page.locator('[data-etap="4"]').all();
  if (ripe.length > 0) {
    log.info(`Farma: znaleziono ${ripe.length} dojrzałych jagód.`);

    const harvestBtn = page.locator('button:has-text("Zbierz i Zasiej")').first();
    if (await harvestBtn.count() > 0) {
      await harvestBtn.click();
      log.info('Farma: kliknięto narzędzie "Zbierz i Zasiej".');
      await page.waitForTimeout(500);

      for (const pole of ripe) {
        await pole.click();
        log.info('Farma: kliknięto dojrzałą działkę.');
        await page.waitForTimeout(500);
      }
      acted = true;
    } else {
      log.info('Farma: nie znaleziono przycisku "Zbierz i Zasiej".');
    }
  } else {
    log.info('Farma: brak dojrzałych jagód.');
  }

  // Krok 2: podlej niepodlane działki (data-podlane="0")
  const unwatered = await page.locator('[data-podlane="0"]').all();
  if (unwatered.length > 0) {
    log.info(`Farma: znaleziono ${unwatered.length} niepodlanych działek.`);
    const waterBtns = await page.locator('img[aria-label="Podlej Działkę"]').all();
    let clicked = 0;
    for (const btn of waterBtns) {
      await btn.click();
      clicked++;
      await page.waitForTimeout(500);

    }
    log.info(`Farma: podlano ${clicked} działek.`);
    acted = true;
  } else {
    log.info('Farma: brak niepodlanych działek.');
  }

  return acted;
}

async function waitForCareTimer(page) {
  const POLL_INTERVAL_MS = 12 * 60 * 1000;
  const STAY_THRESHOLD_MS = 12 * 60 * 1000;

  while (true) {
    const timerEl = page.locator('text=/Pomagasz w PokeCentrum/').first();
    if (await timerEl.count() === 0) return false;

    const timerText = await timerEl.innerText().catch(() => '');
    const match = timerText.match(/(\d{2}):(\d{2}):(\d{2})/);
    if (!match) return false;

    const remainingMs = (parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3])) * 1000;
    log.info(`Opieka: timer ${match[0]} - pozostało ${remainingMs}ms.`);

    if (remainingMs <= STAY_THRESHOLD_MS) {
      log.info(`Opieka: zostało < 12 min - czekam na miejscu ${remainingMs}ms.`);
      await page.waitForTimeout(remainingMs + 5000);
      log.info('Opieka: timer zakończony.');
      return true;
    }

    log.info(`Opieka: zostało > 12 min - odświeżam za 12 min.`);
    await page.waitForTimeout(POLL_INTERVAL_MS);
    await page.reload();
    try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch { /* ignore */ }

    const careTab = page.locator('a[href="#aktywnosc-opieka"]').first();
    if (await careTab.count() > 0) {
      await careTab.click();
      await page.waitForTimeout(1000);
    }
  }
}

async function doDailyPokemonCare(page, state) {
  // Sprawdź czy jest banner "Jesteś w trakcie Opieki"
  const inProgressBanner = page.locator('text=/Jesteś w trakcie Opieki/').first();
  if (await inProgressBanner.count() > 0) {
    log.info('Opieka: wykryto aktywną opiekę - klikam "Przejdź do Aktywności".');
    const goToActivity = page.locator('a:has-text("Przejdź do Aktywności")').first();
    if (await goToActivity.count() > 0) {
      await goToActivity.click();
      try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch { /* ignore */ }
    }
    await page.waitForTimeout(1000);
    await waitForCareTimer(page);
    return null;
  }

  const paResult = await CheckPA(page);
  botState.updateStats({ pa: { current: paResult.currentPA, max: paResult.maxPA } });

  if (paResult.currentPA >= paResult.maxPA / 2) {
    log.info(`Opieka: PA ${paResult.currentPA}/${paResult.maxPA} >= 50% - pomijam opiekę do następnej iteracji.`);
    return null;
  }

  log.info(`Opieka: PA ${paResult.currentPA}/${paResult.maxPA} < 50% - przechodzę do opieki.`);
  await navigateViaMenu(page, 'Postać', 'Aktywność');
  await page.waitForTimeout(1000);

  // Sprawdź timer już na stronie aktywności (może już trwa)
  const alreadyRunning = await waitForCareTimer(page);
  if (alreadyRunning) return null;

  const careTab = page.locator('a[href="#aktywnosc-opieka"]').first();
  if (await careTab.count() === 0) {
    log.info('Opieka: nie znaleziono zakładki "Opieka".');
    return false;
  }
  await careTab.click();
  log.info('Opieka: kliknięto zakładkę "Opieka".');
  await page.waitForTimeout(1000);

  // Sprawdź timer po kliknięciu zakładki
  const timerAfterTab = await waitForCareTimer(page);
  if (timerAfterTab) return null;

  const careNowBtn = page.locator('button:has-text("Opiekuj się")').first();
  if (await careNowBtn.count() === 0) {
    log.info('Opieka: nie znaleziono przycisku "Opiekuj się".');
    return false;
  }
  await careNowBtn.click();
  const careTime = new Date().toISOString();
  log.info(`Opieka: kliknięto "Opiekuj się" o ${careTime}.`);
  state.lastCareTime = careTime;
  saveDailyState(state);

  await page.waitForTimeout(2000);
  const timerAfterClick = await waitForCareTimer(page);
  if (timerAfterClick) return null;

  return true;
}

async function getRemainingLeagueFights(page) {
  const text = await page.locator('#liga div.col-xs-9.text-center').first().innerText().catch(() => '');
  const match = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return null;
  const remaining = parseInt(match[1], 10);
  const max = parseInt(match[2], 10);
  log.info(`Liga: pozostałe bilety ${remaining}/${max}.`);
  return remaining;
}

async function doDailyLeagueFights(page) {
  await navigateViaMenu(page, 'Liga', 'Twoja Liga');
  await page.waitForTimeout(2000);

  let fought = 0;

  while (true) {
    const remaining = await getRemainingLeagueFights(page);
    if (remaining === null) {
      log.info('Liga: nie znaleziono licznika walk - przerywam.');
      break;
    }
    log.info(`Liga: pozostałe walki = ${remaining}.`);
    if (remaining <= 0) break;

    const nextFightBtn = page.locator('button:has-text("Rozpocznij następną walkę"), a:has-text("Rozpocznij następną walkę")').first();
    if (await nextFightBtn.count() === 0) {
      log.info('Liga: nie znaleziono przycisku "Rozpocznij następną walkę" - przerywam.');
      break;
    }
    await nextFightBtn.click();
    log.info('Liga: kliknięto "Rozpocznij następną walkę".');
    try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch { /* ignore */ }
    await page.waitForTimeout(2000);

    const startFightBtn = page.locator('input[type="submit"][value="Rozpocznij walkę"], button:has-text("Rozpocznij walkę")').first();
    if (await startFightBtn.count() === 0) {
      log.info('Liga: nie znaleziono przycisku "Rozpocznij walkę" - przerywam.');
      break;
    }
    await startFightBtn.click();
    log.info('Liga: kliknięto "Rozpocznij walkę".');
    await page.waitForTimeout(2000);

    const backBtn = page.locator('button:has-text("Powrót"), a:has-text("Powrót")').first();
    if (await backBtn.count() > 0) {
      await backBtn.click();
      log.info('Liga: kliknięto "Powrót".');
      await page.waitForTimeout(2000);
    }

    fought++;
  }

  log.info(`Liga: wykonano ${fought} walk.`);
  return fought > 0 || (await getRemainingLeagueFights(page)) === 0;
}

async function doDailyAssociationPA(page) {
  await navigateViaMenu(page, 'Stow.', 'Twoje Stowarzyszenie');
  await page.waitForTimeout(4000);

  const fountain = page.locator('img[aria-label="Orzeźwiająca Fontanna"]').first();
  if (await fountain.count() === 0) {
    log.info('Stowarzyszenie: nie znaleziono fontanny.');
    return false;
  }
  await fountain.click();
  log.info('Stowarzyszenie: kliknięto fontannę.');
  await page.waitForTimeout(2000);

  const drinkBtn = page.locator('button:has-text("Napij się z fontanny")').first();
  if (await drinkBtn.count() === 0) {
    log.info('Stowarzyszenie: nie znaleziono przycisku "Napij się z fontanny".');
    return false;
  }
  await drinkBtn.click();
  log.info('Stowarzyszenie: kliknięto "Napij się z fontanny".');

  // Hotel Pokemon
  await navigateViaMenu(page, 'Stow.', 'Twoje Stowarzyszenie');
  await page.waitForTimeout(4000);

  const hotel = page.locator('img[aria-label="Hotel Pokemon"]').first();
  if (await hotel.count() === 0) {
    log.info('Stowarzyszenie: nie znaleziono Hotelu Pokemon.');
    return true;
  }
  await hotel.click();
  log.info('Stowarzyszenie: kliknięto Hotel Pokemon.');
  await page.waitForTimeout(2000);

  const feedBtn = page.locator('button:has-text("Nakarm Pokemony")').first();
  if (await feedBtn.count() === 0) {
    log.info('Stowarzyszenie: nie znaleziono przycisku "Nakarm Pokemony".');
    return true;
  }
  await feedBtn.click();
  log.info('Stowarzyszenie: kliknięto "Nakarm Pokemony".');
  return true;
}

async function doDailyPABerries(page) {
  const berry = page.locator('a.skrot_przedmiot[data-rodzaj="rawst_berry"]');
  if (await berry.count() === 0) {
    log.info('Brak jagody Rawst w pasku skrótów.');
    return false;
  }
  await berry.click();
  log.info('Użyto jagody Rawst z paska skrótów.');
  return true;
}

async function readHomeStats(page) {
  const result = {};
  try {
    const labels = await page.locator('b.pull-right').all();
    for (const label of labels) {
      const text = (await label.innerText()).trim();
      const valueEl = label.locator('xpath=../following-sibling::div[1]');
      const raw = (await valueEl.innerText().catch(() => '')).trim();

      if (text.includes('Opieka Dzisiaj'))      result.careToday    = raw;
      if (text.includes('Los w Mini Loterii'))  result.lotteryToday = raw;
      if (text.includes('Napoje Energetyczne')) {
        const match = raw.match(/(\d+)\s*\/\s*(\d+)/);
        if (match) { result.drinks = parseInt(match[1], 10); result.drinksMax = parseInt(match[2], 10); }
      }
      if (text.includes('Dojrzałe Krzaki'))     result.ripe        = parseInt(raw, 10);
      if (text.includes('Podlane Krzaki')) {
        const match = raw.match(/(\d+)\s*\/\s*(\d+)/);
        if (match) { result.watered = parseInt(match[1], 10); result.total = parseInt(match[2], 10); }
      }
      if (text.includes('Jagody Rawst')) {
        const match = raw.match(/(\d+)\s*\/\s*(\d+)/);
        if (match) { result.rawstCurrent = parseInt(match[1], 10); result.rawstMax = parseInt(match[2], 10); }
      }
    }
    log.info('Statystyki strony głównej:', result);
  } catch (e) {
    log.warn('Nie udało się odczytać statystyk strony głównej.', { error: String(e) });
  }
  return result;
}

async function runDailyActions(page) {
  const dayKey = getDailyRunKey();
  const state = loadDailyState();

  // Jeśli banner "Jesteś w trakcie Opieki" widoczny - kliknij przejdź i czekaj na timer
  const inProgressBanner = page.locator('text=/Jesteś w trakcie Opieki/').first();
  if (await inProgressBanner.count() > 0) {
    log.info('runDailyActions: wykryto aktywną opiekę - klikam "Przejdź do Aktywności".');
    const goToActivity = page.locator('a:has-text("Przejdź do Aktywności")').first();
    if (await goToActivity.count() > 0) {
      await goToActivity.click();
      try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch { /* ignore */ }
    }
    await page.waitForTimeout(1000);
    await waitForCareTimer(page);
    return;
  }

  // Jeśli opieka jest aktywna (lastCareTime < 1h temu), blokuj inne akcje
  if (state.lastCareTime) {
    const elapsed = Date.now() - new Date(state.lastCareTime).getTime();
    if (elapsed < 60 * 60 * 1000) {
      const remaining = Math.ceil((60 * 60 * 1000 - elapsed) / 60000);
      log.info(`Opieka w toku - blokuję inne akcje. Pozostało ~${remaining} min.`);
      return;
    }
  }

  const homeStats = await readHomeStats(page);

  if (homeStats.lotteryToday === 'tak') {
    log.info('Loteria: już zagrana dzisiaj - zaznaczam jako done.');
    markActionDone(state, 'lottery', dayKey);
  }

  if (homeStats.careToday === 'tak') {
    log.info('Opieka: już wykonana dzisiaj - zaznaczam jako done.');
    markActionDone(state, 'pokemonCare', dayKey);
  }

  if (homeStats.ripe === 0 && homeStats.total != null && homeStats.watered === homeStats.total) {
    log.info('Farma: dojrzałe=0 i wszystkie podlane - zaznaczam jako done.');
    markActionDone(state, 'farm', dayKey);
  }

  if (homeStats.drinks != null && homeStats.drinks >= 1) {
    log.info(`Stowarzyszenie: napoje energetyczne ${homeStats.drinks}/${homeStats.drinksMax} - zaznaczam jako done.`);
    markActionDone(state, 'associationPA', dayKey);
  }

  if (homeStats.rawstCurrent != null && homeStats.rawstCurrent >= homeStats.rawstMax) {
    log.info(`Jagody Rawst: ${homeStats.rawstCurrent}/${homeStats.rawstMax} - pełne, zaznaczam jako done.`);
    markActionDone(state, 'paBerries', dayKey);
  }

  const dailyActions = [
    { key: 'lottery',      label: 'Loteria',              runner: doDailyLottery },
    { key: 'leagueFights', label: 'Walki Ligowe',         runner: doDailyLeagueFights },
    { key: 'farm',         label: 'Hodowla/Farma',        runner: doDailyFarmVisit },
    { key: 'pokemonCare', label: 'Opieka nad Pokemonem', runner: (page) => doDailyPokemonCare(page, state, dayKey) },
    {
      key: 'associationPA', label: 'PA ze Stowarzyszenia',
      runner: async (page) => {
        const paResult = await CheckPA(page);
        botState.updateStats({ pa: { current: paResult.currentPA, max: paResult.maxPA } });
        if (paResult.currentPA >= 100) {
          log.info('Stowarzyszenie: PA >= 100, pomijam fontannę - spróbuję przy następnej iteracji.');
          return null;
        }
        return doDailyAssociationPA(page);
      }
    },
    {
      key: 'paBerries', label: 'Jagody Rawst',
      runner: async (page) => {
        const paResult = await CheckPA(page);
        botState.updateStats({ pa: { current: paResult.currentPA, max: paResult.maxPA } });
        if (paResult.currentPA >= 50) {
          log.info('PA >= 50, jagody Rawst pominięte - spróbuję przy następnej iteracji.');
          return null;
        }
        return doDailyPABerries(page);
      }
    }
  ];

  for (const action of dailyActions) {
    if (isActionDone(state, action.key, dayKey)) continue;

    try {
      const done = await action.runner(page);
      if (done === null) continue;

      markActionDone(state, action.key, dayKey);

      if (done) log.info('Daily wykonana.', { action: action.key, label: action.label, dayKey });
      else log.info('Daily niedostępna - pomijam do jutra.', { action: action.key, label: action.label, dayKey });

      await page.waitForTimeout(800);
    } catch (error) {
      markActionDone(state, action.key, dayKey);
      log.warn('Błąd w daily - pomijam do jutra.', { action: action.key, label: action.label, error: String(error), stack: error?.stack });
    }
  }
}

async function runAssociationPAIfNeeded(page) {
  const state = loadDailyState();
  const dayKey = getDailyRunKey();
  if (isActionDone(state, 'associationPA', dayKey)) {
    log.info('AssociationPA: już wykonana dzisiaj - pomijam.');
    return;
  }
  const paResult = await CheckPA(page);
  if (paResult.currentPA >= 100) return;
  try {
    const done = await doDailyAssociationPA(page);
    if (done) markActionDone(state, 'associationPA', dayKey);
  } catch (e) {
    log.warn('AssociationPA w pętli: błąd', { error: String(e) });
  }
}

async function runPABerriesIfNeeded(page) {
  const state = loadDailyState();
  const dayKey = getDailyRunKey();
  if (isActionDone(state, 'paBerries', dayKey)) {
    log.info('PABerries: już wykonane dzisiaj - pomijam.');
    return;
  }
  const paResult = await CheckPA(page);
  if (paResult.currentPA >= 50) return;
  try {
    const done = await doDailyPABerries(page);
    if (done) markActionDone(state, 'paBerries', dayKey);
  } catch (e) {
    log.warn('PABerries w pętli: błąd', { error: String(e) });
  }
}

module.exports = {
  runDailyActions,
  runAssociationPAIfNeeded,
  runPABerriesIfNeeded,
};
