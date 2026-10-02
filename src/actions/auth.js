const { logger } = require('../utils/logger');

const log = logger.child({ module: 'auth' });

const LOGIN_URL = 'https://gra.pokelife.pl/index.php';
const MAX_RETRIES = 3;

async function login(page, { login: loginName, password }) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await page.goto(LOGIN_URL);
      // Strona logowania ma dwa formularze login/haslo (jeden ukryty) -
      // wypelniamy tylko widoczny, inaczej fill czeka 30 s na ukryte pole.
      const form = page.locator('form:has(input[name="haslo"]:visible)').first();
      await form.locator('input[name="login"]').fill(loginName);
      await form.locator('input[name="haslo"]').fill(password);
      await Promise.all([
        form.locator('button[type="submit"], input[type="submit"]').first().click(),
        page.waitForLoadState('networkidle'),
      ]);

      const count = await page.locator('button#wyloguj').count();
      if (count > 0) {
        log.info(`Zalogowano pomyślnie ${loginName} za ${attempt} próbą`);
        return true;
      }
      // Komunikat gry (np. blokada po zbyt wielu logowaniach) - do diagnozy.
      const message = await page.locator('.alert:visible').first().innerText({ timeout: 2000 }).catch(() => '');
      log.warn('Próba logowania nieudana', { attempt, maxRetries: MAX_RETRIES, url: page.url(), message: message.trim().slice(0, 200) });
    } catch (error) {
      log.error('Błąd podczas logowania', { attempt, error: String(error) });
    }
    // Przerwa rosnie z kazda proba - szybkie ponawianie moglo pogarszac
    // blokade logowania.
    if (attempt < MAX_RETRIES) await page.waitForTimeout(attempt * 15000);
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
