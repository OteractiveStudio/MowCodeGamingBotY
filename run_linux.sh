#!/usr/bin/env bash
# MowCodeGamingBoteY — start the bot, and restart it when it asks.
#
# The Windows twin of this is run_windows.bat, which is the one Ote actually uses;
# this exists so the project is not Windows-only if it ever moves to a server.
set -uo pipefail
cd "$(dirname "$0")"

echo "============================================================"
echo " MowCodeGamingBoteY"
echo "============================================================"
echo

# ---- one bot at a time ------------------------------------------------------
# Two builds running at once means Discord delivers each interaction to whichever
# answers first, so buttons get handled by code that has never heard of them.
if [ -f logs/bot.pid ] && kill -0 "$(cat logs/bot.pid)" 2>/dev/null; then
  echo " [!] A bot from this folder is already running as PID $(cat logs/bot.pid)."
  echo "     Stop it first, or you will have two bots answering the same server."
  read -r -p "     Start anyway? [y/N] " answer
  case "${answer}" in [yY]*) ;; *) exit 0 ;; esac
  echo
fi

# ---- dependencies -----------------------------------------------------------
if [ ! -d node_modules ]; then
  echo " Installing dependencies (first run)..."
  npm install || exit 1
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
# THIS SCRIPT IS THE SUPERVISOR.
#
# /admin restart does NOT restart the bot itself. The legacy did, with
# os.system("python MCGB_Launcher.py") from inside the running process, which
# blocks the dying parent on its own replacement and leaves it in the process
# tree. Instead the bot exits 42 to mean "start me again", and this loop does it.
#
# MCGB_SUPERVISED tells the bot something is watching. Without it, /admin restart
# refuses rather than exiting into nothing.
#
# ⚠️ NOT `exec node main.js` any more — exec REPLACES this shell, so there would be
# no loop left to do the restarting.
export MCGB_SUPERVISED=1
restarts=0

echo " Starting the bot. Ctrl+C to stop it."
echo " ------------------------------------------------------------"
echo

while true; do
  node main.js
  code=$?

  if [ "${code}" -ne 42 ]; then
    echo
    echo " ------------------------------------------------------------"
    if [ "${code}" -eq 0 ]; then
      echo " The bot has stopped."
    else
      echo " The bot exited with code ${code}."
      echo " Check the newest file in logs/ for what happened."
    fi
    exit "${code}"
  fi

  restarts=$((restarts + 1))
  echo
  echo " ------------------------------------------------------------"
  echo " Restart requested (restart #${restarts}). Starting again..."
  echo " ------------------------------------------------------------"
  echo
  # A brief pause so a restart loop caused by a boot failure cannot spin the CPU.
  sleep 2
done
