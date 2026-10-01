// Tryb Shiny - maszyna stanow liczaca wyprawy na lokacji. Czysta logika:
// index.js wykonuje zwrocona akcje (zmiana lokacji, powiadomienie, log).

// Na kazdej lokacji robimy N wypraw i jesli nie trafimy Golden Nest,
// przechodzimy do kolejnej.
const SHINY_HUNT_TRIES_DEFAULT = 20;
// Golden Nest, ktorego nie udalo sie zlapac: gniazdo dalej jest aktywne,
// wiec zostajemy na lokacji przez tyle kolejnych wypraw.
const SHINY_HOLD_ITERATIONS = 100;
// Co tyle wypraw blokady leci na Telegram raport, ile jeszcze zostalo.
const SHINY_HOLD_NOTIFY_EVERY = 20;

function createShinyState(locationNr) {
  return { tries: 0, hold: 0, locationNr };
}

function maxTriesFrom(config) {
  return Math.max(1, Number(config?.shinyHuntTries) || SHINY_HUNT_TRIES_DEFAULT);
}

// Jeden krok po wyprawie. Zwraca { state, action }, gdzie action.type to:
// - 'advance'    - idz na kolejna lokacje (reason: 'caught' | 'tries');
//                  po udanej zmianie wywolujacy ustawia state.locationNr
// - 'holdStart'  - Golden Nest nie zlapany, startuje blokada
// - 'hold'       - blokada trwa; notify=true -> raport na Telegram
// - 'try'        - zwykla proba bez Golden Nest
function shinyStep(prev, { adventureNr, goldenNestFound = false, goldenNestCaught = false, maxTries }) {
  let st = { ...prev };

  // Zmiana lokacji z panelu w trakcie polowania = nowa pula prob.
  // Blokade tez kasujemy - dotyczyla poprzedniej lokacji.
  if (adventureNr !== st.locationNr) {
    st = createShinyState(adventureNr);
  }

  if (goldenNestFound && goldenNestCaught) {
    // Zlapany - gniazdo wykorzystane, idziemy na kolejna lokacje.
    return { state: { ...st, tries: 0, hold: 0 }, action: { type: 'advance', reason: 'caught' } };
  }
  if (goldenNestFound) {
    // Nieudany rzut - gniazdo dalej aktywne, blokujemy zmiane lokacji.
    return { state: { ...st, tries: 0, hold: SHINY_HOLD_ITERATIONS }, action: { type: 'holdStart' } };
  }
  if (st.hold > 0) {
    const hold = st.hold - 1;
    const notify = hold > 0 && hold % SHINY_HOLD_NOTIFY_EVERY === 0;
    return { state: { ...st, hold }, action: { type: 'hold', notify } };
  }

  const tries = st.tries + 1;
  if (tries >= maxTries) {
    // Pule zerujemy takze, gdy zmiana sie nie uda (brak dokad isc).
    return { state: { ...st, tries: 0 }, action: { type: 'advance', reason: 'tries', tries } };
  }
  return { state: { ...st, tries }, action: { type: 'try', tries } };
}

module.exports = {
  SHINY_HUNT_TRIES_DEFAULT,
  SHINY_HOLD_ITERATIONS,
  SHINY_HOLD_NOTIFY_EVERY,
  createShinyState,
  maxTriesFrom,
  shinyStep,
};
