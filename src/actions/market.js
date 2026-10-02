const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { loadFromFile } = require('../utils/fileOperations');

const log = logger.child({ module: 'market' });

// Analiza targu w czasie, gdy bot i tak czeka (trening przy odnawianiu PA,
// timer opieki). Targ otwieramy w OSOBNEJ karcie tej samej sesji:
// - bez drugiego logowania (wspolne ciasteczka kontekstu),
// - glowna karta zostaje na stronie, na ktorej bot czeka (opieka szuka
//   na niej timera po odswiezeniu - przejscie na targ przerwaloby czekanie).

const GAME_URL = 'https://gra.pokelife.pl/index.php';
const CONFIG_PATH = path.resolve(__dirname, '..', '..', 'config', 'config.json');
const SNAPSHOT_DIR = path.resolve(__dirname, '..', '..', 'logs', 'market');
const DEFAULT_INTERVAL_MIN = 60;
const MIN_INTERVAL_MIN = 15;
const KEEP_SNAPSHOTS = 10;

let lastScanAt = 0;
let scanning = false;

// Parser listy ofert "Kup - Przedmioty". Do czasu poznania struktury strony
// zwraca null - wtedy zapisujemy strone do logs/market/ do analizy.
function parseItemOffers(_html) {
  return null;
}

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

// Jeden odczyt targu w osobnej karcie. Nigdy nie rzuca - blad targu nie moze
// zatrzymac bota. url/snapshotDir podmieniaja testy.
async function ScanMarket(context, { url = GAME_URL, snapshotDir = SNAPSHOT_DIR } = {}) {
  let tab = null;
  try {
    tab = await context.newPage();
    await tab.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await openViaMenu(tab, 'Targ', 'Kup - Przedmioty');
    const html = await tab.content();
    const offers = parseItemOffers(html);
    if (offers === null) {
      const file = saveSnapshot('kup-przedmioty', html, snapshotDir);
      log.info(`Targ: parser ofert jeszcze nie gotowy - zapisano stronę ${path.basename(file)}.`);
      return { ok: true, offers: null };
    }
    log.info(`Targ: odczytano ${offers.length} ofert.`);
    return { ok: true, offers };
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
    return await ScanMarket(page.context());
  } finally {
    scanning = false;
  }
}

module.exports = { ScanMarket, runMarketScanIfDue, parseItemOffers, SNAPSHOT_DIR };
