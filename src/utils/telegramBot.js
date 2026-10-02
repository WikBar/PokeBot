// Odbieranie komend z Telegrama (long polling getUpdates). Odpowiadamy
// tylko na wiadomosci z czatu TELEGRAM_CHAT_ID - nikt inny nie moze
// sterowac botem.
//
// Uwaga: getUpdates moze czytac tylko jeden proces na token. Gdy bot
// dziala w dwoch miejscach (lokalnie i na serwerze), Telegram zwraca 409
// i komendy obsluguje tylko jeden z nich.

const { logger } = require('./logger');
const state = require('../state');
const { sendViaTelegram, getTelegramConfig } = require('./notifier');
const {
  HELP, parseCommand, formatStatus, formatShiny, formatReport, formatMarket, formatSaleReport,
} = require('../logic/telegramCommands');
const { analyzeLogs } = require('../logic/logAnalysis');
const { summarize } = require('../logic/shinyStats');
const { listLogFiles, readEntries } = require('./logReader');
const { loadJson, RUNTIME_PATH, SHINY_STATS_PATH } = require('./runtimeStore');
const { loadSummary } = require('./marketStore');
const POKEMON_SALE_PATH = require('path').resolve(__dirname, '..', '..', 'config', 'pokemon-sale.json');

const log = logger.child({ module: 'telegram' });
const API = 'https://api.telegram.org';
const POLL_TIMEOUT_S = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getUpdates(token, offset, timeout) {
  const url = `${API}/bot${token}/getUpdates?timeout=${timeout}&allowed_updates=%5B%22message%22%5D${offset ? `&offset=${offset}` : ''}`;
  const res = await fetch(url, { signal: AbortSignal.timeout((timeout + 15) * 1000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const err = new Error(data.description || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data.result || [];
}

// Odpowiedz na komende; efekty (pauza, szpital) przez te same flagi co panel.
// args - tekst po komendzie (np. "rawst" w "/targ rawst").
function respond(command, args = '') {
  switch (command) {
    case 'status':
      return formatStatus(state.getState());
    case 'pause':
      state.setPaused(true);
      return '⏸ Bot wstrzymany. /wznow - wznów.';
    case 'resume':
      state.setPaused(false);
      return '▶️ Bot wznowiony.';
    case 'hospital':
      state.setForceHospital(true);
      return '🏥 Bot pójdzie do Centrum Pokemon po bieżącej wyprawie.';
    case 'shiny': {
      const runtime = loadJson(RUNTIME_PATH);
      const region = runtime?.region || state.getState().region;
      return formatShiny({ region, runtime, locations: summarize(loadJson(SHINY_STATS_PATH) || {}, region) });
    }
    case 'report': {
      const since = Date.now() - 24 * 3600000;
      const { entries, nullBytes } = readEntries(listLogFiles(since));
      return formatReport(analyzeLogs(entries, { since, nullBytes }));
    }
    case 'market':
      return formatMarket(loadSummary(), Date.now(), args);
    case 'sale':
      return formatSaleReport(loadJson(POKEMON_SALE_PATH));
    case 'help':
      return HELP;
    default:
      return `Nieznana komenda.\n\n${HELP}`;
  }
}

async function handleUpdate(update, chatId) {
  const msg = update.message;
  if (!msg?.text) return;
  if (String(msg.chat?.id) !== String(chatId)) {
    log.warn('Telegram: komenda z obcego czatu - ignoruję', { chatId: msg.chat?.id });
    return;
  }
  const command = parseCommand(msg.text);
  if (!command) return;
  log.info(`Telegram: komenda ${msg.text.split(/\s+/)[0]}`);
  let reply;
  try {
    reply = respond(command, msg.text.trim().split(/\s+/).slice(1).join(' '));
  } catch (e) {
    reply = `Błąd: ${String(e).slice(0, 200)}`;
  }
  await sendViaTelegram(reply);
}

let running = false;

// Startuje petle w tle (nie czeka). Bez konfiguracji Telegrama nic nie robi.
function startTelegramCommands() {
  const { token, chatId } = getTelegramConfig();
  if (!token || !chatId || running) return false;
  running = true;

  (async () => {
    let offset = 0;
    // Komendy wyslane, gdy bot nie dzialal, pomijamy - stare /pauza nie
    // powinno zatrzymac bota po restarcie.
    try {
      const pending = await getUpdates(token, -1, 0);
      if (pending.length) offset = pending[pending.length - 1].update_id + 1;
    } catch (e) {
      log.warn('Telegram: nie udało się pobrać zaległych komend', { error: String(e) });
    }
    log.info('Telegram: nasłuchuję komend (/pomoc).');

    let conflictLogged = false;
    while (running) {
      try {
        const updates = await getUpdates(token, offset, POLL_TIMEOUT_S);
        conflictLogged = false;
        for (const u of updates) {
          offset = u.update_id + 1;
          await handleUpdate(u, chatId);
        }
      } catch (e) {
        if (e.status === 409) {
          if (!conflictLogged) log.warn('Telegram: komendy odbiera inny proces z tym samym tokenem (409).');
          conflictLogged = true;
          await sleep(60000);
        } else {
          await sleep(10000);
        }
      }
    }
  })();
  return true;
}

function stopTelegramCommands() { running = false; }

module.exports = { startTelegramCommands, stopTelegramCommands, respond };
