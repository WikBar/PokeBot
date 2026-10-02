const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');
const { ScanMarket } = require('../src/actions/market');

// Atrapa gry: menu "Targ", katalog z zakladkami jak na prawdziwej stronie
// i strona ofert. Skrypt gry laduje href przycisku btn-akcja - tu robimy to
// prostym przekierowaniem.
const MENU = `
  <a class="dropdown-toggle" href="#">Targ</a>
  <ul class="dropdown-menu"><li><a href="/targ">Kup - Przedmioty</a></li></ul>`;
const CATALOG = fs.readFileSync(path.join(__dirname, 'fixtures', 'market-catalog.html'), 'utf8');
const SCRIPT = `<script>
  document.addEventListener('click', (e) => {
    const t = e.target.closest('a[href^="#targ_kupprz-"]');
    if (t) {
      e.preventDefault();
      document.querySelectorAll('.tab-pane').forEach((p) => { p.style.display = 'none'; });
      document.querySelector(t.getAttribute('href')).style.display = 'block';
    }
    const b = e.target.closest('button.btn-akcja');
    if (b) location.href = '/' + b.getAttribute('href');
  });
</script><style>.tab-pane{display:none}.tab-pane.active{display:block}</style>`;
const PAGES = {
  '/index.php': `<html><body>${MENU}<div id="timer">Pomagasz w PokeCentrum 00:30:00</div></body></html>`,
  '/targ': `<html><body>${MENU}${CATALOG}${SCRIPT}</body></html>`,
  '/targ_prz.php': `<html><body>${MENU}<table id="oferty"><tr><td>Ultraballe</td><td>123</td></tr></table></body></html>`,
};

test('ScanMarket: katalog, oferty obserwowanych przedmiotow, glowna karta nietknieta', async () => {
  const server = http.createServer((req, res) => {
    const page = PAGES[req.url.split('?')[0]];
    res.writeHead(page ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page || 'brak');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokebot-market-'));
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const main = await context.newPage();
    await main.goto(`${base}/index.php`);

    const result = await ScanMarket(context, {
      url: `${base}/index.php`,
      snapshotDir: dir,
      catalogPath: path.join(dir, 'catalog.json'),
      watch: ['ultraballe', 'rawst_berry', 'nie_ma_takiego'],
    });
    assert.equal(result.ok, true);
    assert.equal(result.catalog, 103);
    assert.deepEqual(result.results.map((r) => [r.item, r.offers]), [['rawst_berry', null], ['ultraballe', null]]);

    // Glowna karta dalej na stronie z timerem opieki, karta targu zamknieta.
    assert.equal(await main.locator('#timer').count(), 1);
    assert.equal(context.pages().length, 1);

    const files = fs.readdirSync(dir).sort();
    assert.ok(files.includes('catalog.json'));
    const ultra = files.find((f) => f.startsWith('oferty-ultraballe-'));
    assert.match(fs.readFileSync(path.join(dir, ultra), 'utf8'), /<td>123<\/td>/);
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ScanMarket: blad strony nie rzuca wyjatku', async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const r = await ScanMarket(context, { url: 'http://127.0.0.1:1/nie-ma', snapshotDir: os.tmpdir() });
    assert.equal(r.ok, false);
    assert.equal(context.pages().length, 0);
  } finally {
    await browser.close();
  }
});
