async function ClickContinue(page) {
  await page.click('button:has-text("Kontynuuj")');
  console.log("✅ Kliknięto przycisk 'Kontynuuj'");
}

async function ClickButtonToActivity(page) {
  await page.click('text=Przejdź do Aktywności');
  console.log("✅ Kliknięto przycisk 'Przejdź do aktywności'");
}

async function ClickCancelActivity(page) {
  await page.click('text=Zakończ');
  console.log("✅ Kliknięto przycisk 'Zakończono aktywność'");
}

async function CancelActivity(page) {
  const InfoPanels = await page.$$(`div.alert.alert-info.text-center`);
  for (const panel of InfoPanels) {
    const alertText = await page.evaluate(element => element.textContent, panel);

    if (alertText.includes("Jesteś w trakcie")) {
      console.log("Jesteś podczas aktywności którą trzeba anulować");
      await ClickButtonToActivity(page);
      await page.waitForTimeout(2000);
      await ClickCancelActivity(page);
      console.log("Aktywnosć została pomyślnie anulowana.");
      return true;
    }
  }
}

async function StartActivity(page) {
  await page.click('a.dropdown-toggle');
  await page.click('ul.dropdown-menu >> text=Aktywność');
  console.log("🤸🏼Kliknięto zakładkę aktywności");
  await page.waitForTimeout(1000);
  await page.hover('button:has-text("Pracuj")');
  await page.click('a[href="#aktywnosc-trening"]');
  await page.click('button:has-text("Trenuj")');
  await page.click('button:has-text("Wybierz")');
  console.log(" 💼🛠️ Rozpoczęto aktywność oraz oczekiwanie 2 godziny");
}

module.exports = {
  ClickContinue,
  ClickButtonToActivity,
  ClickCancelActivity,
  CancelActivity,
  StartActivity
};
