const path = require('path');
const { logger } = require('../utils/logger');
const { loadFromFile, saveToFile } = require('../utils/fileOperations');
const { sendNotification } = require('../utils/notifier');

const log = logger.child({ module: 'team' });

const TEAM_PATH = path.resolve(__dirname, '..', '..', 'config', 'team.json');
const POKEAPI = 'https://pokeapi.co/api/v2/pokemon';

// Odstęp między odczytami drużyny (30 minut).
const TEAM_REFRESH_MS = 30 * 60 * 1000;

// Mapowanie typów EN -> PL. Musi zgadzać się z types.json panelu web.
const TYPE_PL = {
  normal: 'Normalny', fire: 'Ognisty', water: 'Wodny', electric: 'Elektryczny',
  grass: 'Trawiasty', ice: 'Lodowy', fighting: 'Walczący', poison: 'Trujący',
  ground: 'Ziemny', flying: 'Latający', psychic: 'Psychiczny', bug: 'Robak',
  rock: 'Skalny', ghost: 'Duchowy', dragon: 'Smok', dark: 'Mroczny',
  steel: 'Stalowy', fairy: 'Wróżkowy',
};

// Część pokemonów występuje w PokeAPI tylko pod nazwą formy.
const NAME_FALLBACKS = ['-solo', '-normal', '-standard', '-ordinary', '-average'];

// Cache typów w pamięci — nazwa pokemona nie zmienia typów między odczytami.
const typeCache = new Map();

let lastRefreshAt = 0;

function toApiName(name) {
  return String(name || '').trim().toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/\s+/g, '-');
}

async function fetchTypes(name) {
  const key = toApiName(name);
  if (typeCache.has(key)) return typeCache.get(key);

  const candidates = [key, ...NAME_FALLBACKS.map((s) => key + s)];
  for (const candidate of candidates) {
    const response = await fetch(`${POKEAPI}/${candidate}`);
    if (!response.ok) continue;

    const data = await response.json();
    const types = (data.types || [])
      .sort((a, b) => a.slot - b.slot)
      .map((t) => TYPE_PL[t.type.name] || t.type.name);

    const result = { type1: types[0] || '', type2: types[1] || '' };
    typeCache.set(key, result);
    return result;
  }
  return null;
}

// Czyta nazwy i poziomy z panelu "Drużyna". Format wiersza: "Nazwa (49 poz.)".
async function readTeamFromPage(page) {
  const panel = page.locator('div.panel:has(div.panel-heading:has-text("Drużyna"))');
  if (!(await panel.count()) || !(await panel.first().isVisible().catch(() => false))) {
    log.debug('Panel drużyny niewidoczny — pomijam odczyt.');
    return null;
  }

  const text = await panel.first().innerText();
  const members = [];
  // "Kingambit (95 poz.)" — nazwa może zawierać spacje i myślniki (Iron Treads, Kommo-o).
  const regex = /^(.+?)\s*\((\d+)\s*poz\.?\)/gm;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1].trim();
    const level = parseInt(match[2], 10);
    if (name && !Number.isNaN(level)) members.push({ name, level });
  }

  return members.length > 0 ? members : null;
}

