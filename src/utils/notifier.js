const { logger } = require('./logger');

const log = logger.child({ module: 'notifier' });

// Wysyłka powiadomień o Golden Nest. Obsługiwane są trzy warianty — wybierany
// jest ten, który ma komplet danych w .env (kolejność priorytetów jak niżej).
// Używamy zwykłego fetch (Node 18+), więc nie ma dodatkowych zależności.
//
// WARIANT 1 — Telegram (darmowy, bez limitów, najszybszy) — DOMYŚLNY:
//   TELEGRAM_BOT_TOKEN - token od @BotFather, np. 1234567890:AAH...
//   TELEGRAM_CHAT_ID   - Twoje ID czatu (można wykryć: npm run telegram:chatid)
//   Konfiguracja (jednorazowo):
//     1. Napisz do @BotFather komendę /newbot i podaj nazwę bota
//     2. Skopiuj otrzymany token do TELEGRAM_BOT_TOKEN
//     3. Napisz cokolwiek do swojego bota (np. /start) — inaczej nie może odpisać
//     4. Uruchom: npm run telegram:chatid — wpisze CHAT_ID do konsoli
//
// WARIANT 2 — CallMeBot WhatsApp (darmowy, ale wolny i bywa przeciążony):
//   CALLMEBOT_PHONE, CALLMEBOT_APIKEY
//
// WARIANT 3 — Twilio WhatsApp (płatny po okresie próbnym):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
//   TWILIO_WHATSAPP_FROM, TWILIO_WHATSAPP_TO

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const CALLMEBOT_API_URL = 'https://api.callmebot.com/whatsapp.php';
const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

// Twilio wymaga prefiksu "whatsapp:" — dokładamy go, jeśli w .env go brakuje.
function normalizeWhatsAppNumber(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed.startsWith('whatsapp:') ? trimmed : `whatsapp:${trimmed}`;
}

// CallMeBot oczekuje numeru bez prefiksu "whatsapp:", za to z kierunkowym.
function normalizePlainNumber(value) {
  return String(value || '').trim().replace(/^whatsapp:/, '').replace(/[\s-]/g, '');
}

function getTelegramConfig() {
  return {
    token: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),
    chatId: (process.env.TELEGRAM_CHAT_ID || '').trim(),
  };
}

function getCallMeBotConfig() {
  return {
    phone: normalizePlainNumber(process.env.CALLMEBOT_PHONE),
    apikey: (process.env.CALLMEBOT_APIKEY || '').trim(),
  };
}

function getTwilioConfig() {
  return {
    accountSid: (process.env.TWILIO_ACCOUNT_SID || '').trim(),
    authToken: (process.env.TWILIO_AUTH_TOKEN || '').trim(),
    from: normalizeWhatsAppNumber(process.env.TWILIO_WHATSAPP_FROM),
    to: normalizeWhatsAppNumber(process.env.TWILIO_WHATSAPP_TO),
  };
}

// Zwraca 'telegram' | 'callmebot' | 'twilio' | null.
function getProvider() {
  const tg = getTelegramConfig();
  if (tg.token && tg.chatId) return 'telegram';

  const cmb = getCallMeBotConfig();
  if (cmb.phone && cmb.apikey) return 'callmebot';

  const tw = getTwilioConfig();
  if (tw.accountSid && tw.authToken && tw.from && tw.to) return 'twilio';

  return null;
}

function isNotifierConfigured() {
  return getProvider() !== null;
}

async function sendViaTelegram(message) {
  const { token, chatId } = getTelegramConfig();

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.ok) {
    log.error('Telegram odrzucił wiadomość', {
      status: response.status,
      error: data.description || 'brak szczegółów',
    });
    return false;
  }

  log.info('Wysłano powiadomienie (Telegram)', { messageId: data.result?.message_id });
  return true;
}

async function sendViaCallMeBot(message) {
  const { phone, apikey } = getCallMeBotConfig();
  const url = `${CALLMEBOT_API_URL}?phone=${encodeURIComponent(phone)}` +
              `&text=${encodeURIComponent(message)}` +
              `&apikey=${encodeURIComponent(apikey)}`;

  const response = await fetch(url, { method: 'GET' });
  const detail = await response.text().catch(() => '');

  if (!response.ok) {
    log.error('CallMeBot odrzucił wiadomość WhatsApp', {
      status: response.status,
      detail: detail.slice(0, 400),
    });
    return false;
  }

  log.info('Wysłano powiadomienie (CallMeBot WhatsApp)');
  return true;
}

