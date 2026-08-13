const _state = {
  pa:            { current: 0, max: 0 },
  hp:            { current: 0, max: 100 },
  storage:       { current: 0, max: 0 },
  activity:      { active: false },
  isRunning:     true,
  isPaused:      false,
  emergencyStop: false,
  forceHospital: false,
  forceTeamUpdate: false,
  teamLastUpdated: null,
  region:        null,
  adventureNr:   null,
  lastEvent:     null,
  lastUpdated:   null,
  recentLogs:    []
};

const _sseClients = new Set();

function _notifySseClients() {
  const payload = JSON.stringify(getState());
  for (const res of _sseClients) {
    try { res.write(`data: ${payload}\n\n`); }
    catch { _sseClients.delete(res); }
  }
}

function getState() {
  return { ..._state, recentLogs: [..._state.recentLogs] };
}

function updateStats(partial) {
  Object.assign(_state, partial);
  _state.lastUpdated = new Date().toISOString();
  _notifySseClients();
}

function addLog(entry) {
  _state.recentLogs.push(entry);
  if (_state.recentLogs.length > 100) _state.recentLogs.shift();
  _notifySseClients();
}

function setPaused(bool)        { _state.isPaused = bool;      _notifySseClients(); }
function setEmergencyStop(bool) { _state.emergencyStop = bool; _notifySseClients(); }
function setForceHospital(bool) { _state.forceHospital = bool; _notifySseClients(); }
function setForceTeamUpdate(bool) { _state.forceTeamUpdate = bool; _notifySseClients(); }
function setTeamLastUpdated(iso)  { _state.teamLastUpdated = iso; _notifySseClients(); }

function subscribeSse(res)   { _sseClients.add(res); }
function unsubscribeSse(res) { _sseClients.delete(res); }

module.exports = { getState, updateStats, addLog, setPaused, setEmergencyStop, setForceHospital, setForceTeamUpdate, setTeamLastUpdated, subscribeSse, unsubscribeSse };
