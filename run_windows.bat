@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo  MowCodeGamingBoteY
echo ============================================================
echo.

REM ---- one bot at a time -------------------------------------------------
REM Two builds running at once means Discord delivers each interaction to
REM whichever answers first, so buttons get handled by code that has never
REM heard of them. It happened with six orphaned processes; the symptom was
REM "That control isn't one I recognise" on freshly drawn buttons.
REM
REM The check uses a PID FILE, not "is any node running main.js", because this
REM machine has other Node projects and a warning that fires for someone
REM else's process is a warning you learn to ignore.
if not exist "logs" mkdir "logs"
if exist "logs\bot.pid" (
  set /p OLDPID=<"logs\bot.pid"
  powershell -NoProfile -Command "if (Get-Process -Id %OLDPID% -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
  if errorlevel 1 (
    echo  [!] A bot from this folder is already running as PID %OLDPID%.
    echo      Run stop_windows.bat first, or you will have two bots
    echo      answering the same server.
    echo.
    choice /c YN /m "Start anyway"
    if errorlevel 2 goto :done
    echo.
  )
)

REM ---- dependencies ------------------------------------------------------
if not exist "node_modules" (
  echo  Installing dependencies ^(first run^)...
  call npm install
  if errorlevel 1 goto :failed
  echo.
)

REM ---- config ------------------------------------------------------------
if not exist "config.json" (
  echo  [X] config.json is missing.
  echo.
  echo      copy config.example.json config.json
  echo.
  echo      Then fill in discord.token, discord.application_id and the
  echo      database section. config.json is gitignored on purpose - the
  echo      token and the database password live there and nowhere else.
  goto :failed
)

REM ---- schema ------------------------------------------------------------
REM Idempotent: applies only what is pending, prints "up to date" otherwise.
echo  Checking the database schema...
call npm run --silent db:migrate
if errorlevel 1 (
  echo.
  echo  [X] The migration failed. Is Postgres running on the port in
  echo      config.json? The bot refuses to start against a schema it
  echo      cannot verify, so fix that first.
  goto :failed
)
echo.

REM ---- go ----------------------------------------------------------------
echo  Starting the bot. Press Ctrl+C to stop it.
echo  ------------------------------------------------------------
echo.

REM node directly, NOT "npm start": npm runs the bot as a CHILD process, so
REM stopping npm can leave the bot alive and still connected to Discord.
REM Running in the foreground also means Ctrl+C reaches the bot itself, which
REM is what triggers its clean shutdown.
REM
REM main.js records its own PID in logs\bot.pid and clears it on exit, so the
REM check above and stop_windows.bat both know which process is ours.
node main.js

echo.
echo  ------------------------------------------------------------
echo  The bot has stopped.
goto :done

:failed
echo.
echo  Did not start.

:done
echo.
pause
endlocal
