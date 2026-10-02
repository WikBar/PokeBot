const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');
const { ScanMarket } = require('../src/actions/market');

// Atrapa gry: menu "Targ" jak na prawdziwej stronie i podstrona targu.
const MENU = `
  <a class="dropdown-toggle" href="#">Targ</a>
  <ul class="dropdown-menu"><li><a href="/targ">Kup - Przedmioty</a></li></ul>`;
const PAGES = {
  '/index.php': `<html><body>${MENU}<div id="timer">Pomagasz w PokeCentrum 00:30:00</div></body></html>`,
  '/targ': `<html><body>${MENU}<table id="oferty"><tr><td>Ultraballe</td><td>100</td></tr></table></body></html>`,
};

test('ScanMarket: osobna karta, glowna strona nietknieta, zrzut zapisany, karta zamknieta', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(PAGES[req.url] ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGES[req.url] || 'brak');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokebot-market-'));
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const main = await context.newPage();
    await main.goto(`${base}/index.php`);

    const result = await ScanMarket(context, { url: `${base}/index.php`, snapshotDir: dir });
    assert.equal(result.ok, true);
    assert.equal(result.offers, null);   // parser jeszcze nie gotowy

    // Glowna karta dalej na stronie z timerem opieki.
    assert.equal(await main.locator('#timer').count(), 1);
    assert.equal(context.pages().length, 1);

    const files = fs.readdirSync(dir);
    assert.equal(files.length, 1);
    assert.match(fs.readFileSync(path.join(dir, files[0]), 'utf8'), /Ultraballe/);
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
