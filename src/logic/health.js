// Ocena stanu bota dla scripts/healthcheck.js - czysta logika.

// Podczas odnawiania PA bot loguje co 12 min, wiec 20 min ciszy = zawieszony.
const STALE_MINUTES = 20;
// Tyle restartow pm2 miedzy dwoma sprawdzeniami (cron co 5 min) uznajemy
// za petle crashy. Pojedynczy restart (auto-update, fatal error) jest normalny.
const MAX_RESTARTS_BETWEEN_CHECKS = 3;

// Wejscie (kazde pole moze byc null = nie dalo sie sprawdzic):
// - pm2: { status, restarts, uptimeMs } procesu bota
// - status: odpowiedz /api/status albo { error }
// - instances: liczba procesow src/index.js w katalogu bota
// - prevRestarts: { count, at } z poprzedniego sprawdzenia
// Zwraca { ok, problems: string[], notes: string[] }.
function evaluateHealth({ pm2 = null, status = null, instances = null, now = Date.now(), prevRestarts = null } = {}) {
  const problems = [];
  const notes = [];

  if (pm2) {
    if (pm2.status !== 'online') problems.push(`pm2: proces nie działa (status ${pm2.status})`);
    if (prevRestarts && Number.isFinite(pm2.restarts) && Number.isFinite(prevRestarts.count)) {
      const delta = pm2.restarts - prevRestarts.count;
      if (delta >= MAX_RESTARTS_BETWEEN_CHECKS) problems.push(`pm2: ${delta} restartów od ostatniego sprawdzenia - pętla crashy`);
    }
  } else {
    notes.push('pm2: nie sprawdzono');
  }

  if (!status) {
    notes.push('API bota: nie sprawdzono');
  } else if (status.error) {
    problems.push(`API bota nie odpowiada (${status.error})`);
  } else {
    if (status.emergencyStop) problems.push('bot zatrzymany przyciskiem Stop');
    if (status.isPaused) notes.push('bot wstrzymany (pauza)');
    // Tylko lastLogAt: lastUpdated nie zmienia sie podczas 2-godzinnego
    // odnawiania PA, wiec dawalby falszywe alarmy.
    const last = Date.parse(status.lastLogAt || '');
    if (Number.isFinite(last)) {
      const minutes = (now - last) / 60000;
      if (minutes > STALE_MINUTES && !status.isPaused) {
        problems.push(`brak aktywności od ${Math.round(minutes)} min - bot prawdopodobnie zawieszony`);
      }
    } else {
      notes.push('API bota: brak znacznika ostatniej aktywności (stara wersja?)');
    }
  }

  if (Number.isInteger(instances) && instances > 1) {
    problems.push(`działa ${instances} instancji bota - nadpisują sobie config`);
  }

  return { ok: problems.length === 0, problems, notes };
}

// Czy wyslac powiadomienie: tylko przy zmianie stanu (albo zmianie listy
// problemow), zeby cron co 5 min nie spamowal tym samym alarmem.
function shouldNotify(prev, current) {
  if (!prev) return !current.ok;
  if (prev.ok !== current.ok) return true;
  return !current.ok && prev.problems.join('|') !== current.problems.join('|');
}

module.exports = { STALE_MINUTES, MAX_RESTARTS_BETWEEN_CHECKS, evaluateHealth, shouldNotify };
