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

Na serwerze (crontab):

```
*/10 * * * * /sciezka/PokeBot/scripts/auto-update.sh >> /sciezka/PokeBot/logs/auto-update.log 2>&1
*/5 * * * * cd /sciezka/PokeBot && NODE_ENV=production node scripts/healthcheck.js >> logs/healthcheck.log 2>&1
0 8 * * * cd /sciezka/PokeBot && NODE_ENV=production node scripts/verify-logs.js --since 24h --telegram >> logs/verify-logs.log 2>&1
```

`auto-update.sh` po pobraniu nowej wersji uruchamia `verify-config.js` i przy błędach wycofuje aktualizację bez restartu bota.
Bot sam pilnuje, żeby nie działały dwie instancje (`logs/bot.lock`), a po błędzie krytycznym kończy proces, żeby pm2 go zrestartował.
