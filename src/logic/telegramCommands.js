// Komendy Telegram - czysta logika: rozpoznanie komendy i tresc odpowiedzi.
// Wykonanie efektow (pauza, szpital) i wysylka sa w utils/telegramBot.js.

const COMMANDS = {
  status: ['/status', '/s'],
  pause: ['/pauza', '/pause'],
  resume: ['/wznow', '/wznów', '/resume'],
  hospital: ['/szpital', '/hospital'],
  shiny: ['/shiny'],
  report: ['/raport', '/report'],
  market: ['/targ', '/market'],
  help: ['/pomoc', '/help', '/start'],
};

// "/Pauza@MojBot  teraz" -> 'pause'; nieznana komenda -> 'unknown';
// zwykly tekst -> null.
function parseCommand(text) {
  const first = String(text || '').trim().split(/\s+/)[0];
  if (!first.startsWith('/')) return null;
  const cmd = first.split('@')[0].toLowerCase();
  for (const [name, aliases] of Object.entries(COMMANDS)) {
    if (aliases.includes(cmd)) return name;
  }
  return 'unknown';
}

const HELP = [
  'Komendy PokeBota:',
  '/status - PA, HP, lokacja, polowanie',
  '/pauza - wstrzymaj bota',
  '/wznow - wznów bota',
  '/szpital - idź do Centrum Pokemon',
  '/shiny - stan polowania i najlepsze lokacje',
  '/raport - anomalie z logów (24 h)',
  '/targ - przegląd targu: obserwowane, okazje',
  '/targ <nazwa> - ceny konkretnego przedmiotu, np. /targ rawst',
].join('\n');

const minutesAgo = (iso, now) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? Math.round((now - t) / 60000) : null;
};

function formatStatus(s, now = Date.now()) {
  const lines = [];
  lines.push(s.isPaused ? '⏸ Bot wstrzymany' : s.emergencyStop ? '⛔ Bot zatrzymany (Stop)' : '▶️ Bot działa');
  if (s.region) lines.push(`Lokacja: ${s.region} ${s.adventureNr ?? '?'}`);
  if (s.pa?.max) lines.push(`PA: ${s.pa.current}/${s.pa.max}`);
  if (s.hp?.max) lines.push(`HP: ${s.hp.current}%`);
  if (s.storage?.max) lines.push(`Przechowalnia: ${s.storage.current}/${s.storage.max}`);
  if (s.shiny) {
    lines.push(s.shiny.hold > 0
      ? `Shiny: blokada po Golden Nest, jeszcze ${s.shiny.hold} wypraw`
      : `Shiny: próba ${s.shiny.tries}/${s.shiny.maxTries}`);
  }
  const ago = minutesAgo(s.lastLogAt, now);
  if (ago !== null) lines.push(`Ostatnia aktywność: ${ago} min temu`);
  if (s.lastEvent) lines.push(`Ostatnie zdarzenie: ${s.lastEvent}`);
  return lines.join('\n');
}

// shiny: { region, runtime, locations } z /api/shiny (logic/shinyStats.summarize)
function formatShiny({ region, runtime, locations }, limit = 5) {
  const lines = [];
  if (runtime?.shiny) {
    const sh = runtime.shiny;
    lines.push(`Polowanie: ${region} ${runtime.adventureNr}, ${sh.hold > 0 ? `blokada ${sh.hold}` : `próba ${sh.tries}`}`);
  }
  if (!locations?.length) {
    lines.push('Brak statystyk - zbierają się w trybie Shiny.');
  } else {
    lines.push(`Golden Nest na 1000 wypraw (${region}):`);
    for (const l of locations.slice(0, limit)) {
      lines.push(`${l.nr}. ${l.name || '?'}: ${l.perThousand}‰ (${l.goldenNests}/${l.trips}, złapane ${l.caught})`);
    }
  }
  return lines.join('\n');
}

function formatReport({ findings, stats }) {
  const yen = Number(stats.yen || 0).toLocaleString('pl-PL');
  const head = `Logi 24 h: łapanie ${stats.caught}, Golden Nest ${stats.goldenNests}, przychód ${yen} ¥, błędy ${stats.errors}, krytyczne ${stats.fatal}`;
  if (!findings.length) return `${head}\nBrak anomalii.`;
  return [head, ...findings.slice(0, 10).map((f) => `- ${f.message}`)].join('\n');
}

const yen = (n) => (n == null ? '-' : `${Number(n).toLocaleString('pl-PL')} ¥`);

const MARKET_QUERY_LIMIT = 10;

function formatMarketItem(i) {
  const trend = i.trend ? `, trend ${Math.round(i.trend * 100)}%` : '';
  // Typowa najnizsza cena dopiero po kilku odczytach - wczesniej nic nie znaczy.
  const typical = i.scans >= 3 ? `, zwykle od ${yen(i.typicalLow)}` : `, odczytów: ${i.scans || 0}`;
  const lines = [i.lowest == null
    ? `${i.name}: brak ofert w ¥`
    : `${i.name}: od ${yen(i.lowest)} (${i.offers} ofert)${typical}${trend}`];
  if (i.suggestedSell) lines.push(`  sprzedaj za ${yen(i.suggestedSell.price)}`);
  return lines;
}

const normalize = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

// summary: config/market-summary.json (logic/market.buildMarketSummary)
// query: "/targ rawst" - wyszukanie po nazwie lub kodzie (bez polskich znakow).
// Bez query: obserwowane przedmioty + najlepsze okazje z calego przegladu
// (pelna lista ~100 przedmiotow nie zmiescilaby sie w wiadomosci).
function formatMarket(summary, now = Date.now(), query = '') {
  if (!summary?.items?.length) return 'Brak danych z targu - bot zagląda tam podczas treningu i opieki.';
  const ago = Math.round((now - Date.parse(summary.updatedAt)) / 60000);
  const q = normalize(query).trim();

  if (q) {
    const found = summary.items.filter((i) => normalize(i.name).includes(q) || normalize(i.code).includes(q));
    if (!found.length) return `Nie znaleziono "${query}" wśród ${summary.items.length} przedmiotów targu.`;
    const lines = [`Targ (odczyt ${ago} min temu), "${query}":`];
    for (const i of found.slice(0, MARKET_QUERY_LIMIT)) lines.push(...formatMarketItem(i));
    if (found.length > MARKET_QUERY_LIMIT) lines.push(`... i ${found.length - MARKET_QUERY_LIMIT} więcej - zawęź wyszukiwanie.`);
    return lines.join('\n');
  }

  const lines = [`Targ (odczyt ${ago} min temu, ${summary.items.length} przedmiotów):`];
  const watched = summary.items.filter((i) => i.watched);
  for (const i of (watched.length ? watched : summary.items.slice(0, 5))) lines.push(...formatMarketItem(i));
  if (summary.deals?.length) {
    lines.push(`Okazje (${summary.deals.length}):`);
    for (const d of summary.deals.slice(0, 8)) {
      lines.push(`- ${d.name}: ${yen(d.offer.unitPrice)} × ${d.offer.quantity} (${Math.round(d.ratio * 100)}% typowej ceny)`);
    }
  }
  lines.push('Konkretny przedmiot: /targ <nazwa>, np. /targ okruch');
  return lines.join('\n');
}

module.exports = { COMMANDS, HELP, parseCommand, formatStatus, formatShiny, formatReport, formatMarket };
