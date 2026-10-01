const fs = require('fs');
const path = require('path');

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function normalizeLevel(value) {
  const v = String(value || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVELS, v) ? v : 'info';
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserializable]"';
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function pruneOldLogs(logsDir, maxAgeDays = 3) {
  try {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    for (const file of fs.readdirSync(logsDir)) {
      if (!/\.(log|jsonl)$/.test(file)) continue;
      const filePath = path.join(logsDir, file);
      if (fs.statSync(filePath).mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
      }
    }
  } catch {
    // prune failure is non-critical
  }
}

// Data lokalna (YYYY-MM-DD). Wczesniej toISOString() dawal date UTC, wiec
// plik z danego dnia zawieral linie od 02:00 do 02:00 nastepnego dnia.
function localDateKey(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// LOG_TO_FILE=false wylacza zapis do logs/ (testy, skrypty weryfikujace).
function fileLoggingEnabled() {
  return String(process.env.LOG_TO_FILE || '').toLowerCase() !== 'false';
}

function getLogFilePath(now = new Date(), accountId) {
  const dateKey = localDateKey(now);
  const suffix = accountId ? `-${accountId}` : '';
  return path.resolve(__dirname, '..', '..', 'logs', `app-${dateKey}${suffix}.log`);
}

function getMetricsFilePath(now = new Date()) {
  const dateKey = localDateKey(now);
  return path.resolve(__dirname, '..', '..', 'logs', `metrics-${dateKey}.jsonl`);
}

function formatLine(level, message, meta, now = new Date()) {
  const ts = now.toLocaleString('pl-PL', { hour12: false }).replace(', ', 'T');
  const pokemonSuffix = meta && typeof meta === 'object' && meta.pokemon
    ? ` [pokemon: ${meta.pokemon}]`
    : '';
  const base = `[${ts}] [${level.toUpperCase()}] ${message}${pokemonSuffix}`;
  if (meta === undefined) return base;
  const { module: _mod, account: _acc, ...rest } = meta;
  return Object.keys(rest).length > 0 ? `${base} ${safeJson(rest)}` : base;
}

function getRecentLogs(n = 100, accountId) {
  try {
    const filePath = getLogFilePath(new Date(), accountId);
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    return lines.slice(-n);
  } catch {
    return [];
  }
}

function createLogger(options = {}) {
  const baseMeta = options.baseMeta || {};
  const levelName = normalizeLevel(options.level || process.env.LOG_LEVEL);
  const minLevel = LEVELS[levelName];

  function write(level, message, meta) {
    if (LEVELS[level] < minLevel) return;

    const mergedMeta = meta === undefined ? baseMeta : { ...baseMeta, ...meta };
    const line = formatLine(level, message, mergedMeta);

    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);

    if (fileLoggingEnabled()) {
      try {
        const logsDir = path.resolve(__dirname, '..', '..', 'logs');
        ensureDir(logsDir);
        fs.appendFileSync(getLogFilePath(new Date(), baseMeta.account), line + '\n', 'utf8');
        if (Math.random() < 0.01) pruneOldLogs(logsDir);
      } catch (e) {
        console.error(formatLine('error', 'Logger file write failed', { error: String(e) }));
      }
    }

    try {
      const state = require('../state');
      state.addLog({ ts: new Date().toISOString(), level, message, meta: mergedMeta });
    } catch { /* state not yet loaded */ }
  }

  function metric(name, value, meta) {
    if (!fileLoggingEnabled()) return;
    try {
      const logsDir = path.resolve(__dirname, '..', '..', 'logs');
      ensureDir(logsDir);
      const entry = JSON.stringify({
        ts: new Date().toISOString(),
        account: baseMeta.account,
        name,
        value,
        ...meta
      });
      fs.appendFileSync(getMetricsFilePath(), entry + '\n', 'utf8');
    } catch {
      // metric write failure is non-critical
    }
  }

  return {
    child(extraMeta) {
      return createLogger({ level: levelName, baseMeta: { ...baseMeta, ...extraMeta } });
    },
    debug(message, meta) { write('debug', message, meta); },
    info(message, meta) { write('info', message, meta); },
    warn(message, meta) { write('warn', message, meta); },
    error(message, meta) { write('error', message, meta); },
    metric,
    getRecentLogs
  };
}

const logger = createLogger();

module.exports = {
  logger,
  createLogger,
  getRecentLogs,
  formatLine,
  getLogFilePath,
  localDateKey,
};
