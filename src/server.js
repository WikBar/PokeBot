const express = require('express');
const cors = require('cors');
const path = require('path');
const { loadFromFile, saveToFile } = require('./utils/fileOperations');
const state = require('./state');
const { logger } = require('./utils/logger');
const { setForceHospital } = require('./state');

const log = logger.child({ module: 'server' });

const CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'config.json');
const DAILY_PATH  = path.resolve(__dirname, '..', 'config', 'daily-state.json');

const ALLOWED_CONFIG_KEYS = new Set([
  'region', 'adventureNr', 'randomAdventure',
  'pokemonIndex', 'SecondPokemonIndex', 'paBuffer', 'sellablePokemon'
]);

const API_KEY = process.env.API_KEY || null;

function requireApiKey(req, res, next) {
  if (!API_KEY) return next();                          // key not configured → open access
  if (req.method === 'OPTIONS') return next();          // allow CORS preflight
  if (req.headers['x-api-key'] === API_KEY) return next();
  log.warn('Unauthorized API request', { ip: req.ip, path: req.path });
  return res.status(401).json({ ok: false, error: 'Unauthorized: invalid API key' });
}

function startServer() {
  const app = express();
  const port = parseInt(process.env.WEB_PORT, 10) || 3001;

  app.use(cors());
  app.use(express.json());
  app.use(requireApiKey);

  app.get('/api/status', (req, res) => {
    res.json(state.getState());
  });

  app.get('/api/config', async (req, res) => {
    const config = await loadFromFile(CONFIG_PATH);
    res.json(config);
  });

  app.post('/api/config', async (req, res) => {
    const patch = req.body;
    const unknownKeys = Object.keys(patch).filter(k => !ALLOWED_CONFIG_KEYS.has(k));
    if (unknownKeys.length > 0) {
      return res.status(400).json({ ok: false, error: `Unknown config keys: ${unknownKeys.join(', ')}` });
    }
    const current = await loadFromFile(CONFIG_PATH);
    const updated = { ...current, ...patch };
    await saveToFile(CONFIG_PATH, updated);
    log.info('Config updated via API', { patch });
    res.json({ ok: true, config: updated });
  });

  app.get('/api/daily', async (req, res) => {
    const daily = await loadFromFile(DAILY_PATH);
    res.json(daily);
  });

  app.get('/api/logs', (req, res) => {
    const n = Math.min(parseInt(req.query.n, 10) || 100, 200);
    const { recentLogs } = state.getState();
    const logs = recentLogs.slice(-n);
    res.json({ logs, count: logs.length });
  });

  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    res.write(`data: ${JSON.stringify(state.getState())}\n\n`);
    state.subscribeSse(res);

    const heartbeat = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { clearInterval(heartbeat); }
    }, 30000);

    req.on('close', () => {
      clearInterval(heartbeat);
      state.unsubscribeSse(res);
    });
  });

  app.post('/api/control', (req, res) => {
    const { action } = req.body;
    if (action === 'pause')         { state.setPaused(true); }
    else if (action === 'resume')   { state.setPaused(false); }
    else if (action === 'stop')     { state.setEmergencyStop(true); }
    else if (action === 'hospital') { setForceHospital(true); }
    else { return res.status(400).json({ ok: false, error: `Unknown action: ${action}` }); }
    const { isPaused, emergencyStop, forceHospital } = state.getState();
    log.info('Control action received', { action });
    res.json({ ok: true, isPaused, emergencyStop, forceHospital });
  });

  app.listen(port, () => {
    log.info(`Web server listening on port ${port}`);
  });
}

module.exports = { startServer };
