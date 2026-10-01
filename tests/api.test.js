const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/server');

const ROOT = path.join(__dirname, '..');
const KEY = 'test-key';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokebot-api-'));
  const paths = {
    config: path.join(dir, 'config.json'),
    locations: path.join(dir, 'locations.json'),
    team: path.join(dir, 'team.json'),
    daily: path.join(dir, 'daily-state.json'),
  };
  fs.copyFileSync(path.join(ROOT, 'config', 'locations.json'), paths.locations);
  fs.writeFileSync(paths.team, JSON.stringify({ team: [] }));
  fs.writeFileSync(paths.config, JSON.stringify({
    region: 'Johto', adventureNr: 4, pokemonIndex: 3, SecondPokemonIndex: 2,
    sellablePokemon: ['Zubat'], protectedPokemon: [],
  }));
  return new Promise((resolve) => {
    const server = createApp({ paths, apiKey: KEY }).listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      const call = (method, url, body, key = KEY) => fetch(base + url, {
        method,
        headers: { 'Content-Type': 'application/json', ...(key ? { 'x-api-key': key } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      resolve({
        call, paths,
        close: () => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); },
      });
    });
  });
}

test('API: bez klucza 401', async () => {
  const s = await setup();
  try {
    assert.equal((await s.call('GET', '/api/status', undefined, null)).status, 401);
    assert.equal((await s.call('GET', '/api/status')).status, 200);
  } finally { s.close(); }
});

test('API: POST /api/config waliduje i zapisuje', async () => {
  const s = await setup();
  try {
    let res = await s.call('POST', '/api/config', { adventureNr: 99 });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /adventureNr 99/);
    assert.equal(JSON.parse(fs.readFileSync(s.paths.config, 'utf8')).adventureNr, 4);

    res = await s.call('POST', '/api/config', { adventureNr: 2, secondPokMaxLv: 80 });
    assert.equal(res.status, 200);
    const saved = JSON.parse(fs.readFileSync(s.paths.config, 'utf8'));
    assert.equal(saved.adventureNr, 2);
    assert.equal(saved.secondPokMaxLv, 80);
    assert.deepEqual(saved.sellablePokemon, ['Zubat']);   // reszta zachowana
  } finally { s.close(); }
});

test('API: nieznany klucz i zle body - 400', async () => {
  const s = await setup();
  try {
    assert.equal((await s.call('POST', '/api/config', { hack: 1 })).status, 400);
    assert.equal((await s.call('POST', '/api/config', [1, 2])).status, 400);
  } finally { s.close(); }
});

test('API: nieczytelny config - 500 zamiast nadpisania samym patchem (regresja)', async () => {
  const s = await setup();
  try {
    fs.writeFileSync(s.paths.config, Buffer.alloc(50));
    const res = await s.call('POST', '/api/config', { adventureNr: 2 });
    assert.equal(res.status, 500);
    assert.equal(fs.readFileSync(s.paths.config).every((b) => b === 0), true);
  } finally { s.close(); }
});

test('API: /api/control - nieznana akcja 400, pauza dziala', async () => {
  const s = await setup();
  try {
    assert.equal((await s.call('POST', '/api/control', { action: 'boom' })).status, 400);
    const res = await s.call('POST', '/api/control', { action: 'pause' });
    assert.equal((await res.json()).isPaused, true);
    await s.call('POST', '/api/control', { action: 'resume' });
  } finally { s.close(); }
});
