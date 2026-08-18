const { logger } = require('../utils/logger');

const log = logger.child({ module: 'health' });

async function CheckHP(page) {
  const hpText = await page.$$('div.well.well-stan');
  const elementHP = await hpText[4].innerText();
  const currentStr = await elementHP.replace('%', '');
  const currentHP = parseFloat(currentStr, 10);
  const maxHP = 100;
  log.info(`HP ${currentHP}%/${maxHP}%`);

  const repel = await CheckRepel(page);
  return { currentHP: currentHP, maxHP: maxHP, repel };
}

// Pole licznika rozpoznajemy po tooltipie — to jedyny pewny znacznik,
// bo sam format (liczba) mają też pieniądze, punkty czy jagody.
const REPEL_SELECTOR =
  'div.well.well-stan[data-original-title*="Tepela"], ' +
  'div.well.well-stan[title*="Tepela"]';

// Nazwy poziomów wg obrazka: tepel1.png = Tepel, tepel2.png = Super Tepel itd.
const REPEL_TIER_NAMES = { 1: '', 2: 'Super ', 3: 'MAX ' };

// Odczyt licznika Tepela/Repela. Pole istnieje tylko gdy Tepel/Repel
// jest aktywny — jego brak oznacza, że nic nie działa (zwracamy null).
// Zwraca { value, kind, tier, label } albo null.
async function CheckRepel(page) {
  try {
    const el = page.locator(REPEL_SELECTOR).first();
    if (await el.count() === 0) {
      log.debug('Tepel/Repel: brak licznika - nieaktywny.');
      return null;
    }

    const text = (await el.innerText()).trim();
    const match = text.match(/\d[\d\s.,]*/);
    if (!match) {
      log.debug(`Tepel/Repel: nie udało się sparsować "${text}".`);
      return null;
    }

    const value = parseInt(match[0].replace(/[\s.,]/g, ''), 10);
    if (Number.isNaN(value)) return null;

    // Rodzaj i poziom rozpoznajemy po nazwie obrazka, np. images/tmp/repel3.png
    const src = await el.locator('img').first().getAttribute('src').catch(() => '') || '';
    const imgMatch = src.match(/(tepel|repel)(\d)?/i);
    const kind = imgMatch ? imgMatch[1].toLowerCase() : null;
    const tier = imgMatch && imgMatch[2] ? parseInt(imgMatch[2], 10) : null;

    const label = kind
      ? `${REPEL_TIER_NAMES[tier] ?? ''}${kind === 'tepel' ? 'Tepel' : 'Repel'}`
      : 'Tepel/Repel';

    log.info(`${label}: pozostało ${value}.`);
    return { value, kind, tier, label };
  } catch (e) {
    log.debug('Tepel/Repel: nie udało się odczytać', { error: String(e) });
    return null;
  }
}

async function ClickHospital(page) {
  await page.getByRole('img', { name: 'Przejdź do Centrum Pokemon' }).click();
  log.info("Udano się do Centrum Pokemon");
  await page.locator('button', { hasText: 'Uzupełnij za' }).click();
  log.info("HP zostało uzupełnione do 100%");
  const hpResult = await CheckHP(page);
  return hpResult;
}

async function EatRawstBerry(page) {
  await page.getByRole('img', { name: 'Zjedz Jagody Rawst' }).click();
  log.info("Użyto Jagód Rawst");
}

module.exports = {
  CheckHP,
  CheckRepel,
  ClickHospital,
  EatRawstBerry
};
