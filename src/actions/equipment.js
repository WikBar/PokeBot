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
  // Kafelka przedmiotu - bierzemy tylko te z podpisem.
  item: '.panel-body .col-xs-3, .panel-body .col-sm-3, .thumbnail',
  // Zakladki plecaka; kazda ma osobna liste przedmiotow.
  tab: '.nav-tabs a, ul.nav.nav-tabs li a',
};

// Zakladki, ktore czytamy. "Uzywalne" ma Tepele/Repele, "Pokeballe" - kule.
const BACKPACK_TABS = ['Używalne', 'Pokeballe'];

// Podpisy zakladek i naglowka. Gdyby selektor kafelek zlapal takze je,
// "Pokeballe" (zakladka) nadpisaloby "Pokeballe" (przedmiot) wartoscia 1.
const NOT_ITEMS = new Set([
  'plecak', 'używalne', 'uzywalne', 'dla pokemona', 'pokeballe', 'ewolucyjne',
  'tm', 'trzymane', 'pokeboxy', 'ulepszenia',
]);

// Rozbija podpis kafelki na nazwe i ilosc.
// "50 x MAX Repel" -> { name: 'MAX Repel', value: 50 }
// "Blyszczacy Medalion Zal" -> { name: '...', value: 1 }
function parseItemLabel(text) {
  const label = String(text || '').replace(/\s+/g, ' ').trim();
  if (!label) return null;

  const m = label.match(/^([\d\s.,]+)\s*x\s*(.+)$/i);
  if (m) {
    const value = parseInt(m[1].replace(/[^\d]/g, ''), 10);
    const name = m[2].trim();
    if (!name || Number.isNaN(value)) return null;
    return { name, value };
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

// Czyta kafelki z aktualnie otwartej zakladki -> { nazwa: liczba }.
async function readVisibleItems(page) {
  const items = {};
  const tiles = page.locator(BACKPACK.item);
  const count = await tiles.count().catch(() => 0);

  for (let i = 0; i < count; i++) {
    const raw = await tiles.nth(i).innerText().catch(() => '');
    const parsed = parseItemLabel(raw);
    // Sam podpis zakladki (bez liczby) nie jest przedmiotem.
    if (!parsed) continue;
    if (parsed.value === 1 && NOT_ITEMS.has(normalizeItemName(parsed.name))) continue;
    items[parsed.name] = parsed.value;
  }
  return items;
}

// Przechodzi po zakladkach plecaka i skleja ich zawartosc.
// Zwraca { nazwa: liczba } albo null, gdy nic nie znaleziono.
async function readBackpackItems(page) {
  const items = {};

  // Najpierw to, co widac po wejsciu (domyslna zakladka).
  Object.assign(items, await readVisibleItems(page));

  for (const tabName of BACKPACK_TABS) {
    try {
      const tab = page.locator(BACKPACK.tab, { hasText: tabName }).first();
      if (await tab.count().catch(() => 0) === 0) {
        log.debug(`Plecak: brak zakladki "${tabName}".`);
        continue;
      }
      await tab.click();
      await page.waitForTimeout(1200);
      Object.assign(items, await readVisibleItems(page));
    } catch (e) {
      log.debug(`Plecak: nie udalo sie otworzyc zakladki "${tabName}"`, { error: String(e) });
    }
  }

  if (Object.keys(items).length === 0) {
    log.debug('Plecak: nie znaleziono kafelek przedmiotow.');
    return null;
  }
  return items;
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

// Uzycie przedmiotu: na kafelce nie ma widocznego przycisku, wiec klikamy
// sama kafelke, a potem ewentualne potwierdzenie w oknie modalnym.
const USE_CONFIRM = 'button, a.btn, input[type="submit"]';
const USE_TEXTS = ['Użyj', 'Uzyj', 'Aktywuj', 'Tak', 'Potwierdź', 'Potwierdz'];

// Klika kafelke wskazanego przedmiotu w otwartej zakladce plecaka
// i zatwierdza ewentualne okno potwierdzenia. Zwraca true po kliknieciu.
async function clickUseItem(page, itemName) {
  const target = normalizeItemName(itemName);
  const tiles = page.locator(BACKPACK.item);
  const count = await tiles.count().catch(() => 0);

  for (let i = 0; i < count; i++) {
    const tile = tiles.nth(i);
    const parsed = parseItemLabel(await tile.innerText().catch(() => ''));
    // Nazwa musi pasowac dokladnie - "Repel" nie moze trafic w "Super Repel".
    if (!parsed || normalizeItemName(parsed.name) !== target) continue;

    await tile.click();
    await page.waitForTimeout(1500);

    // Jesli pojawilo sie potwierdzenie, klikamy je.
    for (const text of USE_TEXTS) {
      const btn = page.locator(`${USE_CONFIRM}:visible`, { hasText: text }).first();
      if (await btn.count().catch(() => 0) > 0) {
        await btn.click().catch(() => {});
        await page.waitForTimeout(1500);
        break;
      }
    }
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
  parseItemLabel,
  readVisibleItems,
  EQUIPMENT_PATH,
  BACKPACK,
  REPEL_ITEM_NAMES,
};
