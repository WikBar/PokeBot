const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { loadFromFile, saveToFile } = require('../utils/fileOperations');
const { sendNotification } = require('../utils/notifier');
const { parseCatalog, parseItemOffers, parseOffersPaging, parseOffersPage } = require('../logic/marketParse');
const { buildMarketSummary } = require('../logic/market');
const marketStore = require('../utils/marketStore');

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
// Okazje juz zgloszone na Telegram (id oferty) - kazda tylko raz.
const notifiedDeals = new Set();

function saveSnapshot(name, html, dir = SNAPSHOT_DIR) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${name}-${stamp}.html`);
  fs.writeFileSync(file, html, 'utf8');
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

// Pobranie strony gry zwyklym fetch z karty gry - z ciasteczkami sesji,
// tak jak robi to sama gra (jQuery .load), bez klikania w zakladki.
async function fetchHtml(tab, url) {
  return tab.evaluate(async (u) => {
    const res = await fetch(u, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }, url);
}

// Strona przedmiotu (to, co laduje przycisk w katalogu) nie zawiera ofert -
// doladowuje je osobne zadanie z numerem strony. Najtansze oferty sa na
// poczatku, wiec wystarcza kilka pierwszych stron.
const MAX_OFFER_PAGES = 3;

async function fetchItemOffers(tab, item) {
  const itemUrl = new URL(item.href, new URL('gra/', tab.url())).toString();
  const itemHtml = await fetchHtml(tab, itemUrl);
  const paging = parseOffersPaging(itemHtml);
  if (!paging) return { offers: parseItemOffers(itemHtml), html: itemHtml };

  const offers = [];
  let lastHtml = itemHtml;
  for (let page = 1; page <= Math.min(paging.totalPages, MAX_OFFER_PAGES); page++) {
    lastHtml = await fetchHtml(tab, new URL(paging.pageUrl(page), tab.url()).toString());
    offers.push(...parseOffersPage(lastHtml));
  }
  return { offers, html: lastHtml, pages: paging.totalPages };
}

const fmtYen = (n) => `${Number(n).toLocaleString('pl-PL')} ¥`;

async function notifyNewDeals(deals) {
  const fresh = deals.filter((d) => !notifiedDeals.has(d.offer.id));
  if (!fresh.length) return 0;
  for (const d of fresh) notifiedDeals.add(d.offer.id);
  const lines = fresh.slice(0, 10).map((d) =>
    `- ${d.name}: ${fmtYen(d.offer.unitPrice)} × ${d.offer.quantity} (${Math.round(d.ratio * 100)}% typowej najniższej ceny ${fmtYen(d.reference)}), sprzedawca ${d.offer.seller || '?'}`);
  await sendNotification(`PokeBot - okazje na targu:\n${lines.join('\n')}`);
  return fresh.length;
}

// Jeden odczyt targu w osobnej karcie. Nigdy nie rzuca - blad targu nie moze
// zatrzymac bota. Sciezki i url podmieniaja testy.
async function ScanMarket(context, {
  url = GAME_URL,
  snapshotDir = SNAPSHOT_DIR,
  catalogPath = CATALOG_PATH,
  historyPath = marketStore.HISTORY_PATH,
  summaryPath = marketStore.SUMMARY_PATH,
  watch = DEFAULT_WATCH,
  dealRatio = 0.85,
  notify = true,
} = {}) {
  let tab = null;
  try {
    tab = await context.newPage();
    await tab.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await openViaMenu(tab, 'Targ', 'Kup - Przedmioty');
    const catalogHtml = await tab.content();
    const catalog = parseCatalog(catalogHtml);
    if (catalog.length === 0) {
      saveSnapshot('kup-przedmioty', catalogHtml, snapshotDir);
      log.warn('Targ: nie rozpoznano katalogu przedmiotów - zapisano stronę.');
      return { ok: false, error: 'pusty katalog' };
    }
    await saveToFile(catalogPath, { updatedAt: new Date().toISOString(), items: catalog });

    const wanted = new Set(watch.map((c) => String(c).trim().toLowerCase()));
    const items = catalog.filter((i) => wanted.has(i.code)).slice(0, MAX_ITEMS_PER_SCAN);
    const unknown = [...wanted].filter((c) => !catalog.some((i) => i.code === c));
    if (unknown.length) log.warn(`Targ: nieznane kody w marketWatchItems: ${unknown.join(', ')}`);

    const now = Date.now();
    const offersByItem = {};
    const names = {};
    for (const item of items) {
      names[item.code] = item.name;
      try {
        const { offers, html } = await fetchItemOffers(tab, item);
        if (offers === null || offers.length === 0) {
          // Nie rozpoznano strony albo brak ofert (rzadkie dla obserwowanych
          // przedmiotow) - zapis do analizy.
          saveSnapshot(`oferty-${item.code}`, html, snapshotDir);
          if (offers === null) {
            log.warn(`Targ: nie rozpoznano ofert ${item.name} - zapisano stronę.`);
            continue;
          }
        }
        offersByItem[item.code] = offers;
      } catch (e) {
        log.warn(`Targ: nie udało się pobrać ofert ${item.name}`, { error: String(e) });
      }
    }

    // Historia: kazda oferta z cena w ¥ jako obserwacja z tego odczytu.
    const observations = Object.values(offersByItem).flat()
      .filter((o) => o.unitPrice > 0)
      .map((o) => ({ id: o.id, item: o.item, unitPrice: o.unitPrice, quantity: o.quantity, seller: o.seller, ts: now }));
    marketStore.appendHistory(observations, historyPath);
    const history = marketStore.loadHistory(historyPath, now);

    const summary = buildMarketSummary({ offersByItem, names, history, now, dealRatio });
    await marketStore.saveSummary(summary, summaryPath);

    const notified = notify ? await notifyNewDeals(summary.deals) : 0;
    log.info(`Targ: ${Object.keys(offersByItem).length}/${items.length} przedmiotów, ${observations.length} ofert` +
      (summary.deals.length ? `, okazje: ${summary.deals.length} (nowe zgłoszone: ${notified})` : ''));
    return { ok: true, catalog: catalog.length, summary };
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
    const ratio = Number(cfg.marketDealRatio);
    return await ScanMarket(page.context(), { watch, dealRatio: ratio > 0 && ratio < 1 ? ratio : 0.85 });
  } finally {
    scanning = false;
  }
}

module.exports = { ScanMarket, runMarketScanIfDue, SNAPSHOT_DIR, DEFAULT_WATCH };
