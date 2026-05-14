const { logger } = require('../utils/logger');

const log = logger.child({ module: 'stats' });

async function CheckPA(page) {
  const paText = await page
    .locator('div.progress-bar-info span', { hasText: /PA/i })
    .first()
    .innerText();
  const [currentStr, maxStr] = paText.replace(/PA/i, '').trim().split('/');
  const currentPA = parseInt(currentStr, 10);
  const maxPA = parseInt(maxStr, 10);
  log.info(`PA ${currentPA}/${maxPA}`);
  return { currentPA: currentPA, maxPA: maxPA };
}

module.exports = {
  CheckPA
};
