const { logger } = require('../utils/logger');

const log = logger.child({ module: 'stats' });

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
    return { current, max };
  } catch (e) {
    log.info('Nie udało się odczytać przechowalni', { error: String(e) });
    return { current: 0, max: 0 };
  }
}

module.exports = {
  CheckPA,
  CheckStorage
};
