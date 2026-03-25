# PokeBot

A bot for automating gameplay on the Polish Pokémon game Pokelife (gra.pokelife.pl) using Playwright.

## Features

- Automated login and adventuring
- Catching and selling Pokémon
- Managing HP and PA (action points)
- Handling activities and events

## Setup

1. Install dependencies: `npm install`
2. Create a `.env` file with your login credentials:
   ```
   POKE1_LOGIN=your_login
   POKE_PASSWORD=your_password
   ```
3. Configure `config.json` for your settings (region, adventure, etc.)
4. Run the bot: `node bot.js`

## Configuration

- `config.json`: Set region, adventure number, Pokémon index, and sellable Pokémon list.
- `locations.json`: Adventure locations and requirements.

## Notes

- Ensure `.env` is not committed to version control.
- The bot runs in headless mode by default.
- Use at your own risk; automated bots may violate game terms.