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
  '/targ - ceny na targu, okazje, sugerowane ceny sprzedaży',
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

// summary: config/market-summary.json (logic/market.buildMarketSummary)
function formatMarket(summary, now = Date.now()) {
  if (!summary?.items?.length) return 'Brak danych z targu - bot zagląda tam podczas treningu i opieki.';
  const ago = Math.round((now - Date.parse(summary.updatedAt)) / 60000);
  const lines = [`Targ (odczyt ${ago} min temu):`];
  for (const i of summary.items) {
    const trend = i.trend ? `, trend ${Math.round(i.trend * 100)}%` : '';
    lines.push(`${i.name}: od ${yen(i.lowest)} (${i.offers} ofert), mediana ${yen(i.median)}${trend}`);
    if (i.suggestedSell) lines.push(`  sprzedaj za ${yen(i.suggestedSell.price)}`);
  }
  if (summary.deals?.length) {
    lines.push('Okazje:');
    for (const d of summary.deals.slice(0, 5)) {
      lines.push(`- ${d.name}: ${yen(d.offer.unitPrice)} × ${d.offer.quantity} (${Math.round(d.ratio * 100)}% mediany)`);
    }
  }
  return lines.join('\n');
}

module.exports = { COMMANDS, HELP, parseCommand, formatStatus, formatShiny, formatReport, formatMarket };
