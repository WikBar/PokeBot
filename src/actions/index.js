const { ClickAdventure, CheckIfPokemon, ClickPokemon, CatchPokemon } = require('./adventure');
const { ClickContinue, CancelActivity, StartActivity } = require('./activity');
const { CheckHP, ClickHospital, EatRawstBerry } = require('./health');
const { CheckPA } = require('./stats');
const { SellPokemon } = require('./pokemon');
const { login, isSessionAlive } = require('./auth');

module.exports = {
  ClickAdventure,
  CheckIfPokemon,
  ClickPokemon,
  CatchPokemon,
  ClickContinue,
  CancelActivity,
  StartActivity,
  CheckHP,
  ClickHospital,
  EatRawstBerry,
  CheckPA,
  SellPokemon,
  login,
  isSessionAlive
};