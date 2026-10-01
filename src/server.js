const express = require('express');
const cors = require('cors');
const path = require('path');
const { loadFromFile, saveToFile } = require('./utils/fileOperations');
const state = require('./state');
const { logger } = require('./utils/logger');
const { setForceHospital } = require('./state');
const { REPEL_ITEM_NAMES } = require('./actions/equipment');
const { validateConfig } = require('./validation/config');
const { loadJson, RUNTIME_PATH, SHINY_STATS_PATH } = require('./utils/runtimeStore');
const { summarize } = require('./logic/shinyStats');

const log = logger.child({ module: 'server' });

const CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'config.json');
const DAILY_PATH  = path.resolve(__dirname, '..', 'config', 'daily-state.json');
const TEAM_PATH   = path.resolve(__dirname, '..', 'config', 'team.json');
const LOCATIONS_PATH = path.resolve(__dirname, '..', 'config', 'locations.json');

const ALLOWED_CONFIG_KEYS = new Set([
  'region', 'adventureNr', 'randomAdventure',
  'pokemonIndex', 'SecondPokemonIndex', 'secondPokMaxLv', 'paBuffer', 'sellablePokemon', 'protectedPokemon',
  'sellThreshold', 'limitsEnabled', 'diff3Keep', 'diff4Keep',
  'autoRepelEnabled', 'autoRepelKind', 'autoRepelTier', 'autoRepelMin',
  'saveSafariBall', 'activityMode', 'adventureDelay',
  'shinyHunt', 'shinyHuntTries', 'skippedAdventures', 'strongBallPokemons',
  'diff3CatchPokemons', 'diff4CatchPokemons', 'diff5CatchPokemons', 'diff0CatchPokemons'
]);

// Klucz API czytany przy tworzeniu aplikacji (testy podaja wlasny).
function makeRequireApiKey(apiKey) {
  return function requireApiKey(req, res, next) {
    if (!apiKey) return next();                           // key not configured → open access
    if (req.method === 'OPTIONS') return next();          // allow CORS preflight
    if (req.headers['x-api-key'] === apiKey) return next();
    log.warn('Unauthorized API request', { ip: req.ip, path: req.path });
    return res.status(401).json({ ok: false, error: 'Unauthorized: invalid API key' });
  };
}

// Buduje aplikacje Express bez nasluchiwania - startServer ja uruchamia,
// a testy wolaja na porcie 0 z wlasnymi sciezkami do plikow.
function createApp({ paths = {}, apiKey = process.env.API_KEY || null } = {}) {
  const P = {
    config: CONFIG_PATH, daily: DAILY_PATH, team: TEAM_PATH, locations: LOCATIONS_PATH,
    runtime: RUNTIME_PATH, shinyStats: SHINY_STATS_PATH,
    ...paths,
  };
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(makeRequireApiKey(apiKey));

  app.get('/api/status', (req, res) => {
    res.json(state.getState());
  });

  app.get('/api/config', async (req, res) => {
    const config = await loadFromFile(P.config);
    res.json(config);
  });

  app.post('/api/config', async (req, res) => {
    const patch = req.body;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return res.status(400).json({ ok: false, error: 'Body must be a JSON object' });
    }
    const unknownKeys = Object.keys(patch).filter(k => !ALLOWED_CONFIG_KEYS.has(k));
    if (unknownKeys.length > 0) {
      return res.status(400).json({ ok: false, error: `Unknown config keys: ${unknownKeys.join(', ')}` });
    }
    const current = await loadFromFile(P.config);
    // Bez obecnego configu zapisalibysmy sam patch - czyli skasowali
    // wszystkie pozostale ustawienia i listy.
    if (!current) {
      return res.status(500).json({ ok: false, error: 'config.json nie da się wczytać - zapis wstrzymany' });
    }
    const updated = { ...current, ...patch };
    const locations = await loadFromFile(P.locations);
    const team = (await loadFromFile(P.team))?.team || null;
    const { errors, warnings } = validateConfig(updated, locations, team);
    if (errors.length > 0) {
      log.warn('Config z panelu odrzucony', { errors });
      return res.status(400).json({ ok: false, error: errors.join('; '), errors, warnings });
    }
    await saveToFile(P.config, updated);
    log.info('Config updated via API', { patch });
    res.json({ ok: true, config: updated, warnings });
  });

  // Lista regionów dla panelu web — zawsze zgodna z locations.json.
  app.get('/api/regions', async (_req, res) => {
    const locations = await loadFromFile(P.locations);
    res.json({ regions: locations ? Object.keys(locations) : [] });
  });

  // Lokacje danego regionu — panel potrzebuje ich, żeby wiedzieć, które
  // numery wypraw w ogóle istnieją (reszta przełączników jest nieaktywna).
  app.get('/api/locations', async (req, res) => {
    const locations = await loadFromFile(P.locations);
    if (!locations) return res.json({ locations: [] });

    const region = req.query.region;
    if (region && locations[region]) {
      const list = Object.entries(locations[region])
        .map(([nr, loc]) => ({
          nr: Number(nr),
          name: loc.name,
          isSpecial: !!loc.isSpecial,
          requiredPA: loc.requiredPA,
        }))
        .sort((a, b) => a.nr - b.nr);
      return res.json({ region, locations: list });
    }

    // Bez parametru: mapa region → numery lokacji.
    const all = {};
    for (const [name, locs] of Object.entries(locations)) {
      all[name] = Object.keys(locs).map(Number).sort((a, b) => a - b);
    }
    res.json({ locations: all });
  });

  // Polowanie na Shiny: biezacy stan (lokacja, proby, blokada) i statystyki
  // Golden Nest per lokacja, od najlepszej.
  app.get('/api/shiny', async (req, res) => {
    const runtime = loadJson(P.runtime);
    const stats = loadJson(P.shinyStats) || {};
    const config = await loadFromFile(P.config);
    const region = req.query.region || runtime?.region || config?.region;
    res.json({
      region,
      runtime,
      locations: summarize(stats, region),
    });
  });

  app.get('/api/daily', async (req, res) => {
    const daily = await loadFromFile(P.daily);
    res.json(daily);
  });

  app.get('/api/team', async (_req, res) => {
    const team = await loadFromFile(P.team);
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
    const currentTeam = (await loadFromFile(P.team))?.team || [];
    const merged = team.map((slot, i) => ({
      name: slot.name ?? currentTeam[i]?.name ?? '',
      level: slot.level ?? currentTeam[i]?.level ?? null,
      type1: slot.type1,
      type2: slot.type2,
    }));

    await saveToFile(P.team, { team: merged });
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

  return app;
}

function startServer() {
  const port = parseInt(process.env.WEB_PORT, 10) || 4001;
  const server = createApp().listen(port, () => {
    log.info(`Web server listening on port ${port}`);
  });
  // Zajety port (np. stary proces-zombie) nie moze ubic bota - bez panelu
  // bot dalej gra, a problem widac w logu.
  server.on('error', (e) => {
    log.error('Panel API nie wystartował', { error: String(e), port });
  });
  return server;
}

module.exports = { startServer, createApp };
