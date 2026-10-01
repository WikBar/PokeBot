#!/usr/bin/env node
// Kontrola bota na serwerze: pm2, API bota (ostatnia aktywnosc), liczba
// instancji. Alarm na Telegram tylko przy zmianie stanu.
//
// Uzycie (na VPS):
//   NODE_ENV=production node scripts/healthcheck.js
//   node scripts/healthcheck.js --no-notify     # tylko raport w konsoli
//
// Automatycznie co 5 minut (crontab -e):
//   */5 * * * * cd /sciezka/PokeBot && NODE_ENV=production node scripts/healthcheck.js >> logs/healthcheck.log 2>&1
//
// Zmienne: API_KEY, WEB_PORT (z .env), PM2_NAME (domyslnie Pokebot).

const path = require('path');
const fs = require('fs');
const { execFileSync, execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, process.env.NODE_ENV === 'production' ? '.env.production' : '.env') });
process.env.LOG_TO_FILE = 'false';

const { evaluateHealth, shouldNotify } = require('../src/logic/health');
const { sendNotification } = require('../src/utils/notifier');

const STATE_PATH = path.join(ROOT, 'logs', 'health-state.json');
const PM2_NAME = process.env.PM2_NAME || 'Pokebot';
const PORT = parseInt(process.env.WEB_PORT, 10) || 4001;

function readPm2() {
  try {
    const out = execSync('pm2 jlist', { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] });
    const list = JSON.parse(out.slice(out.indexOf('[')));
    const proc = list.find((p) => p.name === PM2_NAME);
    if (!proc) return { status: 'brak procesu' };
    return {
      status: proc.pm2_env?.status,
      restarts: proc.pm2_env?.restart_time,
      uptimeMs: Date.now() - (proc.pm2_env?.pm_uptime || Date.now()),
    };
  } catch (e) {
    return null;   // brak pm2 (np. lokalnie) - pomijamy
  }
}

async function readStatus() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/status`, {
      headers: process.env.API_KEY ? { 'x-api-key': process.env.API_KEY } : {},
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e) {
    return { error: e.cause?.code || e.name || String(e) };
  }
}

// Liczba procesow "node ... src/index.js" (druga instancja = dwa boty na
// jednym koncie).
function countInstances() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('powershell', ['-NoProfile', '-Command',
        "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'src[\\\\/]index\\.js' }).Count"],
      { encoding: 'utf8', timeout: 15000 });
      return parseInt(out.trim(), 10) || 0;
    }
    const out = execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' });
    return out.split('\n').filter((l) => /\bnode\b/.test(l) && /src\/index\.js/.test(l)).length;
  } catch (e) {
    return null;
  }
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return null; }
}

async function main() {
  const notify = !process.argv.includes('--no-notify');
  const prev = readState();
  const pm2 = readPm2();
  const status = await readStatus();
  const instances = countInstances();
  const now = Date.now();

  const result = evaluateHealth({ pm2, status, instances, now, prevRestarts: prev?.restarts || null });
  const stamp = new Date(now).toLocaleString('pl-PL');

  console.log(`[${stamp}] ${result.ok ? 'OK' : 'PROBLEM'}`);
  for (const p of result.problems) console.log(`  BŁĄD   ${p}`);
  for (const n of result.notes) console.log(`  info   ${n}`);

  if (notify && shouldNotify(prev, result)) {
    const msg = result.ok
      ? 'PokeBot health-check: wszystko znów działa.'
      : `PokeBot health-check:\n- ${result.problems.join('\n- ')}`;
    await sendNotification(msg);
  }

  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify({
    ok: result.ok,
    problems: result.problems,
    checkedAt: new Date(now).toISOString(),
    restarts: pm2 && Number.isFinite(pm2.restarts) ? { count: pm2.restarts, at: now } : null,
  }, null, 2));

  process.exit(result.ok ? 0 : 1);
}

main();
