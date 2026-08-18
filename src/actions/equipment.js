const path = require('path');
const { logger } = require('../utils/logger');
const { loadFromFile, saveToFile } = require('../utils/fileOperations');
const { sendNotification } = require('../utils/notifier');

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

  await saveToFile(EQUIPMENT_PATH, {
    items,
    thresholds,
    lastUpdated: new Date().toISOString(),
  });
  log.info(`Plecak: zapisano ${Object.keys(items).length} przedmiotów.`);

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
  }
}

module.exports = {
  UpdateEquipment,
  OpenBackpackAndUpdate,
  readBackpackItems,
  loadEquipment,
  thresholdFor,
  EQUIPMENT_PATH,
  BACKPACK,
};
