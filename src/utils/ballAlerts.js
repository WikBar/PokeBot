const { sendNotification } = require('./notifier');
const { logger } = require('./logger');

const log = logger.child({ module: 'ballAlerts' });

// Kula, ktorej nie bylo na ekranie lapania = skonczyla sie w plecaku.
// Plecak odczytujemy tylko raz na cykl PA, wiec to najszybszy sygnal.
// Jeden alarm na rodzaj kuli dziennie, zeby nie spamowac co wyprawe.
const sent = new Map();   // label -> 'YYYY-MM-DD'

function dayKey(now = new Date()) {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

async function reportMissingBall(label, now = new Date()) {
  const day = dayKey(now);
  if (sent.get(label) === day) return false;
  sent.set(label, day);
  log.warn(`Brak kuli na ekranie łapania: ${label}`);
  await sendNotification(`PokeBot: skończyły się ${label} (nie było ich na ekranie łapania) - dokup.`);
  return true;
}

function _reset() { sent.clear(); }

module.exports = { reportMissingBall, _reset };
