const path = require('path');
const { logger } = require('../utils/logger');
const { loadFromFile, saveToFile } = require('../utils/fileOperations');
const { sendNotification } = require('../utils/notifier');
const state = require('../state');

const log = logger.child({ module: 'equipment' });

const EQUIPMENT_PATH = path.resolve(__dirname, '..', '..', 'config', 'equipment.json');

// Domyślny próg, gdy przedmiot nie ma własnego w equipment.json.
const DEFAULT_THRESHOLD = 10;

// --- Strona plecaka -----------------------------------------------------
// Podpis kafelki ma format "50 x MAX Repel"; przedmioty unikatowe
// (np. "Blyszczacy Medalion Zal") nie maja liczby - to 1 sztuka.
const BACKPACK = {
  // Kafelka przedmiotu WEWNATRZ panelu plecaka. Bez tego ograniczenia
  // selektor lapie tez panel czatu i inne kolumny strony.
  item: '.col-xs-3, .col-sm-3, .thumbnail',
  // Panel zakladki; wszystkie sa w DOM naraz, zakladki tylko przelaczaja widok.
  pane: '.tab-pane[id^="plecaktab-"]',
};

// Panel #plecaktab-<id> -> nazwa grupy w equipment.json.
const TAB_NAMES = {
  trener: 'Używalne',
  dla_pokemona: 'Dla Pokemona',
  pokeballe: 'Pokeballe',
  ewolucyjne: 'Ewolucyjne',
  tm: 'TM',
  trzymane: 'Trzymane',
  pokeboxy: 'Pokeboxy',
  ulepszenia: 'Ulepszenia',
};

// Rozbija podpis kafelki na nazwe i ilosc. Sa dwa formaty:
//   "50 x MAX Repel"     -> { name: 'MAX Repel', value: 50 }   (wiekszosc zakladek)
//   "x3 X Szybkość II"   -> { name: 'X Szybkość II', value: 3 } (zakladka Trzymane)
//   "Blyszczacy Medalion Zal" -> { name: '...', value: 1 }      (bez liczby)
// Uwaga: "X Atak III" zaczyna sie od litery X, ale to nie mnoznik -
// dlatego po "x" wymagamy cyfry.
function parseItemLabel(text) {
  const label = String(text || '').replace(/\s+/g, ' ').trim();
  if (!label) return null;

  // Format "<ilosc> x <nazwa>"
  const suffix = label.match(/^([\d\s.,]+)\s*x\s+(.+)$/i);
  if (suffix) {
    const value = parseInt(suffix[1].replace(/[^\d]/g, ''), 10);
    const name = suffix[2].trim();
    if (name && !Number.isNaN(value)) return { name, value };
  }

  // Format "x<ilosc> <nazwa>" - uzywany w zakladce "Trzymane"
  const prefix = label.match(/^x\s*(\d[\d\s.,]*)\s+(.+)$/i);
  if (prefix) {
    const value = parseInt(prefix[1].replace(/[^\d]/g, ''), 10);
    const name = prefix[2].trim();
    if (name && !Number.isNaN(value)) return { name, value };
  }

  // Brak liczby = przedmiot unikatowy, mamy go 1 sztuke.
  return { name: label, value: 1 };
}

// Nazwy Tepeli/Repeli w plecaku, wg klucza `${kind}-${tier}` — tego samego,
// którym health.js opisuje aktywny przedmiot (z nazwy obrazka).
const REPEL_ITEM_NAMES = {
  'repel-1': 'Repel',
  'repel-2': 'Super Repel',
  'repel-3': 'MAX Repel',
  'tepel-1': 'Tepel',
  'tepel-2': 'Super Tepel',
  'tepel-3': 'MAX Tepel',
};

