# PokeBot
PokeBot do strony PokeLife uruchomiony na serwerze Mikrus

## Weryfikacja

| Komenda | Co sprawdza |
|---|---|
| `npm run verify` | config + testy (uruchamiaj przed każdym pushem) |
| `npm run verify:config` | `config.json`, `locations.json`, `team.json` — błędy (kod 1) i ostrzeżenia |
| `npm test` | testy logiki bez przeglądarki (`tests/*.test.js`, `node:test`) |
| `npm run verify:logs -- --since 24h` | anomalie w logach: przestoje, druga instancja, przerwana blokada Golden Nest, brak kul; `--telegram` wysyła podsumowanie |
| `npm run healthcheck` | pm2, ostatnia aktywność bota przez API, liczba instancji; alarm na Telegram przy zmianie stanu |

Na serwerze bot, health-check (co 5 min) i dzienny raport z logów (8:00) uruchamia pm2 z [ecosystem.config.js](ecosystem.config.js):

```
pm2 delete Pokebot          # jednorazowo, jeśli proces był dodany ręcznie
pm2 start ecosystem.config.js
pm2 save
```

Auto-update zostaje w crontabie:

```
*/10 * * * * /sciezka/PokeBot/scripts/auto-update.sh >> /sciezka/PokeBot/logs/auto-update.log 2>&1
```

## Stan roboczy

`config/runtime-state.json` (poza gitem) trzyma bieżącą lokację z rotacji (tryb Shiny / randomAdventure) i stan Shiny, w tym blokadę po Golden Nest — przeżywają restart i aktualizację. `adventureNr` w `config.json` to lokacja startowa: jej zmiana (panel, plik) resetuje rotację. Bieżącą lokację pokazuje `/api/status` (`adventureNr`).

`auto-update.sh` po pobraniu nowej wersji uruchamia `verify-config.js` i przy błędach wycofuje aktualizację bez restartu bota.
Bot sam pilnuje, żeby nie działały dwie instancje (`logs/bot.lock`), a po błędzie krytycznym kończy proces, żeby pm2 go zrestartował.
