const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateHealth, shouldNotify } = require('../src/logic/health');

const NOW = Date.parse('2026-10-01T12:00:00Z');
const minutesAgo = (m) => new Date(NOW - m * 60000).toISOString();

test('zdrowy bot', () => {
  const r = evaluateHealth({ pm2: { status: 'online', restarts: 2 }, status: { lastLogAt: minutesAgo(3) }, instances: 1, now: NOW });
  assert.equal(r.ok, true);
});

test('cisza w logach > 20 min = zawieszony (chyba ze pauza)', () => {
  assert.equal(evaluateHealth({ status: { lastLogAt: minutesAgo(25) }, now: NOW }).ok, false);
  assert.equal(evaluateHealth({ status: { lastLogAt: minutesAgo(25), isPaused: true }, now: NOW }).ok, true);
});

test('pm2 offline, API nie odpowiada, dwie instancje, Stop', () => {
  const r = evaluateHealth({
    pm2: { status: 'stopped' }, status: { error: 'ECONNREFUSED' }, instances: 2, now: NOW,
  });
  assert.equal(r.problems.length, 3);
  assert.equal(evaluateHealth({ status: { lastLogAt: minutesAgo(1), emergencyStop: true }, now: NOW }).ok, false);
});

test('petla restartow pm2', () => {
  const r = evaluateHealth({ pm2: { status: 'online', restarts: 10 }, prevRestarts: { count: 6, at: NOW - 300000 }, now: NOW });
  assert.match(r.problems.join(), /4 restartów/);
  assert.equal(evaluateHealth({ pm2: { status: 'online', restarts: 7 }, prevRestarts: { count: 6, at: NOW - 300000 }, now: NOW }).ok, true);
});

test('powiadomienie tylko przy zmianie stanu', () => {
  const bad = { ok: false, problems: ['x'] };
  const good = { ok: true, problems: [] };
  assert.equal(shouldNotify(null, good), false);
  assert.equal(shouldNotify(null, bad), true);
  assert.equal(shouldNotify(bad, bad), false);
  assert.equal(shouldNotify(bad, { ok: false, problems: ['y'] }), true);
  assert.equal(shouldNotify(bad, good), true);
});
