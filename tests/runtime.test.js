const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveRuntime } = require('../src/logic/runtime');
const { loadRuntime, saveRuntime } = require('../src/utils/runtimeStore');

const region = { 1: { name: 'A' }, 2: { name: 'B' }, 3: { name: 'C' } };
const cfg = { region: 'Johto', adventureNr: 1 };

test('brak stanu - start od lokacji z configu', () => {
  const r = resolveRuntime(cfg, null, region);
  assert.equal(r.status, 'new');
  assert.equal(r.runtime.adventureNr, 1);
  assert.equal(r.runtime.baseAdventureNr, 1);
});

test('rotacja zachowana, gdy config sie nie zmienil (np. zapis panelu ze stara wartoscia)', () => {
  const saved = { region: 'Johto', baseAdventureNr: 1, adventureNr: 3, shiny: { tries: 4, hold: 60, locationNr: 3 } };
  const r = resolveRuntime(cfg, saved, region);
  assert.equal(r.status, 'kept');
  assert.equal(r.runtime.adventureNr, 3);
  assert.equal(r.runtime.shiny.hold, 60);
});

test('zmiana lokacji albo regionu w configu - reset', () => {
  const saved = { region: 'Johto', baseAdventureNr: 1, adventureNr: 3, shiny: { hold: 60 } };
  assert.equal(resolveRuntime({ ...cfg, adventureNr: 2 }, saved, region).status, 'reset');
  const r = resolveRuntime({ region: 'Kanto', adventureNr: 1 }, saved, region);
  assert.equal(r.status, 'reset');
  assert.equal(r.runtime.shiny, null);
});

test('zapisana lokacja nie istnieje - start od configu', () => {
  const saved = { region: 'Johto', baseAdventureNr: 1, adventureNr: 9 };
  assert.equal(resolveRuntime(cfg, saved, region).status, 'invalid');
});

test('runtimeStore: zapis i odczyt, uszkodzony plik = brak stanu', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokebot-rt-'));
  try {
    const file = path.join(dir, 'runtime-state.json');
    assert.equal(loadRuntime(file), null);
    await saveRuntime({ region: 'Johto', adventureNr: 2 }, file);
    const rt = loadRuntime(file);
    assert.equal(rt.adventureNr, 2);
    assert.ok(rt.updatedAt);
    fs.writeFileSync(file, Buffer.alloc(32));
    assert.equal(loadRuntime(file), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
