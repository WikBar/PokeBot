// Diagnostyka odczytu plecaka: loguje sie, otwiera plecak i wypisuje,
// co udalo sie sparsowac, z podzialem na zakladki oraz lista przedmiotow
// ponizej progu. Nie klika zadnego przedmiotu (nic nie zuzywa).
//
//   node scripts/backpack-check.js          # zapisuje equipment.json
//   node scripts/backpack-check.js --dry     # tylko podglad, bez zapisu
require('dotenv').config();
const { chromium } = require('playwright');
const { login } = require('../src/actions/auth');
const { navigateViaMenu } = require('../src/dailyActions');
const {
  parseItemLabel, repelStock, thresholdFor,
  loadEquipment, UpdateEquipment, BACKPACK, REPEL_ITEM_NAMES,
} = require('../src/actions/equipment');

const DRY = process.argv.includes('--dry');

(async () => {
  const headless = String(process.env.HEADLESS || '').toLowerCase() === 'true';
  const browser = await chromium.launch({ headless });
  const page = await (await browser.newContext()).newPage();

  try {
    const ok = await login(page, {
      login: process.env.POKE1_LOGIN,
      password: process.env.POKE_PASSWORD,
    });
    if (!ok) throw new Error('Logowanie nieudane');

    await navigateViaMenu(page, 'Postać', 'Plecak');
    await page.waitForTimeout(2000);

    // 1. Czy w ogole trafiamy w kafelki?
    const tiles = page.locator(BACKPACK.item);
    const tileCount = await tiles.count().catch(() => 0);
    console.log(`\nSelektor kafelek: ${BACKPACK.item}`);
    console.log(`Znaleziono kafelek na starcie: ${tileCount}`);

    if (tileCount === 0) {
      console.log('\n!! Selektor nie trafia. Podglad struktury strony:');
      const html = await page.locator('.panel-body, .tab-content').first().innerHTML().catch(() => '');
      console.log(html.slice(0, 1500) || '(brak .panel-body / .tab-content)');
    } else {
      console.log('\nPrzyklady surowych podpisow:');
      for (let i = 0; i < Math.min(4, tileCount); i++) {
        const raw = (await tiles.nth(i).innerText().catch(() => '')).replace(/\n/g, ' | ');
        console.log(`  [${i}] "${raw}"  ->  ${JSON.stringify(parseItemLabel(raw))}`);
      }
    }

    // 2. Pelny odczyt przez wlasciwa funkcje bota (bez klikania w zakladki -
    //    wszystkie panele sa w DOM od razu).
    const { thresholds } = await loadEquipment();
    let items;
    if (DRY) {
      const { readBackpackItems } = require('../src/actions/equipment');
      items = await readBackpackItems(page);
    } else {
      const res = await UpdateEquipment(page);
      items = res && res.items;
    }

    if (!items) {
      console.log('\n!! Nie odczytano zadnych przedmiotow.');
    } else {
      const { flattenItems } = require('../src/actions/equipment');
      const flat = flattenItems(items);
      console.log(`\n=== Zakladki (${Object.keys(items).length}) ===`);
      for (const [tab, group] of Object.entries(items)) {
        console.log(`  ${tab.padEnd(16)} ${String(Object.keys(group).length).padStart(3)} pozycji`);
      }
      console.log(`\nRazem unikalnych: ${Object.keys(flat).length}`);

      console.log('\n=== Ponizej progu ===');
      let n = 0;
      for (const [name, value] of Object.entries(flat)) {
        const limit = thresholdFor(thresholds, name);
        if (value <= limit) { console.log(`  ${name} = ${value} (prog ${limit})`); n++; }
      }
      if (!n) console.log('  (zadne)');

      console.log('\n=== Tepele / Repele ===');
      const stock = repelStock(items);
      for (const [key, label] of Object.entries(REPEL_ITEM_NAMES)) {
        const c = stock[key];
        console.log(`  ${label.padEnd(12)} ${String(c).padStart(4)}  ${c > 0 ? 'dostepny' : 'BRAK'}`);
      }
    }
    console.log(DRY ? '\n(--dry: equipment.json nie zapisany)' : '\nequipment.json zaktualizowany.');
  } catch (e) {
    console.error('\nBlad:', e.message);
  } finally {
    await browser.close();
  }
})();
