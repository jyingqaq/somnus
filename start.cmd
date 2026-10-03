@echo off
chcp 936 >nul
cd /d "%~dp0"

rem ============================================================
rem  Pick a port that actually works.
rem
rem  "Port is LISTENING" != "the service works". Seen once: a process
rem  held 8080 in LISTENING but answered every request with an empty
rem  reply (curl 52), so the browser showed a blank page. Root cause was
rem  never pinned down (suspended process / lost console / started
rem  detached are all possible), but the lesson is solid: an occupied
rem  port is not a working service.
rem
rem  So for a busy port we send a real HTTP request and check the reply
rem  is actually this app:
rem    responds fine -> just open the page (the original behaviour)
rem    does not      -> someone else, or a stuck old server: next port
rem
rem  -----------------------------------------------------------
rem  IMPORTANT: keep every rem / :: comment ASCII-only.
rem  cmd.exe reads a batch file byte-by-byte under chcp 65001 and
rem  mis-parses multi-byte characters. That eats the "rem" prefix and
rem  fragments of the comment get run as commands (measured: 9 errors).
rem  Chinese inside echo is fine; Chinese inside comments is not.
rem  test/startCmd.test.mjs enforces this.
rem ============================================================

set "PORT=8080"
:try_port
netstat -ano | findstr ":%PORT% " | findstr LISTENING >nul 2>nul
if errorlevel 1 goto :free

call :is_ours
if not errorlevel 1 (
  echo.
  echo   服务已经在 %PORT% 端口上跑着了，直接打开页面。
  echo.
  start "" "http://127.0.0.1:%PORT%/index.html"
  timeout /t 3 >nul
  exit /b 0
)

rem Port is held but not answering: name the holder, then move on.
set "STUCK="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr LISTENING') do set "STUCK=%%p"
echo.
echo   注意：%PORT% 端口有程序在监听但连不上，多半是个卡住的旧服务。
if defined STUCK echo        占用进程 PID %STUCK%，要清掉可以执行：taskkill /F /PID %STUCK%
echo        改用一个空闲端口继续启动。

set /a PORT+=1
if %PORT% GTR 8084 (
  echo.
  echo   [x] 8080-8084 都被占用了。先关掉占着的程序，或者把本文件里的
  echo       PORT 起手值改大一点再试。
  echo.
  pause
  exit /b 1
)
goto :try_port

rem ------------------------------------------------------------

:free
rem ============================================================
rem  Pick a Python that actually RUNS -- same lesson as the port above:
rem  "exists" != "works".
rem
rem  Seen once: the user's PATH had no real Python, only the Microsoft
rem  Store python.exe, which is a 0-byte reparse point that does nothing
rem  and exits with 9009 -- yet "where python" happily finds it. The old
rem  code hung its fallback off "where", so the working interpreter was
rem  never reached and double-clicking just printed a "no Python" error.
rem
rem  Now every candidate is really executed once with -c, and only one
rem  that actually runs gets accepted.
rem ============================================================

call :probe python
if not errorlevel 1 goto :py_ok
call :probe py
if not errorlevel 1 goto :py_ok
call :probe python3
if not errorlevel 1 goto :py_ok

rem Bundled interpreter: the version directory name changes over time, so
rem sort descending and take the first candidate that runs.
for /f "delims=" %%d in ('dir /b /ad /o-n "%USERPROFILE%\.workbuddy\binaries\python\versions" 2^>nul') do (
  call :probe "%USERPROFILE%\.workbuddy\binaries\python\versions\%%d\python.exe"
  if not errorlevel 1 goto :py_ok
)

echo.
echo   [x] 没找到一个能用的 Python，起不了本地服务。
echo       装一个 Python（安装时记得勾 Add python.exe to PATH），
echo       或把本文件里 :probe 的候选改成你机器上的解释器路径。
echo.
pause
exit /b 1

:py_ok
echo   Python  %PY%

set "URL=http://127.0.0.1:%PORT%/index.html"
rem Log into %TEMP%: keeps the project dir clean, yet still leaves
rem something to inspect when it breaks. The stuck-port incident left no
rem trace at all, which is exactly why this exists.
set "LOG=%TEMP%\somnus-server.log"
if not defined TEMP set "LOG=nul"

echo.
echo   AI 写作 App
echo   地址  %URL%
echo   日志  %LOG%
echo.
echo   这个窗口别关，关掉服务就停了。
echo   手机想用同一个地址访问，把下面的 --bind 127.0.0.1 改成 --bind 0.0.0.0，
echo   再用手机连同一个 Wi-Fi 打开 http://电脑IP:%PORT%/ 。
echo.

start "" "%URL%"

rem Server output is redirected to the log file rather than the console:
rem if the console disappears the process may misbehave, and nothing
rem would be recorded either way.
"%PY%" -m http.server %PORT% --bind 127.0.0.1 >> "%LOG%" 2>&1

pause
exit /b 0

rem ------------------------------------------------------------
rem  Subroutine: is the thing on %PORT% really this app? Sends a real
rem  request instead of trusting the port state.
rem  Returns 0 = this app and responding; 1 = other app / stuck / no curl
:is_ours
where curl >nul 2>nul || exit /b 1
curl -fs --max-time 3 "http://127.0.0.1:%PORT%/index.html" 2>nul | findstr /c:"somnus" >nul
exit /b %errorlevel%

rem ------------------------------------------------------------
rem  Subroutine: run the candidate interpreter once for real and only
rem  accept it if that works. %1 = candidate command or path (quotes get
rem  re-added inside).
rem  Returns 0 = usable and recorded in PY; 1 = missing / stub / unusable
:probe
"%~1" -c "pass" >nul 2>nul
if errorlevel 1 exit /b 1
set "PY=%~1"
exit /b 0
