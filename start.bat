@echo off
setlocal
cd /d "%~dp0"

if not defined PORT set PORT=4173

where node >nul 2>nul
if not errorlevel 1 (
  echo Starting Perpetual Bloom at http://localhost:%PORT%
  node server.mjs --open
  exit /b %errorlevel%
)

echo Node.js was not found. Trying the Python fallback...
set "PY="
where py >nul 2>nul
if not errorlevel 1 set "PY=py"
if not defined PY (
  where python >nul 2>nul
  if not errorlevel 1 set "PY=python"
)
if not defined PY (
  echo Node.js 18+ or Python 3 is required. Install one and try again.
  pause
  exit /b 1
)

echo Starting Perpetual Bloom at http://localhost:%PORT%
start "Perpetual Bloom server" %PY% -m http.server %PORT% --bind 127.0.0.1

rem Wait until the server answers, then open the browser. This avoids the
rem blank tab that appears when the browser starts before the server listens.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$u='http://127.0.0.1:%PORT%/'; for($i=0;$i -lt 60;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 1; if($r.StatusCode -ge 200){ exit 0 } } catch {}; Start-Sleep -Milliseconds 250 }; exit 1"
if errorlevel 1 (
  echo The server did not become ready on port %PORT%. Check the server window.
  pause
  exit /b 1
)

start "" "http://localhost:%PORT%/"
exit /b 0
