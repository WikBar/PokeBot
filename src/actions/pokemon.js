const { SELL_THRESHOLD, MAX_SELL_CLICK, CLICK_DELAY } = require('./constants');

async function SellPokemon(page, pokemonToSell) {
  if (!Array.isArray(pokemonToSell) || pokemonToSell.length === 0) {
    console.log("Brak listy pokemonów do sprzedaży.");
    return;
  }
  await page.getByRole('img', { name: 'Sprzedaj Pokemony z Przechowalni' }).click();
  console.log("Jesteś w Hodowli Pokemonów");
  await page.waitForSelector('label.btn-hodowla', { timeout: 10000 });

  const buttons = page.locator('label.btn-hodowla');
  const total = await buttons.count();
  if (total === 0) return;

  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const texts = await buttons.allInnerTexts();
  const matchedIndexes = [];
  const seenTypes = new Set();

  for (let i = 0; i < texts.length; i++) {
    const matchedName = pokemonToSell.find(name => new RegExp(escapeRegExp(name)).test(texts[i]));
    if (matchedName) {
      if (seenTypes.has(matchedName)) {
        matchedIndexes.push(i);
      } else {
        seenTypes.add(matchedName);
        console.log(`Zachowuję jednego: ${matchedName}`);
      }
    }
  }

  console.log(`Dopasowane do sprzedaży: ${matchedIndexes.length} (zachowano po 1 z każdego typu)`);

  if (matchedIndexes.length > SELL_THRESHOLD) {
    let clicked = 0;
    for (const index of matchedIndexes) {
      await buttons.nth(index).click();
      clicked++;
      await page.waitForTimeout(CLICK_DELAY);
      if (clicked >= MAX_SELL_CLICK) {
        break;
      }
    }
    console.log("Pokemony zaznaczone do sprzedaży");
    await page.click('text=Sprzedaj Zaznaczone');
    console.log("✅ Kliknięto przycisk 'Sprzedaj Zaznaczone");
    await page.click('text=Potwierdź');
    console.log("✅ Kliknięto przycisk 'Potwierdź' sprzedaż Pokemonów, sprzedano Pokemony.");
    await page.waitForTimeout(2000);
    await page.reload();
  } else {
    console.log("Za mało pokemonów do sprzedaży – pomijam");
    await page.reload();
    return;
  }
}

module.exports = {
  SellPokemon
};
