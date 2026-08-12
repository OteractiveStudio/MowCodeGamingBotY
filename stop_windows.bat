@echo off
setlocal
cd /d "%~dp0"

REM Stops the bot started from THIS folder, and nothing else.
REM
REM It reads logs\bot.pid, which main.js writes on boot and clears on a clean
REM shutdown. Matching on "any node.exe running main.js" would be wrong on a
REM machine with other Node projects - that is how you kill someone else's work.

if not exist "logs\bot.pid" (
  echo No logs\bot.pid - no bot from this folder is recorded as running.
  echo.
  echo If one IS running it was started some other way. List them with:
  echo   powershell "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" ^| ? { $_.CommandLine -like '*main.js*' } ^| Select ProcessId, CommandLine"
  goto :done
)

set /p BOTPID=<"logs\bot.pid"
echo Bot recorded as PID %BOTPID%.

powershell -NoProfile -Command "$id = %BOTPID%; if (-not (Get-Process -Id $id -ErrorAction SilentlyContinue)) { '  Not running any more - clearing the stale pid file.'; exit 0 }; try { Stop-Process -Id $id -Force -ErrorAction Stop; '  Stopped.' } catch { '  Could not stop: ' + $_ }"

del /q "logs\bot.pid" 2>nul

:done
echo.
pause
endlocal
