// Ladowany przed testami (node --require): testy nie pisza do logs/
// i nie zasmiecaja konsoli logami bota.
process.env.LOG_TO_FILE = 'false';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
// Bez konfiguracji powiadomien sendNotification nic nie wysyla.
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.CALLMEBOT_APIKEY;
delete process.env.TWILIO_ACCOUNT_SID;
