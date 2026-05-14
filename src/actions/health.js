const { logger } = require('../utils/logger');

const log = logger.child({ module: 'health' });

async function CheckHP(page) {
  const hpText = await page.$$('div.well.well-stan');
  const elementHP = await hpText[4].innerText();
  const currentStr = await elementHP.replace('%', '');
  const currentHP = parseFloat(currentStr, 10);
  const maxHP = 100;
  log.info(`HP ${currentHP}%/${maxHP}%`);
  return { currentHP: currentHP, maxHP: maxHP };
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
  ClickHospital,
  EatRawstBerry
};