// Odczytuje drużyną ze strony, uzupełnia typy i zapisuje do team.json.
// O nieudanym wykryciu typów informuje powiadomieniem.
async function UpdateTeam(page) {
  const members = await readTeamFromPage(page);
  if (!members) {
    // Panel drużyny bywa niedostępny (np. w trakcie wyprawy) — pomijamy
    // aktualizację i spróbujemy przy kolejnym przebiegu.
    log.debug('Nie znaleziono drużyny na stronie — pomijam aktualizację.');
    return { team: null, failed: [], removed: [], changed: false, skipped: true };
  }

  const previous = (await loadFromFile(TEAM_PATH))?.team || [];
  const team = [];
  const failed = [];

  for (const { name, level } of members) {
    let types = null;
    try {
      types = await fetchTypes(name);
    } catch (e) {
      log.warn(`Błąd pobierania typów dla ${name}`, { error: String(e) });
    }

    if (types) {
      team.push({ name, level, ...types });
      continue;
    }

    // Brak typów z API — ratujemy poprzednio zapisane, żeby ich nie zgubić.
    const known = previous.find((s) => s.name === name);
    team.push({
      name,
      level,
      type1: known?.type1 || '',
      type2: known?.type2 || '',
    });
    if (!known?.type1) failed.push(name);
  }

  // API i panel web wymagają dokładnie 6 slotów. Jeśli pokemon zniknie z
  // drużyny, zostaje po nim pusty slot — dzięki temu ubytek widać w pliku
  // i w panelu, zamiast po cichu przesuwać pozostałe pokemony.
  const EMPTY_SLOT = { name: '', level: null, type1: '', type2: '' };
  while (team.length < 6) team.push({ ...EMPTY_SLOT });
  const fullTeam = team.slice(0, 6);

  const removed = previous
    .filter((s) => s.name && !fullTeam.some((t) => t.name === s.name))
    .map((s) => s.name);

  const changed = JSON.stringify(previous) !== JSON.stringify(fullTeam);
  const filled = fullTeam.filter((s) => s.name);
  const summary = filled.map((s) => `${s.name} ${s.level}`).join(', ');

  if (changed) {
    await saveToFile(TEAM_PATH, { team: fullTeam });
    log.info(`Odczyt drużyny OK (${filled.length}/6) – zaktualizowano: ${summary}`);
    if (removed.length > 0) {
      log.warn(`Zniknęły z drużyny: ${removed.join(', ')}`);
    }
  } else {
    log.info(`Odczyt drużyny OK (${filled.length}/6) – bez zmian: ${summary}`);
  }

  for (const name of failed) {
    await sendNotification(`Pokemon ${name} nie udało się wykryć typów.`);
    log.warn(`Nie wykryto typów dla: ${name}`);
  }

  return { team: fullTeam, failed, removed, changed };
}

// Wywoływane w pętli głównej — odpala UpdateTeam nie częściej niż co 30 minut.
async function UpdateTeamIfDue(page, { force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastRefreshAt < TEAM_REFRESH_MS) return null;

  try {
    const result = await UpdateTeam(page);
    // Znacznik czasu przesuwamy tylko po udanym odczycie — jeśli panel drużyny
    // był niedostępny, spróbujemy ponownie przy kolejnym przebiegu pętli.
    if (!result?.skipped) lastRefreshAt = now;
    return result;
  } catch (e) {
    // Błąd nie może przerwać pętli bota — logujemy i próbujemy innym razem.
    log.error('Błąd aktualizacji drużyny — spróbuję ponownie później', { error: String(e) });
    return null;
  }
}

// Wczytuje drużynę z team.json (kolejność slotów = kolejność przycisków w grze).
async function loadTeam() {
  return (await loadFromFile(TEAM_PATH))?.team || [];
}

// Zwraca true, jeśli pokemon dzieli choć jeden typ z podanym slotem drużyny.
function sharesType(pokemonTypes, slot) {
  const types = (Array.isArray(pokemonTypes) ? pokemonTypes : []).filter(Boolean);
  const slotTypes = [slot?.type1, slot?.type2].filter(Boolean);
  return types.some((t) => slotTypes.includes(t));
}

// Szuka w drużynie pokemona o typie wspólnym z łapanym. Gdy pasuje kilku,
// wybiera tego o najwyższym poziomie (przy remisie — pierwszy od góry).
// Zwraca indeks slotu (= indeks przycisku wyboru) lub -1.
function findMatchingTeamIndex(team, pokemonTypes) {
  let bestIndex = -1;
  let bestLevel = -Infinity;

  team.forEach((slot, i) => {
    if (!slot?.name || !sharesType(pokemonTypes, slot)) return;
    // Brak poziomu traktujemy jak 0 — taki pokemon nadal może zostać wybrany,
    // jeśli jest jedynym pasującym.
    const level = Number.isFinite(slot.level) ? slot.level : 0;
    if (bestIndex === -1 || level > bestLevel) {
      bestLevel = level;
      bestIndex = i;
    }
  });

  return bestIndex;
}

module.exports = {
  UpdateTeam,
  UpdateTeamIfDue,
  readTeamFromPage,
  loadTeam,
  sharesType,
  findMatchingTeamIndex,
  TEAM_REFRESH_MS,
};
