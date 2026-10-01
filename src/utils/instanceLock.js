const fs = require('fs');
const path = require('path');

// Blokada przed druga instancja bota na tym samym katalogu. Dwa boty na
// jednym koncie nadpisywaly sobie config.json (skoki lokacji, timeouty).
// Plik zawiera PID; jesli ten proces juz nie zyje (crash, zanik pradu),
// blokade przejmujemy.
const DEFAULT_LOCK_PATH = path.resolve(__dirname, '..', '..', 'logs', 'bot.lock');

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = proces istnieje, ale nalezy do innego uzytkownika.
    return e.code === 'EPERM';
  }
}

// Zwraca { ok: true } albo { ok: false, pid } gdy inna instancja dziala.
function acquireLock(lockPath = DEFAULT_LOCK_PATH, pid = process.pid) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    const existing = parseInt(fs.readFileSync(lockPath, 'utf8'), 10);
    if (existing !== pid && isProcessAlive(existing)) {
      return { ok: false, pid: existing };
    }
  } catch (e) {
    // brak pliku albo smieci w srodku - przejmujemy
  }
  fs.writeFileSync(lockPath, String(pid), 'utf8');
  return { ok: true };
}

// Usuwa blokade tylko, jesli nalezy do nas - nie kasujemy cudzej.
function releaseLock(lockPath = DEFAULT_LOCK_PATH, pid = process.pid) {
  try {
    if (parseInt(fs.readFileSync(lockPath, 'utf8'), 10) === pid) fs.unlinkSync(lockPath);
  } catch (e) {
    // nic do zwolnienia
  }
}

module.exports = { acquireLock, releaseLock, isProcessAlive, DEFAULT_LOCK_PATH };