async function sendViaTwilio(message) {
  const { accountSid, authToken, from, to } = getTwilioConfig();
  const params = new URLSearchParams({ From: from, To: to, Body: message });
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  const response = await fetch(`${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    log.error('Twilio odrzuciło wiadomość WhatsApp', {
      status: response.status,
      detail: detail.slice(0, 400),
    });
    return false;
  }

  const data = await response.json().catch(() => ({}));
  log.info('Wysłano powiadomienie (Twilio WhatsApp)', { sid: data.sid, status: data.status });
  return true;
}

// Zwraca true przy udanej wysyłce. Nigdy nie rzuca wyjątkiem — powiadomienie
// nie może przerwać działania bota, więc błędy tylko logujemy.
async function sendNotification(body) {
  const message = String(body || '').trim();
  if (!message) {
    log.warn('Pusta treść wiadomości — pomijam wysyłkę.');
    return false;
  }

  const provider = getProvider();
  if (!provider) {
    log.warn('Brak konfiguracji powiadomień w .env (Telegram/CallMeBot/Twilio) — pomijam wysyłkę.');
    return false;
  }

  try {
    if (provider === 'telegram') return await sendViaTelegram(message);
    if (provider === 'callmebot') return await sendViaCallMeBot(message);
    return await sendViaTwilio(message);
  } catch (e) {
    log.error('Błąd wysyłki powiadomienia', { provider, error: String(e) });
    return false;
  }
}

// Buduje treść: "W regionie <region>, w lokacji <lokacja> spotkano Shiny pokemona <nazwa> i poziom <poziom>."
function buildGoldenNestMessage({ region, location, pokemon, level }) {
  const regionName = region || 'nieznanym';
  const locationName = location || 'nieznanej';
  const pokemonName = pokemon || 'nieznany';
  const levelText = level === undefined || level === null ? 'nieznany' : level;
  return `W regionie ${regionName}, w lokacji ${locationName} spotkano Shiny pokemona ${pokemonName} i poziom ${levelText}.`;
}

// Druga wiadomość: co się stało z napotkanym Golden Nestem.
// Wysyłana zawsze, także gdy do rzutu w ogóle nie doszło (przegrana walka).
function buildGoldenNestResultMessage({ pokemon, level, caught, reason }) {
  const pokemonName = pokemon || 'nieznany';
  const levelText = level === undefined || level === null ? 'nieznany' : level;
  if (caught) return `Shiny ${pokemonName} (poziom ${levelText}) ZŁAPANY!`;
  const why = reason ? ` (${reason})` : '';
  return `Shiny ${pokemonName} (poziom ${levelText}) NIE został złapany${why}.`;
}

// Postęp blokady po nieudanym Golden Nescie - wysyłany co N wypraw.
function buildShinyHoldMessage({ location, remaining }) {
  const locationName = location || 'nieznanej';
  return `Golden Nest: zostaję w lokacji ${locationName} jeszcze ${remaining} wypraw.`;
}

// Po złapaniu Golden Nesta - dokąd bot idzie dalej.
function buildShinyNextLocationMessage({ pokemon, nextLocation }) {
  const pokemonName = pokemon || 'nieznany';
  const nextName = nextLocation || 'nieznana';
  return `Shiny ${pokemonName} złapany - przechodzę do lokacji ${nextName}.`;
}

// Powiadomienie o Golden Nest (poziom >75).
async function notifyGoldenNest({ region, location, pokemon, level }) {
  return sendNotification(buildGoldenNestMessage({ region, location, pokemon, level }));
}

// Powiadomienie o wyniku - osobna wiadomość, żeby dotarła także przy przegranej.
async function notifyGoldenNestResult({ pokemon, level, caught, reason }) {
  return sendNotification(buildGoldenNestResultMessage({ pokemon, level, caught, reason }));
}

async function notifyShinyHold({ location, remaining }) {
  return sendNotification(buildShinyHoldMessage({ location, remaining }));
}

async function notifyShinyNextLocation({ pokemon, nextLocation }) {
  return sendNotification(buildShinyNextLocationMessage({ pokemon, nextLocation }));
}

module.exports = {
  sendNotification,
  buildGoldenNestMessage,
  buildGoldenNestResultMessage,
  buildShinyHoldMessage,
  buildShinyNextLocationMessage,
  notifyGoldenNest,
  notifyGoldenNestResult,
  notifyShinyHold,
  notifyShinyNextLocation,
  isNotifierConfigured,
  getProvider,
};
