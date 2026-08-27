const fs = require('fs');
const path = require('path');
const { logger } = require('./utils/logger');
const botState = require('./state');
const { CheckPA } = require('./actions/stats');

const log = logger.child({ module: 'dailyActions' });

const DAILY_RESET_HOUR = 0;
const DAILY_RESET_MINUTE = 40;
const DAILY_STATE_PATH = path.resolve(__dirname, '..', 'config', 'daily-state.json');

// Liga: w poniedziałek walki dopiero od tej godziny.
const LEAGUE_MONDAY_MIN_HOUR = 13;
// Zabezpieczenie przed pętlą, gdyby licznik biletów nie malał.
const MAX_LEAGUE_FIGHTS = 60;


// Klucz tygodnia ligi. Tydzień zaczyna się w poniedziałek o LEAGUE_MONDAY_MIN_HOUR
// (wtedy resetuje się licznik biletów), więc poniedziałek przed tą godziną
// należy jeszcze do tygodnia poprzedniego.
function getLeagueWeekKey(now = new Date()) {
  const d = new Date(now);
  if (d.getDay() === 1 && d.getHours() < LEAGUE_MONDAY_MIN_HOUR) {
    d.setDate(d.getDate() - 1);          // cofamy do poprzedniego tygodnia
  }
  // Cofamy do poniedziałku bieżącego tygodnia (niedziela = 0 → 6 dni wstecz).
  const dayOfWeek = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayOfWeek);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `W${y}-${m}-${day}`;            // np. W2026-08-17 (poniedziałek)
}

// Weekend = sobota lub niedziela — wtedy tylko weryfikujemy, czy x=0.
function isWeekend(now = new Date()) {
  const day = now.getDay();
  return day === 6 || day === 0;
}

