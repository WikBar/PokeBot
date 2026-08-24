const express = require('express');
const cors = require('cors');
const path = require('path');
const { loadFromFile, saveToFile } = require('./utils/fileOperations');
const state = require('./state');
const { logger } = require('./utils/logger');
const { setForceHospital } = require('./state');
const { REPEL_ITEM_NAMES } = require('./actions/equipment');

const log = logger.child({ module: 'server' });

const CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'config.json');
const DAILY_PATH  = path.resolve(__dirname, '..', 'config', 'daily-state.json');
const TEAM_PATH   = path.resolve(__dirname, '..', 'config', 'team.json');
const LOCATIONS_PATH = path.resolve(__dirname, '..', 'config', 'locations.json');

const ALLOWED_CONFIG_KEYS = new Set([
  'region', 'adventureNr', 'randomAdventure',
  'pokemonIndex', 'SecondPokemonIndex', 'paBuffer', 'sellablePokemon', 'protectedPokemon',
  'sellThreshold', 'limitsEnabled', 'diff3Keep', 'diff4Keep',
  'autoRepelEnabled', 'autoRepelKind', 'autoRepelTier', 'autoRepelMin',
  'saveSafariBall', 'activityMode',
  'diff3CatchPokemons', 'diff4CatchPokemons', 'diff5CatchPokemons', 'diff0CatchPokemons'
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
  const port = parseInt(process.env.WEB_PORT, 10) || 4001;

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

  // Lista regionów dla panelu web — zawsze zgodna z locations.json.
  app.get('/api/regions', async (_req, res) => {
    const locations = await loadFromFile(LOCATIONS_PATH);
    res.json({ regions: locations ? Object.keys(locations) : [] });
  });

  app.get('/api/daily', async (req, res) => {
    const daily = await loadFromFile(DAILY_PATH);
    res.json(daily);
  });

  app.get('/api/team', async (_req, res) => {
    const team = await loadFromFile(TEAM_PATH);
    res.json(team);
  });

  app.post('/api/team', async (req, res) => {
    const { team } = req.body;
    if (!Array.isArray(team) || team.length !== 6) {
      return res.status(400).json({ ok: false, error: 'team must be an array of 6 entries' });
    }
    for (const slot of team) {
      if (typeof slot.type1 !== 'string' || typeof slot.type2 !== 'string') {
        return res.status(400).json({ ok: false, error: 'each slot must have type1 and type2 strings' });
      }
      if (slot.type1 && slot.type2 && slot.type1 === slot.type2) {
        return res.status(400).json({ ok: false, error: `Pokemon nie może mieć 2 takich samych typów: ${slot.type1}` });
      }
    }
    // Panel web wysyła tylko type1/type2 — zachowujemy nazwę i poziom z dysku,
    // żeby zapis typów ich nie skasował.
    const currentTeam = (await loadFromFile(TEAM_PATH))?.team || [];
    const merged = team.map((slot, i) => ({
      name: slot.name ?? currentTeam[i]?.name ?? '',
      level: slot.level ?? currentTeam[i]?.level ?? null,
      type1: slot.type1,
      type2: slot.type2,
    }));

    await saveToFile(TEAM_PATH, { team: merged });
    log.info('Team updated via API');
    res.json({ ok: true, team: merged });
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
    else if (action === 'updateTeam') { state.setForceTeamUpdate(true); }
    else if (action === 'useTepel' || action === 'useRepel') {
      // Panel przysyła poziom (1-3); bez niego przyjmujemy podstawowy.
      const kind = action === 'useTepel' ? 'tepel' : 'repel';
      const tier = parseInt(req.body.tier, 10) || 1;
      const key = `${kind}-${tier}`;
      if (!REPEL_ITEM_NAMES[key]) {
        return res.status(400).json({ ok: false, error: `Nieznany przedmiot: ${key}` });
      }
      // Nie pozwalamy aktywować czegoś, czego nie ma w plecaku — panel
      // blokuje takie przyciski, ale zapytanie może przyjść też skądinąd.
      const stock = state.getState().equipment?.repels?.[key];
      if (stock !== undefined && stock <= 0) {
        log.warn('Odrzucono aktywację - brak w plecaku', { key });
        return res.status(409).json({ ok: false, error: `Brak w plecaku: ${REPEL_ITEM_NAMES[key]}` });
      }
      state.setUseRepelRequest({ kind, tier, name: REPEL_ITEM_NAMES[key] });
    }
    else { return res.status(400).json({ ok: false, error: `Unknown action: ${action}` }); }
    const { isPaused, emergencyStop, forceHospital, forceTeamUpdate, useRepelRequest } = state.getState();
    log.info('Control action received', { action });
    res.json({ ok: true, isPaused, emergencyStop, forceHospital, forceTeamUpdate, useRepelRequest });
  });

  app.listen(port, () => {
    log.info(`Web server listening on port ${port}`);
  });
}

module.exports = { startServer };
