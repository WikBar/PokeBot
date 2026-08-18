const path = require('path');
const { logger } = require('../utils/logger');
const { loadFromFile, saveToFile } = require('../utils/fileOperations');
const { sendNotification } = require('../utils/notifier');
const state = require('../state');

const log = logger.child({ module: 'equipment' });

const EQUIPMENT_PATH = path.resolve(__dirname, '..', '..', 'config', 'equipment.json');

// Domyślny próg, gdy przedmiot nie ma własnego w equipment.json.
const DEFAULT_THRESHOLD = 10;

// --- Selektory strony plecaka -------------------------------------------
// Zebrane w jednym miejscu, żeby łatwo je dostroić do realnego HTML.
const BACKPACK = {
  // Pojedyncza kafelka przedmiotu.
  item: 'div.well.well-sm, div.przedmiot, div[class*="plecak"] div.well',
  // Nazwa i liczba wewnątrz kafelki (fallback: cały tekst kafelki).
  name: 'b, strong, .nazwa',
  count: '.ilosc, .badge, .count',
};

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

// Stan Tepeli/Repeli na podstawie zawartości plecaka:
// { 'repel-1': 12, 'tepel-3': 0, ... }. Brak wpisu = 0 sztuk.
function repelStock(items) {
  const byNormalized = {};
  for (const [name, value] of Object.entries(items || {})) {
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

// Czyta kafelki plecaka i zwraca { nazwa: liczba }.
async function readBackpackItems(page) {
  const items = {};
  const tiles = page.locator(BACKPACK.item);
  const count = await tiles.count().catch(() => 0);
  if (count === 0) {
    log.debug('Plecak: nie znaleziono kafelek przedmiotów.');
    return null;
  }

  for (let i = 0; i < count; i++) {
    const tile = tiles.nth(i);
    const raw = (await tile.innerText().catch(() => '')).trim();
    if (!raw) continue;

    // Nazwa: dedykowany element, a gdy go nie ma — pierwsza linia kafelki.
    let name = await tile.locator(BACKPACK.name).first().innerText().catch(() => '');
    name = (name || raw.split('\n')[0] || '').trim();
    if (!name) continue;

    // Liczba: dedykowany element, a gdy go nie ma — pierwsza liczba w tekście.
    let countText = await tile.locator(BACKPACK.count).first().innerText().catch(() => '');
    if (!countText) {
      const m = raw.match(/(\d[\d\s.,]*)\s*(szt|x)?\s*$/i) || raw.match(/\d[\d\s.,]*/);
      countText = m ? m[0] : '';
    }
    const value = parseInt(String(countText).replace(/[^\d]/g, ''), 10);
    if (Number.isNaN(value)) continue;

    items[name] = value;
  }

  return Object.keys(items).length > 0 ? items : null;
}

// Odczytuje plecak, zapisuje stan do equipment.json i wysyła powiadomienie
// o przedmiotach poniżej progu. Zwraca { items, low } albo null.
async function UpdateEquipment(page) {
  const items = await readBackpackItems(page);
  if (!items) {
    log.info('Plecak: nie udało się odczytać zawartości - pomijam.');
    return null;
  }

  const { items: previous, thresholds } = await loadEquipment();

  const lastUpdated = new Date().toISOString();
  await saveToFile(EQUIPMENT_PATH, { items, thresholds, lastUpdated });
  log.info(`Plecak: zapisano ${Object.keys(items).length} przedmiotów.`);

  // Panel web potrzebuje stanu plecaka, żeby wiedzieć, których
  // Tepeli/Repeli w ogóle nie ma i zablokować ich aktywację.
  state.setEquipment({ items, repels: repelStock(items), lastUpdated });

  // Powiadamiamy tylko przy spadku poniżej progu — bez tego alert
  // powtarzałby się przy każdym wejściu do plecaka.
  const low = [];
  for (const [name, value] of Object.entries(items)) {
    const limit = thresholdFor(thresholds, name);
    if (value > limit) continue;

    const before = previous?.[name];
    const wasAbove = before === undefined || before > limit;
    low.push({ name, value, limit, notified: wasAbove });

    if (wasAbove) {
      await sendNotification(`Dokup ${name}, zostało ${value}`);
      log.warn(`Plecak: mało ${name} (${value} <= ${limit}) - wysłano powiadomienie.`);
    } else {
      log.debug(`Plecak: ${name} nadal niski (${value}) - powiadomienie już wysłane.`);
    }
  }

  return { items, low };
}

// Selektory przycisku użycia przedmiotu w plecaku (do dostrojenia po HTML).
const USE_ITEM = 'button, a.btn, input[type="submit"]';
const USE_TEXTS = ['Użyj', 'Uzyj', 'Aktywuj'];

// Klika "Użyj" na kafelce danego przedmiotu w otwartym plecaku.
// Zwraca true, gdy udało się kliknąć.
async function clickUseItem(page, itemName) {
  const target = normalizeItemName(itemName);
  const tiles = page.locator(BACKPACK.item);
  const count = await tiles.count().catch(() => 0);

  for (let i = 0; i < count; i++) {
    const tile = tiles.nth(i);
    const raw = (await tile.innerText().catch(() => '')).trim();
    if (!raw) continue;

    // Nazwa musi pasować dokładnie — "Repel" nie może trafić w "Super Repel".
    let name = await tile.locator(BACKPACK.name).first().innerText().catch(() => '');
    name = normalizeItemName(name || raw.split('\n')[0] || '');
    if (name !== target) continue;

    for (const text of USE_TEXTS) {
      const btn = tile.locator(`${USE_ITEM}`, { hasText: text }).first();
      if (await btn.count().catch(() => 0) > 0) {
        await btn.click();
        await page.waitForTimeout(1500);
        return true;
      }
    }

    // Brak podpisanego przycisku — próbujemy kliknąć samą kafelkę.
    await tile.click().catch(() => {});
    await page.waitForTimeout(1500);
    return true;
  }

  return false;
}

// Aktywuje wskazany Tepel/Repel (kind: 'tepel'|'repel', tier: 1-3).
// Wchodzi do plecaka, klika "Użyj", odświeża stan i wraca na stronę.
// Zwraca true tylko wtedy, gdy przedmiot faktycznie kliknięto.
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

    // Najpierw sprawdzamy stan — nie klikamy w coś, czego nie ma.
    const items = await readBackpackItems(page);
    const stock = items ? repelStock(items)[key] : undefined;
    if (stock !== undefined && stock <= 0) {
      log.warn(`Tepel/Repel: brak ${name} w plecaku - pomijam aktywację.`);
      return false;
    }

    const clicked = await clickUseItem(page, name);
    if (!clicked) {
      log.warn(`Tepel/Repel: nie znalazłem przycisku użycia dla ${name}.`);
      return false;
    }

    log.info(`Tepel/Repel: aktywowano ${name}.`);
    // Po użyciu stan plecaka się zmienił — odczytujemy go ponownie.
    await UpdateEquipment(page);
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
    state.setEquipment({ items, repels: repelStock(items), lastUpdated });
    return true;
  } catch (e) {
    log.debug('Plecak: nie udało się wczytać zapisanego stanu', { error: String(e) });
    return false;
  }
}

// Wchodzi do plecaka (Postać → Plecak) i aktualizuje stan.
// Używać wszędzie tam, gdzie bot i tak otwiera plecak.
async function OpenBackpackAndUpdate(page, navigate) {
  try {
    if (typeof navigate === 'function') {
      await navigate(page, 'Postać', 'Plecak');
      await page.waitForTimeout(1500);
    }
    return await UpdateEquipment(page);
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
  EQUIPMENT_PATH,
  BACKPACK,
  REPEL_ITEM_NAMES,
};