function getDailyRunKey(now = new Date()) {
  const shiftedDate = new Date(now);
  if (
    shiftedDate.getHours() < DAILY_RESET_HOUR ||
    (shiftedDate.getHours() === DAILY_RESET_HOUR && shiftedDate.getMinutes() < DAILY_RESET_MINUTE)
  ) {
    shiftedDate.setDate(shiftedDate.getDate() - 1);
  }
  const y = shiftedDate.getFullYear();
  const m = String(shiftedDate.getMonth() + 1).padStart(2, '0');
  const d = String(shiftedDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function loadDailyState() {
  try {
    if (!fs.existsSync(DAILY_STATE_PATH)) return { actions: {} };
    const raw = fs.readFileSync(DAILY_STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    // Zachowujemy CALY obiekt - wczesniej zwracalismy samo { actions },
    // przez co kazdy zapis kasowal lastCareTime (blokada opieki nigdy
    // nie dzialala miedzy iteracjami).
    return { ...parsed, actions: parsed.actions || {} };
  } catch (error) {
    log.warn('Nie udało się odczytać daily-state.json, tworzę nowy.', { error: String(error) });
    return { actions: {} };
  }
}

function saveDailyState(state) {
  fs.writeFileSync(DAILY_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

// Ile razy probowac akcji, ktorej nie udalo sie potwierdzic w statystykach,
// zanim odpuscimy ja do jutra. Bez limitu trwale zepsuty selektor bylby
// probowany co iteracje petli.
const MAX_DAILY_ATTEMPTS = 3;

// Licznik prob per akcja i dzien: { "farm": { day: "2026-08-27", n: 2 } }.
// Trzymany w daily-state.json, wiec przezywa restart bota.
function bumpAttempt(state, key, dayKey) {
  if (!state.attempts) state.attempts = {};
  const cur = state.attempts[key];
  const n = (cur && cur.day === dayKey ? cur.n : 0) + 1;
  state.attempts[key] = { day: dayKey, n };
  saveDailyState(state);
  return n;
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
  // Domknij dropdown, jeśli został otwarty w DOM po nawigacji (potrafi przysłaniać przyciski pod spodem)
  const openDropdown = page.locator('ul.dropdown-menu:visible').first();
  if (await openDropdown.count() > 0) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.click('body', { position: { x: 0, y: 0 } }).catch(() => {});
  }
}

async function doDailyLottery(page) {
  await navigateViaMenu(page, 'Miejsca', 'Mini Loteria');
  try {
    await page.waitForLoadState('networkidle', { timeout: 8000 });
  } catch { /* ignore */ }
  await page.waitForTimeout(1500);

  let clicked = 0;

  while (true) {
    // Sprawdź koszt losu - jeśli nie DARMOWY i liczba > 7, zatrzymaj
    const costParent = await page.locator('b:has-text("Koszt losu")').first().locator('xpath=..').innerText().catch(() => '');
    log.info(`Loteria: koszt losu = "${costParent.trim()}"`);

    const isFree = /DARMOW/i.test(costParent);
    const costMatch = costParent.match(/:\s*(\d+)/);
    const costValue = costMatch ? parseInt(costMatch[1], 10) : null;

    if (!isFree && costValue !== null && costValue > 7) {
      log.info(`Loteria: koszt ${costValue} > 7 - zatrzymuję klikanie.`);
      break;
    }

    // Domknij dropdown, jeśli przysłania przycisk (np. otwarty przez hover)
    const openDropdown = page.locator('ul.dropdown-menu:visible').first();
    if (await openDropdown.count() > 0) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.click('body', { position: { x: 0, y: 0 } }).catch(() => {});
    }

    const btn = page.locator([
      'button:has-text("Spróbuj szczęścia"):not(ul.dropdown-menu *)',
      'input[type="submit"][value*="Spróbuj"]:not(ul.dropdown-menu *)',
      'input[type="submit"][value*="szcz"]:not(ul.dropdown-menu *)',
      'a:has-text("Spróbuj szczęścia"):not(ul.dropdown-menu *)',
    ].join(', ')).first();

    if (await btn.count() === 0 || !(await btn.isVisible())) {
      log.info('Loteria: przycisk "Spróbuj szczęścia" nie znaleziony - przerywam.');
      break;
    }

    await btn.click();
    clicked++;
    log.info(`Loteria: kliknięto los (${clicked}), koszt był: ${isFree ? 'DARMOWY' : costValue + ' §'}.`);
    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch { /* ignore */ }
    await page.waitForTimeout(1500);
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
  const ripeCount = await page.locator('[data-etap="4"]').count();
  if (ripeCount > 0) {
    log.info(`Farma: znaleziono ${ripeCount} dojrzałych jagód.`);

    const harvestBtn = page.locator('button:has-text("Zbierz i Zasiej")').first();
    if (await harvestBtn.count() > 0) {
      await harvestBtn.click({ force: true });
      log.info('Farma: kliknięto narzędzie "Zbierz i Zasiej".');
      await page.waitForTimeout(500);

      // Zbierz ID wszystkich dojrzałych pól RAZ na starcie i kliknij każde po kolei po id.
      // DOM danego pola (data-etap) nie odświeża się natychmiast po syntetycznym kliknięciu,
      // więc re-query ".first()" wciąż łapałby to samo, już kliknięte pole.
      const ripeIds = await page.locator('[data-etap="4"]').evaluateAll(
        els => els.map(el => el.id).filter(Boolean)
      );
      let harvested = 0;
      for (const poleId of ripeIds) {
        const pole = page.locator(`#${poleId}`);
        if (await pole.count() === 0) continue;
        await pole.click({ force: true });
        harvested++;
        log.info(`Farma: kliknięto dojrzałą działkę. id=${poleId}`);
        await page.waitForTimeout(600);
      }
      log.info(`Farma: zebrano ${harvested}/${ripeCount} działek.`);
      acted = true;
    } else {
      log.info('Farma: nie znaleziono przycisku "Zbierz i Zasiej".');
    }
  } else {
    log.info('Farma: brak dojrzałych jagód.');
  }

  // Krok 2: podlej niepodlane działki (data-podlane="0")
  const unwateredCount = await page.locator('[data-podlane="0"]').count();
  if (unwateredCount > 0) {
    log.info(`Farma: znaleziono ${unwateredCount} niepodlanych działek.`);

    // Każda "Działka" (sekcja pól, w osobnej zakładce ze scrollem) ma własną konewkę
    // (img.farma-konewka, onclick="FarmaDzialkaPodlej(this)") - jedno kliknięcie podlewa
    // całą działkę naraz. Konewki dla dalszych działek bywają poza widocznym obszarem
    // panelu (Element is not visible mimo force:true), więc wywołujemy onclick
    // bezpośrednio w DOM zamiast symulować klik myszy.
    const dzialkaIds = await page.locator('img.farma-konewka').evaluateAll(
      els => els.map(el => el.getAttribute('data-dzialka-id')).filter(id => id !== null)
    );
    log.info(`Farma: znaleziono ${dzialkaIds.length} konewek (działek): ${JSON.stringify(dzialkaIds)}`);

    let watered = 0;
    for (const dzialkaId of dzialkaIds) {
      const clicked = await page.evaluate((id) => {
        const el = document.querySelector(`img.farma-konewka[data-dzialka-id="${id}"]`);
        if (!el) return false;
        el.click();
        return true;
      }, dzialkaId);
      if (!clicked) {
        log.warn(`Farma: konewka dla działki ${dzialkaId} nie znaleziona w DOM - pomijam.`);
        continue;
      }
      watered++;
      log.info(`Farma: podlano działkę nr ${dzialkaId}.`);
      await page.waitForTimeout(1000);
    }
    log.info(`Farma: podlano ${watered} działek (konewką).`);
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
  await waitForCareTimer(page);

  // Po opiece odświeżamy stan plecaka (po timerze, żeby nie opuszczać
  // strony aktywności w trakcie oczekiwania). Ustawienia auto-Tepela
  // przekazujemy, by alarmowac tylko o faktycznie uzywanym przedmiocie.
  const { OpenBackpackAndUpdate } = require('./actions/equipment');
  await OpenBackpackAndUpdate(page, navigateViaMenu, readRepelOptions());

  return true;
}

// Ustawienia auto-Tepela/Repela z config.json. Czytamy z dysku, bo panel
// web moze je zmienic w trakcie dzialania bota.
function readRepelOptions() {
  try {
    const cfgPath = path.resolve(__dirname, '..', 'config', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    return { autoRepelKind: cfg.autoRepelKind, autoRepelTier: cfg.autoRepelTier };
  } catch {
    return {};
  }
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

// W poniedziałek przed 13:00 liga jest pomijana (reset tygodnia).
function isLeagueBlockedNow(now = new Date()) {
  return now.getDay() === 1 && now.getHours() < LEAGUE_MONDAY_MIN_HOUR;
}

async function doDailyLeagueFights(page) {
  if (isLeagueBlockedNow()) {
    log.info(`Liga: poniedziałek przed ${LEAGUE_MONDAY_MIN_HOUR}:00 - trwa reset, pomijam.`);
    return null;   // null = nie oznaczaj jako wykonane, wróć do tego później
  }

  // Liga jest zadaniem TYGODNIOWYM. Jeśli w tym tygodniu licznik osiągnął
  // już 0, nie ma po co wchodzić na ekran ligi — poza weekendem, kiedy
  // robimy kontrolne sprawdzenie, czy faktycznie nic nie zostało.
  const state = loadDailyState();
  const weekKey = getLeagueWeekKey();
  const alreadyDone = state.actions.leagueFights === weekKey;

  if (alreadyDone && !isWeekend()) {
    log.info(`Liga: tydzień ${weekKey} już zaliczony - pomijam.`);
    return true;
  }
  if (alreadyDone) {
    log.info(`Liga: tydzień ${weekKey} zaliczony - weekendowa kontrola licznika.`);
  }

  await navigateViaMenu(page, 'Liga', 'Twoja Liga');
  await page.waitForTimeout(2000);

  const tickets = await getRemainingLeagueFights(page);
  if (tickets === null) {
    log.info('Liga: nie znaleziono licznika walk - pomijam.');
    return null;
  }
  if (tickets <= 0) {
    log.info('Liga: brak biletów na walki - nic do zrobienia.');
    return true;
  }

  log.info(`Liga: do stoczenia ${tickets} walk.`);
  let fought = 0;

  // "Rozpocznij następną walkę" jest dostępne także po walce, więc nie
  // wracamy na ekran ligi między walkami. Limit iteracji na wypadek,
  // gdyby przyciski nie znikały mimo wyczerpania biletów.
  for (let i = 0; i < Math.min(tickets, MAX_LEAGUE_FIGHTS); i++) {
    const nextFightBtn = page.locator('button:has-text("Rozpocznij następną walkę"), a:has-text("Rozpocznij następną walkę")').first();
    if (await nextFightBtn.count() === 0) {
      log.info('Liga: brak przycisku "Rozpocznij następną walkę" - kończę walki.');
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
    fought++;
    log.info(`Liga: kliknięto "Rozpocznij walkę" (${fought}/${tickets}).`);
    try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch { /* ignore */ }
    await page.waitForTimeout(2000);
  }

  // "Powrót" (dostępny po walce) wraca na ekran ligi — tam sprawdzamy licznik.
  const backBtn = page.locator('button:has-text("Powrót"), a:has-text("Powrót")').first();
  if (await backBtn.count() > 0) {
    await backBtn.click();
    log.info('Liga: kliknięto "Powrót" - sprawdzam licznik.');
  } else {
    log.warn('Liga: brak przycisku "Powrót" - wracam przez menu.');
    await navigateViaMenu(page, 'Liga', 'Twoja Liga');
  }
  try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch { /* ignore */ }
  await page.waitForTimeout(2000);

  const left = await getRemainingLeagueFights(page);
  log.info(`Liga: wykonano ${fought} walk, pozostało ${left ?? '?'}.`);

  // Zerowy licznik zamyka cały TYDZIEŃ, nie tylko dzisiejszy dzień.
  if (left === 0) {
    markActionDone(loadDailyState(), 'leagueFights', weekKey);
    log.info(`Liga: tydzień ${weekKey} zaliczony.`);
    return true;
  }
  return null;
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

// Weryfikacja po fakcie: czy akcja jest NAPRAWDE zrobiona wg strony
// statystyk. Zwraca true/false, albo null gdy statystyki nie odpowiadaja
// na pytanie o dana akcje (wtedy ufamy wynikowi runnera).
// To jedyne zrodlo prawdy - runner moze zwrocic false przez timeout albo
// zmieniony selektor, a zadanie i tak zostalo wykonane (lub odwrotnie).
function verifyActionDone(key, stats) {
  if (!stats) return null;
  switch (key) {
    case 'lottery':
      return stats.lotteryToday === 'tak' ? true
           : stats.lotteryToday === 'nie' ? false : null;
    case 'pokemonCare':
      return stats.careToday === 'tak' ? true
           : stats.careToday === 'nie' ? false : null;
    case 'farm':
      // Zrobione = nic nie dojrzalo i wszystko podlane.
      if (stats.ripe == null || stats.total == null || stats.watered == null) return null;
      return stats.ripe === 0 && stats.watered === stats.total;
    case 'associationPA':
      // Napoj z fontanny laduje w liczniku napojow.
      return stats.drinks == null ? null : stats.drinks >= 1;
    case 'paBerries':
      // Zjedzenie jagod zbija licznik ponizej maksimum.
      if (stats.rawstCurrent == null || stats.rawstMax == null) return null;
      return stats.rawstCurrent < stats.rawstMax;
    default:
      return null;   // liga ma wlasna weryfikacje licznikiem walk
  }
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
  } else if (homeStats.careToday === 'nie') {
    log.info('Opieka: strona mówi "nie" - resetuję flagę done.');
    delete state.actions['pokemonCare'];
    delete state.lastCareTime;
    saveDailyState(state);
  }

  if (homeStats.ripe === 0 && homeStats.total != null && homeStats.watered === homeStats.total) {
    log.info('Farma: dojrzałe=0 i wszystkie podlane - zaznaczam jako done.');
    markActionDone(state, 'farm', dayKey);
  }

  const dailyActions = [
    { key: 'lottery',      label: 'Loteria',              runner: doDailyLottery },
    { key: 'leagueFights', label: 'Walki Ligowe',         runner: doDailyLeagueFights },
    { key: 'farm',         label: 'Hodowla/Farma',        runner: doDailyFarmVisit },
    { key: 'pokemonCare', label: 'Opieka nad Pokemonem', runner: async (page) => {
        const result = await doDailyPokemonCare(page, state);
        if (result === null && state.lastCareTime) return true;
        return result;
      }
    },
    {
      key: 'associationPA', label: 'PA ze Stowarzyszenia',
      runner: async (page) => {
        // Napoje to stan plecaka, nie licznik dzienny - przechodzi przez północ,
        // więc pomijamy bez zapisu klucza, żeby reset dzienny nie był zjadany.
        if (homeStats.drinks != null && homeStats.drinks >= 1) {
          log.info(`Stowarzyszenie: napoje energetyczne ${homeStats.drinks}/${homeStats.drinksMax} - pomijam, spróbuję przy następnej iteracji.`);
          return null;
        }
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
        // Jak wyżej: pełne jagody to stan zasobu, nie wykonana daily.
        if (homeStats.rawstCurrent != null && homeStats.rawstCurrent >= homeStats.rawstMax) {
          log.info(`Jagody Rawst: ${homeStats.rawstCurrent}/${homeStats.rawstMax} - pełne, pomijam, spróbuję przy następnej iteracji.`);
          return null;
        }
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
    // Liga rozlicza się tygodniowo — ma własny klucz i sama go zapisuje.
    const actionKey = action.key === 'leagueFights' ? getLeagueWeekKey() : dayKey;
    if (isActionDone(state, action.key, actionKey)) continue;

    let done;
    try {
      done = await action.runner(page);
      if (done === null) continue;   // celowe pominiecie (np. warunek PA)
    } catch (error) {
      done = false;
      log.warn('Błąd w daily.', { action: action.key, label: action.label, error: String(error), stack: error?.stack });
    }

    // Zamiast wierzyc runnerowi, pytamy strone statystyk. Runner potrafi
    // zwrocic false przez timeout albo zmieniony selektor, choc zadanie
    // zostalo wykonane - i odwrotnie.
    const confirmed = await confirmActionDone(page, action.key, done);

    if (confirmed === true) {
      markActionDone(state, action.key, actionKey);
      log.info('Daily wykonana (potwierdzona w statystykach).', { action: action.key, label: action.label, dayKey: actionKey });
      await page.waitForTimeout(800);
      continue;
    }

    // Niepotwierdzona: nie zapisujemy, ale liczymy probe, zeby trwale
    // zepsuta akcja nie byla powtarzana w nieskonczonosc.
    const attempts = bumpAttempt(state, action.key, dayKey);
    if (attempts >= MAX_DAILY_ATTEMPTS) {
      markActionDone(state, action.key, actionKey);
      log.warn(`Daily nieudana ${attempts}x - odpuszczam do jutra.`, { action: action.key, label: action.label });
    } else {
      log.info(`Daily niepotwierdzona (próba ${attempts}/${MAX_DAILY_ATTEMPTS}) - spróbuję ponownie.`, { action: action.key, label: action.label });
    }
    await page.waitForTimeout(800);
  }
}

// Sprawdza w statystykach, czy akcja faktycznie sie wykonala.
// Gdy statystyki nie odpowiadaja na to pytanie, przyjmujemy wynik runnera.
async function confirmActionDone(page, key, runnerResult) {
  // Liga sama weryfikuje sie licznikiem walk - nie ma jej w statystykach.
  if (key === 'leagueFights') return runnerResult === true;

  try {
    const fresh = await readHomeStats(page);
    const verified = verifyActionDone(key, fresh);
    if (verified !== null) {
      if (verified !== (runnerResult === true)) {
        log.info(`Statystyki korygują wynik: ${key} runner=${runnerResult} → ${verified}.`);
      }
      return verified;
    }
  } catch (e) {
    log.debug('Nie udało się zweryfikować daily w statystykach.', { action: key, error: String(e) });
  }
  return runnerResult === true;
}

async function runCareIfNeeded(page) {
  const state = loadDailyState();
  const dayKey = getDailyRunKey();

  const homeStats = await readHomeStats(page);
  if (homeStats.careToday === 'tak') {
    markActionDone(state, 'pokemonCare', dayKey);
    return;
  }
  if (homeStats.careToday === 'nie') {
    delete state.actions['pokemonCare'];
    delete state.lastCareTime;
    saveDailyState(state);
  }

  if (isActionDone(state, 'pokemonCare', dayKey)) {
    return;
  }
  const paResult = await CheckPA(page);
  if (paResult.currentPA >= paResult.maxPA / 2) {
    log.info(`runCareIfNeeded: PA ${paResult.currentPA}/${paResult.maxPA} >= 50% - opieka jeszcze nie możliwa.`);
    return;
  }
  log.info(`runCareIfNeeded: PA ${paResult.currentPA}/${paResult.maxPA} < 50% - próbuję wykonać opiekę.`);
  try {
    const done = await doDailyPokemonCare(page, state);
    if (done === true || done === null) markActionDone(state, 'pokemonCare', dayKey);
  } catch (e) {
    log.warn('runCareIfNeeded: błąd', { error: String(e) });
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
    // Zapisujemy tylko to, co potwierdzaja statystyki (licznik napojow).
    if (await confirmActionDone(page, 'associationPA', done)) {
      markActionDone(state, 'associationPA', dayKey);
    }
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
    // Zapisujemy tylko to, co potwierdzaja statystyki (licznik jagod).
    if (await confirmActionDone(page, 'paBerries', done)) {
      markActionDone(state, 'paBerries', dayKey);
    }
  } catch (e) {
    log.warn('PABerries w pętli: błąd', { error: String(e) });
  }
}

function areAllDailysDone() {
  const state = loadDailyState();
  const dayKey = getDailyRunKey();
  const keys = ['lottery', 'leagueFights', 'farm', 'pokemonCare', 'associationPA', 'paBerries'];
  return keys.every(k => {
    // Liga jest tygodniowa — sprawdzamy klucz tygodnia, a podczas
    // poniedziałkowego resetu nie blokuje pozostałych dailys.
    if (k === 'leagueFights') {
      return isLeagueBlockedNow() || isActionDone(state, k, getLeagueWeekKey());
    }
    return isActionDone(state, k, dayKey);
  });
}

module.exports = {
  runDailyActions,
  getDailyRunKey,
  runCareIfNeeded,
  runAssociationPAIfNeeded,
  runPABerriesIfNeeded,
  areAllDailysDone,
  doDailyLeagueFights,
  isLeagueBlockedNow,
  navigateViaMenu,
};
