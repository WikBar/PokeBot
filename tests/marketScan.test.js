const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');
const { ScanMarket } = require('../src/actions/market');

// Atrapa gry: menu "Targ", katalog (wycinek prawdziwej strony) i strona
// ofert pod gra/targ_prz.php: strona przedmiotu doladowuje oferty osobnym
// zadaniem (?oferty_strona&...&strona=N) - jak w prawdziwej grze.
const fixture = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');
const MENU = `
  <a class="dropdown-toggle" href="#">Targ</a>
  <ul class="dropdown-menu"><li><a href="/targ">Kup - Przedmioty</a></li></ul>`;
const PAGES = {
  '/index.php': `<html><body>${MENU}<div id="timer">Pomagasz w PokeCentrum 00:30:00</div></body></html>`,
  '/targ': `<html><body>${MENU}${fixture('market-catalog.html')}</body></html>`,
  // Strona przedmiotu (skrypt doladowujacy oferty) i strona ofert.
  '/gra/targ_prz.php': fixture('market-item-rawst.html'),
  oferty: fixture('market-offers-rawst-raw.html'),
};

test('ScanMarket: katalog, oferty przez fetch, historia, podsumowanie; glowna karta nietknieta', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    const page = req.url.includes('oferty_strona') ? PAGES.oferty : PAGES[req.url.split('?')[0]];
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

    const opts = {
      url: `${base}/index.php`,
      snapshotDir: dir,
      catalogPath: path.join(dir, 'catalog.json'),
      historyPath: path.join(dir, 'history.jsonl'),
      summaryPath: path.join(dir, 'summary.json'),
      watch: ['rawst_berry', 'nie_ma_takiego'],
      scanAll: false,
      delayMs: 0,
      notify: false,
      pokemon: false,
    };
    const result = await ScanMarket(context, opts);
    assert.equal(result.ok, true);
    assert.equal(result.catalog, 103);
    assert.ok(requests.some((u) => u.startsWith('/gra/targ_prz.php?szukaj&przedmiot=rawst_berry&zakladka=0')));
    assert.ok(requests.some((u) => u.startsWith('/gra/targ_prz.php?oferty_strona&&przedmiot=rawst_berry') && u.endsWith('strona=1')));

    const rawst = result.summary.items.find((i) => i.code === 'rawst_berry');
    assert.equal(rawst.name, 'Rawst Jagody');
    assert.equal(rawst.offers, 16);
    assert.equal(rawst.lowest, 30000);
    assert.equal(rawst.watched, true);
    assert.equal(rawst.scans, 1);

    // Historia: jedno podsumowanie na przedmiot i odczyt.
    const again = await ScanMarket(context, opts);
    assert.equal(again.summary.items[0].scans, 2);
    const lines = fs.readFileSync(opts.historyPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.deepEqual(Object.keys(lines[0]).sort(), ['item', 'low', 'median', 'n', 'supply', 'ts']);
    assert.equal(lines[0].low, 30000);
    assert.equal(lines[0].n, 10);   // 10 ofert w ¥, 6 tylko za zaslugi

    // Przeglad calego katalogu: wszystkie 103 przedmioty, obserwowane
    // najpierw, pozostale po 1 stronie ofert.
    requests.length = 0;
    const all = await ScanMarket(context, { ...opts, scanAll: true });
    assert.equal(all.summary.items.length, 103);
    assert.equal(all.summary.items[0].code, 'rawst_berry');
    assert.equal(requests.filter((u) => u.includes('oferty_strona')).length, 103);

    // Glowna karta dalej na stronie z timerem opieki, karta targu zamknieta.
    assert.equal(await main.locator('#timer').count(), 1);
    assert.equal(context.pages().length, 1);
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
    const r = await ScanMarket(context, { url: 'http://127.0.0.1:1/nie-ma', snapshotDir: os.tmpdir(), notify: false });
    assert.equal(r.ok, false);
    assert.equal(context.pages().length, 0);
  } finally {
    await browser.close();
  }
});
