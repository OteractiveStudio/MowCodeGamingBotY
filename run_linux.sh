#!/usr/bin/env bash
# MowCodeGamingBoteY — start the bot.
#
# The Windows twin of this is run_windows.bat, which is the one Ote actually uses;
# this exists so the project is not Windows-only if it ever moves to a server.
set -euo pipefail
cd "$(dirname "$0")"

echo "============================================================"
echo " MowCodeGamingBoteY"
echo "============================================================"
echo

# ---- one bot at a time ------------------------------------------------------
# Two builds running at once means Discord delivers each interaction to whichever
# answers first, so buttons get handled by code that has never heard of them.
running=$(pgrep -fc "node .*main\.js" || true)
if [ "${running:-0}" -gt 0 ]; then
  echo " [!] ${running} bot process(es) already running."
  echo "     Stop them first, or you will have two bots answering the same server."
  read -r -p "     Start anyway? [y/N] " answer
  case "${answer}" in [yY]*) ;; *) exit 0 ;; esac
  echo
fi

# ---- dependencies -----------------------------------------------------------
if [ ! -d node_modules ]; then
  echo " Installing dependencies (first run)..."
  npm install
  echo
fi

# ---- config -----------------------------------------------------------------
if [ ! -f config.json ]; then
  echo " [X] config.json is missing."
  echo
  echo "     cp config.example.json config.json"
  echo
  echo "     Then fill in discord.token, discord.application_id and the database"
  echo "     section. config.json is gitignored on purpose — the token and the"
  echo "     database password live there and nowhere else."
  exit 1
fi

# ---- schema -----------------------------------------------------------------
# Idempotent: applies only what is pending, prints "up to date" otherwise.
echo " Checking the database schema..."
if ! npm run --silent db:migrate; then
  echo
  echo " [X] The migration failed. Is Postgres running on the port in config.json?"
  exit 1
fi
echo

# ---- go ---------------------------------------------------------------------
echo " Starting the bot. Ctrl+C to stop it."
echo " ------------------------------------------------------------"
echo

# node directly, NOT "npm start": npm runs the bot as a CHILD process, so stopping
# npm can leave the bot alive and connected.
exec node main.js
