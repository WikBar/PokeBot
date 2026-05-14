const { logger } = require('../utils/logger');

const log = logger.child({ module: 'activity' });

async function ClickContinue(page) {
  await page.click('button:has-text("Kontynuuj")');
  log.info("Kliknięto 'Kontynuuj'");
}

async function ClickButtonToActivity(page) {
  await page.click('text=Przejdź do Aktywności');
  log.info("Kliknięto 'Przejdź do aktywności'");
}

async function ClickCancelActivity(page) {
  await page.click('text=Zakończ');
  log.info("Kliknięto 'Zakończ'");
}

async function CancelActivity(page) {
  const InfoPanels = await page.$$(`div.alert.alert-info.text-center`);
  for (const panel of InfoPanels) {
    const alertText = await page.evaluate(element => element.textContent, panel);

    if (alertText.includes("Jesteś w trakcie")) {
      log.info("Aktywność wykryta - anuluję");
      await ClickButtonToActivity(page);
      try {
        await page.waitForLoadState('networkidle', { timeout: 5000 });
      } catch {
        // nawigacja może być szybka lub już zakończona
      }
      await ClickCancelActivity(page);
      log.info("Aktywność anulowana");
      return true;
    }
  }
  return false;
}

async function verifyActivityStarted(page) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
    const panels = await page.$$('div.alert.alert-info.text-center');
    for (const panel of panels) {
      const text = await page.evaluate(el => el.textContent, panel);
      if (text.includes("Jesteś w trakcie")) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

async function StartActivity(page) {
  await page.click('a.dropdown-toggle');
  await page.click('ul.dropdown-menu >> text=Aktywność');
  log.info("Kliknięto zakładkę aktywności");
  await page.waitForTimeout(1000);
  await page.hover('button:has-text("Pracuj")');
  await page.click('a[href="#aktywnosc-trening"]');
  await page.click('button:has-text("Trenuj")');
  await page.click('button:has-text("Wybierz")');
  log.info("Rozpoczęto aktywność (2h)");
}

module.exports = {
  ClickContinue,
  ClickButtonToActivity,
  ClickCancelActivity,
  CancelActivity,
  StartActivity,
  verifyActivityStarted
};
