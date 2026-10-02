const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { loadFromFile, saveToFile } = require('../utils/fileOperations');
const { parseCatalog, parseItemOffers } = require('../logic/marketParse');

const log = logger.child({ module: 'market' });

// Analiza targu w czasie, gdy bot i tak czeka (trening przy odnawianiu PA,
// timer opieki). Targ otwieramy w OSOBNEJ karcie tej samej sesji:
// - bez drugiego logowania (wspolne ciasteczka kontekstu),
// - glowna karta zostaje na stronie, na ktorej bot czeka (opieka szuka
//   na niej timera po odswiezeniu - przejscie na targ przerwaloby czekanie).

const GAME_URL = 'https://gra.pokelife.pl/index.php';
const CONFIG_PATH = path.resolve(__dirname, '..', '..', 'config', 'config.json');
const CATALOG_PATH = path.resolve(__dirname, '..', '..', 'config', 'market-catalog.json');
const SNAPSHOT_DIR = path.resolve(__dirname, '..', '..', 'logs', 'market');
const DEFAULT_INTERVAL_MIN = 60;
const MIN_INTERVAL_MIN = 15;
const KEEP_SNAPSHOTS = 10;
// Obserwowane przedmioty (kody z katalogu, np. "ultraballe"), gdy config
// nie podaje marketWatchItems. Limit na jeden odczyt - zeby odczyt trwal
// sekundy, a nie minuty.
const DEFAULT_WATCH = ['ultraballe', 'rawst_berry', 'repel3', 'napoj_energetyczny'];
const MAX_ITEMS_PER_SCAN = 8;

let lastScanAt = 0;
let scanning = false;

function saveSnapshot(name, html, dir = SNAPSHOT_DIR) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${name}-${stamp}.html`);
  fs.writeFileSync(file, html, 'utf8');
  // Trzymamy tylko kilka ostatnich - to material do budowy parsera.
  const old = fs.readdirSync(dir).filter((f) => f.startsWith(`${name}-`)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - KEEP_SNAPSHOTS))) {
    fs.unlinkSync(path.join(dir, f));
  }
  return file;
}

async function openViaMenu(page, menuText, itemText) {
  await page.click(`a.dropdown-toggle:has-text("${menuText}")`, { timeout: 15000 });
  await page.click(`ul.dropdown-menu >> text=${itemText}`, { timeout: 15000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
}

// Otwiera oferty jednego przedmiotu: katalog -> zakladka -> przycisk.
// Przyciski laduja sie przez AJAX (btn-akcja), wiec katalog otwieramy od
// nowa dla kazdego przedmiotu.
async function openItemOffers(tab, item) {
  await openViaMenu(tab, 'Targ', 'Kup - Przedmioty');
  const pane = item.href.match(/zakladka=(\d+)/)?.[1];
  const tabLink = tab.locator('ul.nav-tabs a[href^="#targ_kupprz-"]').nth(Number(pane) || 0);
  if (await tabLink.count()) await tabLink.click().catch(() => {});
  await tab.locator(`button.btn-akcja[href*="przedmiot=${item.code}&"]`).first().click({ timeout: 15000 });
  await tab.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await tab.waitForTimeout(1000);
  return tab.content();
}

// Jeden odczyt targu w osobnej karcie. Nigdy nie rzuca - blad targu nie moze
// zatrzymac bota. url/snapshotDir/catalogPath podmieniaja testy.
async function ScanMarket(context, {
  url = GAME_URL, snapshotDir = SNAPSHOT_DIR, catalogPath = CATALOG_PATH, watch = DEFAULT_WATCH,
} = {}) {
  let tab = null;
  try {
    tab = await context.newPage();
    await tab.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await openViaMenu(tab, 'Targ', 'Kup - Przedmioty');
    const catalog = parseCatalog(await tab.content());
    if (catalog.length === 0) {
      saveSnapshot('kup-przedmioty', await tab.content(), snapshotDir);
      log.warn('Targ: nie rozpoznano katalogu przedmiotów - zapisano stronę.');
      return { ok: false, error: 'pusty katalog' };
    }
    // Katalog do podgladu w panelu / wyboru kodow do marketWatchItems.
    await saveToFile(catalogPath, { updatedAt: new Date().toISOString(), items: catalog });

    const wanted = new Set(watch.map((c) => String(c).trim().toLowerCase()));
    const items = catalog.filter((i) => wanted.has(i.code)).slice(0, MAX_ITEMS_PER_SCAN);
    const unknown = [...wanted].filter((c) => !catalog.some((i) => i.code === c));
    if (unknown.length) log.warn(`Targ: nieznane kody w marketWatchItems: ${unknown.join(', ')}`);

    const results = [];
    for (const item of items) {
      try {
        const html = await openItemOffers(tab, item);
        const offers = parseItemOffers(html);
        if (offers === null) {
          saveSnapshot(`oferty-${item.code}`, html, snapshotDir);
          results.push({ item: item.code, offers: null });
        } else {
          results.push({ item: item.code, offers });
        }
      } catch (e) {
        log.warn(`Targ: nie udało się otworzyć ofert ${item.name}`, { error: String(e) });
        results.push({ item: item.code, error: String(e) });
      }
    }
    const pending = results.filter((r) => r.offers === null).map((r) => r.item);
    log.info(`Targ: katalog ${catalog.length} przedmiotów, sprawdzono ${results.length}` +
      (pending.length ? ` (parser ofert jeszcze nie gotowy - zapisano strony: ${pending.join(', ')})` : '.'));
    return { ok: true, catalog: catalog.length, results };
  } catch (e) {
    log.warn('Targ: odczyt nieudany', { error: String(e) });
    return { ok: false, error: String(e) };
  } finally {
    if (tab) await tab.close().catch(() => {});
  }
}

// Wywolywane z miejsc, w ktorych bot czeka. Odczyt nie czesciej niz co
// marketScanMinutes (config, domyslnie 60); marketScanEnabled=false wylacza.
async function runMarketScanIfDue(page, now = Date.now()) {
  if (scanning) return null;
  const cfg = (await loadFromFile(CONFIG_PATH)) || {};
  if (cfg.marketScanEnabled === false) return null;
  const minutes = Math.max(MIN_INTERVAL_MIN, Number(cfg.marketScanMinutes) || DEFAULT_INTERVAL_MIN);
  if (now - lastScanAt < minutes * 60000) return null;

  scanning = true;
  lastScanAt = now;
  try {
    const watch = Array.isArray(cfg.marketWatchItems) && cfg.marketWatchItems.length
      ? cfg.marketWatchItems
      : DEFAULT_WATCH;
    return await ScanMarket(page.context(), { watch });
  } finally {
    scanning = false;
  }
}

module.exports = { ScanMarket, runMarketScanIfDue, SNAPSHOT_DIR, DEFAULT_WATCH };
