const { ClickAdventure, CheckIfPokemon, ClickPokemon, CatchPokemon, checkCatchingDiff } = require('./adventure');
const { ClickContinue, CancelActivity, StartActivity } = require('./activity');
const { CheckHP, ClickHospital, EatRawstBerry } = require('./health');
const { CheckPA, CheckStorage } = require('./stats');
const { SellPokemon } = require('./pokemon');
const { login, isSessionAlive } = require('./auth');
const { UpdateTeam, UpdateTeamIfDue } = require('./team');

module.exports = {
  ClickAdventure,
  CheckIfPokemon,
  ClickPokemon,
  CatchPokemon,
  checkCatchingDiff,
  ClickContinue,
  CancelActivity,
  StartActivity,
  CheckHP,
  ClickHospital,
  EatRawstBerry,
  CheckPA,
  CheckStorage,
  SellPokemon,
  login,
  isSessionAlive,
  UpdateTeam,
  UpdateTeamIfDue
};