// Nazwy z plecaka bywają zapisane różnie (wielkość liter, odstępy),
// więc porównujemy je po znormalizowanej formie.
function normalizeItemName(name) {
  return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Przedmioty sa pogrupowane po zakladkach: { "Pokeballe": { "Pokeballe": 1717 } }.
// Do progow i wyszukiwania potrzebujemy plaskiej mapy { nazwa: ilosc }.
function flattenItems(items) {
  const flat = {};
  for (const [key, value] of Object.entries(items || {})) {
    if (value && typeof value === 'object') Object.assign(flat, value);
    else flat[key] = value;          // zgodnosc ze starym, plaskim formatem
  }
  return flat;
}

// Czy nazwa to ktorykolwiek Tepel/Repel?
function isRepelItem(name) {
  const n = normalizeItemName(name);
  return Object.values(REPEL_ITEM_NAMES).some(label => normalizeItemName(label) === n);
}

// Nazwa aktualnie uzywanego Tepela/Repela wg ustawien auto-aktywacji,
// np. { autoRepelKind: 'repel', autoRepelTier: 3 } -> "MAX Repel".
function activeRepelName(options = {}) {
  const kind = options.autoRepelKind === 'tepel' ? 'tepel' : 'repel';
  const tier = Number(options.autoRepelTier) || 1;
  return REPEL_ITEM_NAMES[`${kind}-${tier}`] || null;
}

// Stan Tepeli/Repeli na podstawie zawartości plecaka:
// { 'repel-1': 12, 'tepel-3': 0, ... }. Brak wpisu = 0 sztuk.
function repelStock(items) {
  const byNormalized = {};
  for (const [name, value] of Object.entries(flattenItems(items))) {
    byNormalized[normalizeItemName(name)] = value;
  }
  const stock = {};
  for (const [key, label] of Object.entries(REPEL_ITEM_NAMES)) {
    const value = byNormalized[normalizeItemName(label)];
    stock[key] = Number.isFinite(Number(value)) ? Number(value) : 0;
  }
  return stock;
}

async function loadEquipment() {
  const data = await loadFromFile(EQUIPMENT_PATH);
  return {
    items: data?.items || {},
    thresholds: data?.thresholds || { default: DEFAULT_THRESHOLD },
    lastUpdated: data?.lastUpdated || null,
  };
}

// Próg dla przedmiotu: własny, a gdy brak — wartość domyślna.
function thresholdFor(thresholds, name) {
  const own = thresholds?.[name];
  if (Number.isFinite(Number(own))) return Number(own);
  const fallback = Number(thresholds?.default);
  return Number.isFinite(fallback) ? fallback : DEFAULT_THRESHOLD;
}

// Czyta kafelki z podanego kontenera -> { nazwa: liczba }.
async function readVisibleItems(scope) {
  const items = {};
  const tiles = scope.locator(BACKPACK.item);
  const count = await tiles.count().catch(() => 0);

  for (let i = 0; i < count; i++) {
    const raw = await tiles.nth(i).innerText().catch(() => '');
    const parsed = parseItemLabel(raw);
    if (parsed) items[parsed.name] = parsed.value;
  }
  return items;
}

// Czyta plecak z podzialem na zakladki:
//   { "Używalne": { "MAX Repel": 50 }, "Pokeballe": { ... } }
// Wszystkie panele sa w DOM naraz, wiec nie trzeba klikac w zakladki.
// Zwraca null, gdy nic nie znaleziono.
async function readBackpackItems(page) {
  const groups = {};
  const panes = page.locator(BACKPACK.pane);
  const count = await panes.count().catch(() => 0);

  for (let i = 0; i < count; i++) {
    const pane = panes.nth(i);
    const id = (await pane.getAttribute('id').catch(() => '')) || '';
    const key = id.replace(/^plecaktab-/, '');
    const name = TAB_NAMES[key] || key || `Zakładka ${i + 1}`;

    const found = await readVisibleItems(pane);
    if (Object.keys(found).length > 0) groups[name] = found;
  }

  if (Object.keys(groups).length === 0) {
    // Brak paneli #plecaktab-* = nie jestesmy na stronie plecaka.
    // Nie czytamy wtedy nic "na wszelki wypadek", bo selektor kafelek
    // zlapalby panel czatu i nadpisal plik smieciem.
    log.debug('Plecak: brak paneli plecaka - pomijam odczyt.');
    return null;
  }
  return groups;
}

// Odczytuje plecak, zapisuje stan do equipment.json i wysyła powiadomienie
// o przedmiotach poniżej progu. Zwraca { items, low } albo null.
// options: { autoRepelKind, autoRepelTier } - decyduje, o ktorym
// Tepelu/Repelu w ogole alarmowac (o pozostalych nie zawiadamiamy).
async function UpdateEquipment(page, options = {}) {
  const items = await readBackpackItems(page);
  if (!items) {
    log.info('Plecak: nie udało się odczytać zawartości - pomijam.');
    return null;
  }
  return saveEquipment(items, options);
}

// Zapisuje odczytana zawartosc plecaka, aktualizuje panel i wysyla
// powiadomienia o brakach. Wydzielone, by dalo sie uzyc juz odczytanych
// danych, bez ponownego czytania strony.
async function saveEquipment(items, options = {}) {
  const { items: previous, thresholds } = await loadEquipment();

  const lastUpdated = new Date().toISOString();
  // Kolejnosc kluczy ma znaczenie tylko dla czytelnosci pliku:
  // progi na gorze, bo to je sie recznie edytuje.
  await saveToFile(EQUIPMENT_PATH, { thresholds, items, lastUpdated });
  // items jest pogrupowane po zakladkach - progi liczymy na plaskiej mapie.
  const flat = flattenItems(items);
  const flatPrevious = flattenItems(previous);
  log.info(`Plecak: zapisano ${Object.keys(flat).length} przedmiotów w ${Object.keys(items).length} zakładkach.`);

  // Panel web potrzebuje stanu plecaka, żeby wiedzieć, których
  // Tepeli/Repeli w ogóle nie ma i zablokować ich aktywację.
  // Wysyłamy płaską mapę — grupy są tylko dla czytelności pliku.
  state.setEquipment({ items: flat, groups: items, repels: repelStock(items), lastUpdated });

  // Powiadamiamy tylko przy spadku poniżej progu — bez tego alert
  // powtarzałby się przy każdym wejściu do plecaka.
  // Alerty o Tepelach/Repelach tylko dla tego, ktorego faktycznie uzywamy -
  // reszta lezy w plecaku nieuzywana i nie ma sensu o niej przypominac.
  const usedRepel = activeRepelName(options);

  const low = [];
  for (const [name, value] of Object.entries(flat)) {
    const limit = thresholdFor(thresholds, name);
    if (value > limit) continue;

    if (isRepelItem(name) && normalizeItemName(name) !== normalizeItemName(usedRepel)) {
      log.debug(`Plecak: ${name} ponizej progu, ale nie jest uzywany - bez alertu.`);
      continue;
    }

    const before = flatPrevious?.[name];
    const wasAbove = before === undefined || before > limit;
    low.push({ name, value, limit, notified: wasAbove });

    if (wasAbove) {
      await sendNotification(`Dokup ${name}, zostało ${value}`);
      log.warn(`Plecak: mało ${name} (${value} <= ${limit}) - wysłano powiadomienie.`);
    } else {
      log.debug(`Plecak: ${name} nadal niski (${value}) - powiadomienie już wysłane.`);
    }
  }

  return { items, flat, low };
}

// --- Uzycie Tepela/Repela ------------------------------------------------
// Przebieg: kafelka -> modal #plecak-<kind><tier> z przyciskiem "Uzyj"
// -> ekran z pytaniem "Czy na pewno..." i przyciskiem "Potwierdz".
const USE_BTN = 'button, a.btn, input[type="submit"]';

// Otwiera zakladke plecaka o podanej nazwie (np. "Używalne").
// Panele sa w DOM od razu, ale kliknac mozna tylko w widoczna kafelke.
async function openTab(page, tabName) {
  try {
    const tab = page.locator('.nav-tabs a', { hasText: tabName }).first();
    if (await tab.count().catch(() => 0) === 0) return false;
    await tab.click();
    await page.waitForTimeout(800);
    return true;
  } catch {
    return false;
  }
}

// Klika widoczny przycisk o podanym napisie. Zwraca true, gdy kliknieto.
async function clickButton(scope, text, timeout = 5000) {
  try {
    const btn = scope.locator(`${USE_BTN}:visible`, { hasText: text }).first();
    await btn.waitFor({ state: 'visible', timeout });
    await btn.click();
    return true;
  } catch {
    return false;
  }
}

// Uzywa Tepela/Repela: kafelka -> modal -> "Uzyj" -> "Potwierdz".
// Modal ma id #plecak-<kind><tier>, np. #plecak-repel3 dla MAX Repela -
// to ten sam schemat, ktorym health.js rozpoznaje aktywny przedmiot.
// Zwraca true dopiero po zatwierdzeniu.
async function clickUseItem(page, itemName, kind, tier) {
  const target = normalizeItemName(itemName);
  await openTab(page, TAB_NAMES.trener);

  // 1. Kafelka przedmiotu. Tylko widoczne - ten sam przedmiot jest w DOM
  //    takze w ukrytych panelach innych zakladek.
  const tiles = page.locator(`${BACKPACK.item}:visible`);
  const count = await tiles.count().catch(() => 0);
  let opened = false;

  for (let i = 0; i < count; i++) {
    const tile = tiles.nth(i);
    const parsed = parseItemLabel(await tile.innerText().catch(() => ''));
    // Nazwa musi pasowac dokladnie - "Repel" nie moze trafic w "Super Repel".
    if (!parsed || normalizeItemName(parsed.name) !== target) continue;
    await tile.click();
    opened = true;
    break;
  }

  if (!opened) {
    log.warn(`Tepel/Repel: nie znalazlem kafelki "${itemName}".`);
    return false;
  }

  // 2. Modal z przyciskiem "Uzyj". Pola ilosci nie wypelniamy -
  //    puste znaczy "domyslnie 1", czyli jedna sztuka.
  const modal = page.locator(`#plecak-${kind}${tier}`);
  let scope = page;
  try {
    await modal.waitFor({ state: 'visible', timeout: 5000 });
    scope = modal;
  } catch {
    log.debug(`Tepel/Repel: brak modala #plecak-${kind}${tier}, szukam przycisku na stronie.`);
  }

  if (!await clickButton(scope, 'Użyj')) {
    log.warn(`Tepel/Repel: nie znalazlem przycisku "Użyj" dla ${itemName}.`);
    return false;
  }
  await page.waitForTimeout(1500);

  // 3. Ekran potwierdzenia ("Czy na pewno chcesz uzyc 1 x ...?").
  if (!await clickButton(page, 'Potwierdź')) {
    log.warn(`Tepel/Repel: nie znalazlem przycisku "Potwierdź" dla ${itemName}.`);
    return false;
  }
  await page.waitForTimeout(2000);

  return true;
}

// Aktywuje wskazany Tepel/Repel (kind: 'tepel'|'repel', tier: 1-3).
// Wchodzi do plecaka, przechodzi sciezke kafelka -> "Użyj" -> "Potwierdź",
// odswieza stan i wraca na strone. Zwraca true tylko po zatwierdzeniu.
async function UseRepel(page, kind, tier, navigate) {
  const key = `${kind}-${tier}`;
  const name = REPEL_ITEM_NAMES[key];
  if (!name) {
    log.warn(`Tepel/Repel: nieznany przedmiot "${key}".`);
    return false;
  }

  try {
    if (typeof navigate === 'function') {
      await navigate(page, 'Postać', 'Plecak');
      await page.waitForTimeout(1500);
    }

    // Wejscie do plecaka to i tak dobry moment na odswiezenie stanu.
    const items = await readBackpackItems(page);
    if (items) {
      await saveEquipment(items, { autoRepelKind: kind, autoRepelTier: tier });
    }

    // Nie klikamy w cos, czego nie ma - bot jedzie dalej bez Tepela.
    const stock = items ? repelStock(items)[key] : undefined;
    if (stock !== undefined && stock <= 0) {
      log.warn(`Tepel/Repel: brak ${name} w plecaku - kontynuuję bez niego.`);
      await sendNotification(`Brak ${name} w plecaku, wyprawa bez niego`);
      return false;
    }

    const clicked = await clickUseItem(page, name, kind, tier);
    if (!clicked) {
      log.warn(`Tepel/Repel: nie udało się użyć ${name} - kontynuuję bez niego.`);
      await sendNotification(`Nie udało się użyć ${name}, wyprawa bez niego`);
      return false;
    }

    log.info(`Tepel/Repel: aktywowano ${name}.`);

    // Po uzyciu jestesmy na stronie wyniku, nie w plecaku - zeby odswiezyc
    // stan, trzeba do niego wrocic. Bez tego odczyt zlapalby inna strone.
    if (typeof navigate === 'function') {
      await navigate(page, 'Postać', 'Plecak');
      await page.waitForTimeout(1500);
      await UpdateEquipment(page, { autoRepelKind: kind, autoRepelTier: tier });
    }
    return true;
  } catch (e) {
    log.warn('Tepel/Repel: błąd podczas aktywacji', { error: String(e) });
    return false;
  } finally {
    try {
      await page.reload();
      await page.waitForTimeout(1000);
    } catch (e) {
      log.debug('Tepel/Repel: nie udało się odświeżyć strony', { error: String(e) });
    }
  }
}

// Wypycha do panelu ostatnio zapisany stan plecaka (bez wchodzenia do gry).
// Używane przy starcie bota, żeby panel nie był pusty do pierwszej wizyty.
async function PublishSavedEquipment() {
  try {
    const { items, lastUpdated } = await loadEquipment();
    state.setEquipment({ items: flattenItems(items), groups: items, repels: repelStock(items), lastUpdated });
    return true;
  } catch (e) {
    log.debug('Plecak: nie udało się wczytać zapisanego stanu', { error: String(e) });
    return false;
  }
}

// Wchodzi do plecaka (Postać → Plecak) i aktualizuje stan.
// Używać wszędzie tam, gdzie bot i tak otwiera plecak.
async function OpenBackpackAndUpdate(page, navigate, options = {}) {
  try {
    if (typeof navigate === 'function') {
      await navigate(page, 'Postać', 'Plecak');
      await page.waitForTimeout(1500);
    }
    return await UpdateEquipment(page, options);
  } catch (e) {
    log.warn('Plecak: błąd podczas odczytu', { error: String(e) });
    return null;
  } finally {
    // Po odczycie wracamy do stanu wyjściowego — bot nie zostaje w plecaku.
    try {
      await page.reload();
      await page.waitForTimeout(1000);
      log.debug('Plecak: odświeżono stronę.');
    } catch (e) {
      log.debug('Plecak: nie udało się odświeżyć strony', { error: String(e) });
    }
  }
}

module.exports = {
  UpdateEquipment,
  OpenBackpackAndUpdate,
  PublishSavedEquipment,
  UseRepel,
  readBackpackItems,
  loadEquipment,
  thresholdFor,
  repelStock,
  flattenItems,
  saveEquipment,
  isRepelItem,
  activeRepelName,
  parseItemLabel,
  readVisibleItems,
  EQUIPMENT_PATH,
  BACKPACK,
  REPEL_ITEM_NAMES,
};
