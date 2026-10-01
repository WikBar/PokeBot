// Konfiguracja pm2 dla bota na serwerze.
//
// Pierwsze uruchomienie (zastepuje recznie dodany proces "Pokebot"):
//   pm2 delete Pokebot
//   pm2 start ecosystem.config.js
//   pm2 save
//
// auto-update.sh dalej robi "pm2 restart Pokebot" - nazwa jest ta sama.

module.exports = {
  apps: [
    {
      name: 'Pokebot',
      script: 'src/index.js',
      cwd: __dirname,
      env: { NODE_ENV: 'production' },
      autorestart: true,
      // Bot konczy proces po bledzie krytycznym (kod 1) - pm2 go podnosi.
      // Rosnace opoznienie (do 15 s) chroni przed mieleniem, gdy np.
      // logowanie nie dziala.
      exp_backoff_restart_delay: 2000,
      // Czas na zamkniecie przegladarki i zwolnienie logs/bot.lock.
      kill_timeout: 10000,
      max_memory_restart: '700M',
    },
    {
      // Health-check co 5 min: pm2, aktywnosc bota, liczba instancji.
      // Alarm na Telegram tylko przy zmianie stanu.
      name: 'Pokebot-health',
      script: 'scripts/healthcheck.js',
      cwd: __dirname,
      env: { NODE_ENV: 'production' },
      cron_restart: '*/5 * * * *',
      autorestart: false,
    },
    {
      // Codzienny raport z logow (anomalie z ostatnich 24 h) na Telegram.
      name: 'Pokebot-logs',
      script: 'scripts/verify-logs.js',
      args: '--since 24h --telegram',
      cwd: __dirname,
      env: { NODE_ENV: 'production' },
      cron_restart: '0 8 * * *',
      autorestart: false,
    },
  ],
};
