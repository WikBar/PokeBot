// Pomocniczy skrypt: wykrywa TELEGRAM_CHAT_ID na podstawie wiadomości
// wysłanych do bota. Uruchom: npm run telegram:chatid
//
// Wymaga tylko TELEGRAM_BOT_TOKEN w .env oraz wysłania czegokolwiek do bota
// (np. /start) przed uruchomieniem.

require('dotenv').config({
  path: require('path').resolve(__dirname, '..', process.env.NODE_ENV === 'production' ? '.env.production' : '.env'),
});

const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();

async function main() {
  if (!token) {
    console.error('BŁĄD: brak TELEGRAM_BOT_TOKEN w .env');
    console.error('Napisz do @BotFather komendę /newbot, skopiuj token i wklej go do .env');
    process.exit(1);
  }

  const meResponse = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const me = await meResponse.json();
  if (!me.ok) {
    console.error('BŁĄD: token odrzucony przez Telegram —', me.description);
    process.exit(1);
  }
  console.log(`Bot rozpoznany: @${me.result.username}`);

  const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  const data = await response.json();
  if (!data.ok) {
    console.error('BŁĄD pobierania wiadomości:', data.description);
    process.exit(1);
  }

  const chats = new Map();
  for (const update of data.result || []) {
    const chat = update.message?.chat || update.channel_post?.chat;
    if (chat) {
      const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.title || chat.username || '';
      chats.set(chat.id, name);
    }
  }

  if (chats.size === 0) {
    console.log('');
    console.log('Nie znaleziono żadnych wiadomości.');
    console.log(`Otwórz czat z @${me.result.username}, wyślij /start i uruchom skrypt ponownie.`);
    return;
  }

  console.log('');
  console.log('Znalezione czaty — wklej ID do .env jako TELEGRAM_CHAT_ID:');
  for (const [id, name] of chats) {
    console.log(`   TELEGRAM_CHAT_ID=${id}${name ? `   (${name})` : ''}`);
  }
}

main().catch((e) => {
  console.error('BŁĄD:', String(e));
  process.exit(1);
});
