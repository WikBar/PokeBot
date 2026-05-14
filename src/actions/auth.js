const { logger } = require('../utils/logger');

const log = logger.child({ module: 'auth' });

const LOGIN_URL = 'https://gra.pokelife.pl/index.php';
const MAX_RETRIES = 3;

async function login(page, { login: loginName, password }) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await page.goto(LOGIN_URL);
      await page.fill('input[name="login"]', loginName);
      await page.fill('input[name="haslo"]', password);
      await Promise.all([
        page.click('button[type="submit"]'),
        page.waitForLoadState('networkidle'),
      ]);

      const count = await page.locator('button#wyloguj').count();
      if (count > 0) {
        log.info(`Zalogowano pomyślnie ${loginName} za ${attempt} próbą`);
        return true;
      }
      log.warn('Próba logowania nieudana', { attempt, maxRetries: MAX_RETRIES });
      if (attempt < MAX_RETRIES) {
        await page.waitForTimeout(2000);
        await page.reload();
      }
    } catch (error) {
      log.error('Błąd podczas logowania', { attempt, error: String(error) });
    }
  }
  log.error('Logowanie nieudane po wszystkich próbach', { login: loginName });
  return false;
}

async function isSessionAlive(page) {
  try {
    const count = await page.locator('button#wyloguj').count();
    return count > 0;
  } catch {
    return false;
  }
}

module.exports = { login, isSessionAlive };
