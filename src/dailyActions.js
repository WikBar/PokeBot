const fs = require('fs');
const path = require('path');
const { logger } = require('./utils/logger');

const log = logger.child({ module: 'dailyActions' });

const DAILY_RESET_HOUR = 0;
const DAILY_RESET_MINUTE = 30;
const DAILY_STATE_PATH = path.resolve(__dirname, '..', 'config', 'daily-state.json');
const HOME_URL = 'https://gra.pokelife.pl/index.php';

const URLS = {
  lottery:     'https://gra.pokelife.pl/gra/jaskinia_hazardu.php',
  farm:        'https://gra.pokelife.pl/gra/hodowla.php',
  care:        'https://gra.pokelife.pl/gra/opieka.php',
  association: 'https://gra.pokelife.pl/gra/stowarzyszenie.php'
};

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
    if (!fs.existsSync(DAILY_STATE_PATH)) {
      return { dayKey: null, actions: {} };
    }
    const raw = fs.readFileSync(DAILY_STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      dayKey: parsed.dayKey || null,
      actions: parsed.actions || {}
    };
  } catch (error) {
    log.warn('Nie udało się odczytać daily-state.json, tworzę nowy.', { error: String(error) });
    return { dayKey: null, actions: {} };
  }
}

function saveDailyState(state) {
  fs.writeFileSync(DAILY_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function ensureDailyState(state, dayKey) {
  if (state.dayKey !== dayKey) {
    state.dayKey = dayKey;
    state.actions = {};
    saveDailyState(state);
    log.info('Nowy dzień - reset dziennych akcji.', { dayKey });
  }
}

async function clickFirstExisting(page, selectors) {
  for (const selector of selectors) {
    const candidate = page.locator(selector).first();
    if (await candidate.count()) {
      await candidate.click();
      return true;
    }
  }
  return false;
}

async function navigateTo(page, url) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
}

async function doDailyLottery(page) {
  await navigateTo(page, URLS.lottery);
  const played = await clickFirstExisting(page, [
    'button:has-text("Weź udział")',
    'button:has-text("Losuj")',
    'button:has-text("Zagraj")'
  ]);
  return played;
}

async function doDailyFarmVisit(page) {
  await navigateTo(page, URLS.farm);
  const acted = await clickFirstExisting(page, [
    'button:has-text("Zbierz")',
    'button:has-text("Nakarm")',
    'button:has-text("Odwiedź")',
    'button:has-text("Hoduj")'
  ]);
  return acted;
}

async function doDailyPokemonCare(page) {
  await navigateTo(page, URLS.care);
  const cared = await clickFirstExisting(page, [
    'button:has-text("Zaopiekuj")',
    'button:has-text("Nakarm")',
    'button:has-text("Ulecz")'
  ]);
  return cared;
}

async function doDailyAssociationPA(page) {
  await navigateTo(page, URLS.association);
  const collected = await clickFirstExisting(page, [
    'button:has-text("Odbierz PA")',
    'button:has-text("Odbierz")',
    'a:has-text("Odbierz PA")'
  ]);
  return collected;
}

async function doDailyPABerries(page) {
  await navigateTo(page, URLS.farm);
  const collected = await clickFirstExisting(page, [
    'button:has-text("Zbierz jagody")',
    'button:has-text("Zbierz Jagody")',
    'button:has-text("Pobierz jagody")'
  ]);
  return collected;
}

async function runDailyActions(page) {
  const dayKey = getDailyRunKey();
  const state = loadDailyState();
  ensureDailyState(state, dayKey);

  const dailyActions = [
    { key: 'lottery',       label: 'Loteria',               runner: doDailyLottery },
    { key: 'farm',          label: 'Hodowla/Farma',         runner: doDailyFarmVisit },
    { key: 'pokemonCare',   label: 'Opieka nad Pokemonem',  runner: doDailyPokemonCare },
    { key: 'associationPA', label: 'PA ze Stowarzyszenia',  runner: doDailyAssociationPA },
    { key: 'paBerries',     label: 'Jagody PA',             runner: doDailyPABerries }
  ];

  for (const action of dailyActions) {
    if (state.actions[action.key]) continue;

    try {
      const done = await action.runner(page);
      state.actions[action.key] = true;
      saveDailyState(state);

      if (done) log.info('Daily wykonana.', { action: action.key, label: action.label, dayKey });
      else log.info('Daily niedostępna - pomijam do jutra.', { action: action.key, label: action.label, dayKey });

      await page.waitForTimeout(800);
      await navigateTo(page, HOME_URL);
    } catch (error) {
      state.actions[action.key] = true;
      saveDailyState(state);
      log.warn('Błąd w daily - pomijam do jutra.', { action: action.key, label: action.label, error: String(error) });
      try { await navigateTo(page, HOME_URL); } catch { /* ignore */ }
    }
  }
}

module.exports = {
  runDailyActions
};
