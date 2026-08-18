const { logger } = require('../utils/logger');
const { sendNotification } = require('../utils/notifier');

const log = logger.child({ module: 'stats' });

// Alarmujemy, gdy do zapelnienia przechowalni zostalo tyle miejsc.
const STORAGE_ALERT_MARGIN = 50;

// Flaga w pamieci: powiadomienie wysylamy raz, przy przekroczeniu progu.
// Kasuje sie dopiero, gdy liczba pokemonow spadnie ponizej max-50.
let storageAlertSent = false;

// Powiadomienie o koncu miejsca w przechowalni.
// Wysylane raz po przekroczeniu progu (max - 50); flaga zdejmowana,
// gdy stan wroci ponizej progu - wtedy kolejne przekroczenie znow alarmuje.
async function checkStorageAlert(current, max) {
  // max <= marginesowi dalby prog <= 0, czyli alert przy pustej przechowalni.
  if (!Number.isFinite(current) || !Number.isFinite(max)) return;
  if (max <= STORAGE_ALERT_MARGIN) return;

  const threshold = max - STORAGE_ALERT_MARGIN;

  if (current >= threshold) {
    if (!storageAlertSent) {
      storageAlertSent = true;
      await sendNotification('Kończy się miejsce w magazynie, sprzedaj poki');
      log.warn(`Przechowalnia: ${current}/${max} (prog ${threshold}) - wysłano powiadomienie.`);
    }
    return;
  }

  if (storageAlertSent) {
    storageAlertSent = false;
    log.info(`Przechowalnia: ${current}/${max} - poniżej progu ${threshold}, flaga zresetowana.`);
  }
}

async function CheckPA(page) {
  const paBars = await page.locator('div.progress-bar span', { hasText: /PA/i }).all();
  
  
  function parseBar(text) {
    const [cur, max] = text.replace(/PA/i, '').trim().split('/');
    return { current: parseInt(cur, 10) || 0, max: parseInt(max, 10) || 0 };
  }

  const first = paBars[0] ? parseBar(await paBars[0].innerText()) : { current: 0, max: 0 };
  const second = paBars[1] ? parseBar(await paBars[1].innerText()) : { current: 0, max: 0 };
  const currentPA = first.current + second.current;
  const maxPA = first.max + second.max;

  if (second.max > 0) {
    log.info(`PA ${first.current}/${first.max} + second PA ${second.current}/${second.max} = ${currentPA}/${maxPA}`);
  } else {
    log.info(`PA ${currentPA}/${maxPA}`);
  }

  return { currentPA, maxPA };
}

async function CheckStorage(page) {
  try {
    const storageEl = page.locator('div.well.well-stan', { hasText: /\d+\s*\/\s*\d+/ });
    const count = await storageEl.count();
    if (count === 0) {
      log.info('Przechowalnia: element nie znaleziony na stronie');
      return { current: 0, max: 0 };
    }
    const text = await storageEl.first().innerText();
    const match = text.trim().match(/(\d+)\s*\/\s*(\d+)/);
    if (!match) {
      log.info('Przechowalnia: nie udało się sparsować liczby');
      return { current: 0, max: 0 };
    }
    const current = parseInt(match[1], 10);
    const max = parseInt(match[2], 10);
    log.info(`Przechowalnia: ${current}/${max}`);
    await checkStorageAlert(current, max);
    return { current, max };
  } catch (e) {
    log.info('Nie udało się odczytać przechowalni', { error: String(e) });
    return { current: 0, max: 0 };
  }
}

module.exports = {
  CheckPA,
  CheckStorage,
  checkStorageAlert,
  STORAGE_ALERT_MARGIN,
  // tylko do testow - podglad/reset flagi powiadomienia
  _resetStorageAlert: () => { storageAlertSent = false; },
  _isStorageAlertSent: () => storageAlertSent,
};
