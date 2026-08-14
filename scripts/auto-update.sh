#!/usr/bin/env bash
# Automatyczna aktualizacja bota z GitHuba (odpowiednik Watchtowera dla pm2).
#
# Pobiera zmiany tylko gdy na zdalnej galezi pojawil sie nowy commit,
# instaluje zaleznosci gdy zmienil sie package.json i restartuje proces pm2.
#
# Uzycie (na VPS):
#   chmod +x scripts/auto-update.sh
#   ./scripts/auto-update.sh
#
# Ten sam skrypt obsluguje panel web - wystarcza zmienne srodowiskowe:
#   PROJECT_DIR=/sciezka/do/WebServerPokeBot \
#   UPDATE_BRANCH=master PM2_NAME=Pokebot-dashboard ./scripts/auto-update.sh
#
# Automatycznie co 10 minut (crontab -e):
#   */10 * * * * /sciezka/PokeBot/scripts/auto-update.sh >> /sciezka/PokeBot/logs/auto-update.log 2>&1

set -uo pipefail

# Katalog projektu: z PROJECT_DIR, a domyslnie katalog nadrzedny skryptu.
PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$PROJECT_DIR" || { echo "BLAD: brak katalogu $PROJECT_DIR"; exit 1; }

BRANCH="${UPDATE_BRANCH:-Tests}"
PM2_NAME="${PM2_NAME:-Pokebot}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# Kopia .env i blokada sa osobne dla kazdego projektu (bot / panel).
ENV_BACKUP="/tmp/pokebot-env-$(echo "$PROJECT_DIR" | md5sum | cut -c1-8).bak"
LOCK="/tmp/pokebot-update-$(echo "$PROJECT_DIR" | md5sum | cut -c1-8).lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  log "Aktualizacja juz trwa - pomijam."
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

git fetch origin "$BRANCH" --quiet || { log "BLAD: git fetch nieudany"; exit 1; }

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

if [ "$LOCAL" = "$REMOTE" ]; then
  log "Brak nowych zmian (${LOCAL:0:7})."
  exit 0
fi

log "Nowa wersja: ${LOCAL:0:7} -> ${REMOTE:0:7}"

# .env nie jest w repo, ale chronimy go na wypadek starszych klonow,
# w ktorych byl jeszcze sledzony.
[ -f .env ] && cp .env "$ENV_BACKUP"

# Lokalne zmiany plikow roboczych (config/*.json) blokowalyby merge.
if ! git diff --quiet || ! git diff --cached --quiet; then
  log "Wykryto lokalne zmiany - chowam je (git stash)."
  git stash push --quiet --include-untracked --message "auto-update $(date -Iseconds)"
fi

if ! git merge --ff-only "origin/$BRANCH" --quiet; then
  log "BLAD: nie udalo sie scalic zmian (wymagana reczna interwencja)."
  [ -f "$ENV_BACKUP" ] && cp "$ENV_BACKUP" .env
  exit 1
fi

# Przywracamy .env, gdyby merge go ruszyl.
if [ -f "$ENV_BACKUP" ]; then
  cp "$ENV_BACKUP" .env
  rm -f "$ENV_BACKUP"
fi

# npm install tylko gdy zmienily sie zaleznosci.
if ! git diff --quiet "$LOCAL" "$REMOTE" -- package.json package-lock.json; then
  log "Zmiana zaleznosci - uruchamiam npm install."
  npm install --no-audit --no-fund || log "UWAGA: npm install zglosil blad."
fi

log "Restart procesu pm2: $PM2_NAME"
pm2 restart "$PM2_NAME" --update-env || { log "BLAD: pm2 restart nieudany"; exit 1; }

log "Zaktualizowano do ${REMOTE:0:7}."
