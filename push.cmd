@echo off
chcp 936 >nul
cd /d "%~dp0"
setlocal enabledelayedexpansion

rem ============================================================
rem  One-click publish.
rem
rem  GitHub Pages serves the repo root of the main branch, so
rem  "commit and push" IS the deploy. That is the whole point of
rem  this file: no drag-and-drop upload page, no clicking through
rem  the browser every single time.
rem
rem    push.cmd        normal run
rem    push.cmd dry    show what would be published, then stop
rem
rem  Same hard constraints as start.cmd, because cmd.exe reads a
rem  batch file byte-by-byte under the active code page:
rem  GBK, CRLF, no BOM, ASCII-only comments.
rem  test/startCmd.test.mjs enforces all of it.
rem
rem  Also carried over from start.cmd: never trust "where git".
rem  A command that is merely found proves nothing. Every
rem  candidate is run once for real and the first one that works
rem  is the one used.
rem
rem  Two failures this file exists to absorb, both measured:
rem    1. local and online history sharing no ancestor (first
rem       run, or a folder previously synced by web upload).
rem       git rejects that push outright -> joined here first.
rem    2. the bundled credential helper segfaulting, so the push
rem       never gets past login -> switched to wincred.
rem ============================================================

set "DRY="
if /i "%~1"=="dry" set "DRY=1"

rem ---- 1) a git that actually runs ---------------------------
call :probe git
if not errorlevel 1 goto :git_ok
call :probe "%ProgramFiles%\Git\cmd\git.exe"
if not errorlevel 1 goto :git_ok
call :probe "%ProgramFiles(x86)%\Git\cmd\git.exe"
if not errorlevel 1 goto :git_ok
call :probe "%LOCALAPPDATA%\Programs\Git\cmd\git.exe"
if not errorlevel 1 goto :git_ok
rem Bundled git: the version directory name changes over time,
rem so sort descending and take the first candidate that runs.
for /f "delims=" %%d in ('dir /b /ad /o-n "%USERPROFILE%\.workbuddy\binaries\PortableGit\versions" 2^>nul') do (
  call :probe "%USERPROFILE%\.workbuddy\binaries\PortableGit\versions\%%d\cmd\git.exe"
  if not errorlevel 1 goto :git_ok
)

echo.
echo   [x] 没找到一个能用的 Git，这次推不上去。
echo       装一次 Git for Windows 再双击本文件就行：
echo       https://git-scm.com/download/win
echo.
pause
exit /b 1

:git_ok
echo   Git    %GIT%

rem ---- 2) first run: connect the folder to the remote --------
if exist ".git\HEAD" goto :have_repo
if defined DRY (
  echo   （dry 模式：还没有关联仓库，跳过）
  goto :done
)

echo.
echo   ── 第一次运行，只设置这一次 ──
echo   在浏览器里打开你的仓库页面，把地址栏里的地址复制下来粘贴到下面。
echo   例子：https://github.com/你的用户名/仓库名
echo.
set "REPO="
set /p "REPO=仓库地址: "
if not defined REPO (
  echo.
  echo   [x] 没有输入地址，退出。
  pause
  exit /b 1
)

rem account name, used for the commit identity further down
set "GHUSER="
if not "!REPO:github.com=!"=="!REPO!" (
  set "U=!REPO!"
  set "U=!U:https://github.com/=!"
  set "U=!U:http://github.com/=!"
  set "U=!U:git@github.com:=!"
  set "U=!U:.git=!"
  for /f "tokens=1 delims=/" %%u in ("!U!") do set "GHUSER=%%u"
)
if not defined GHUSER set "GHUSER=somnus"

"%GIT%" init -b main >nul 2>nul
if errorlevel 1 (
  rem git older than 2.28 has no "init -b"
  "%GIT%" init >nul
  "%GIT%" symbolic-ref HEAD refs/heads/main
)
"%GIT%" remote remove origin >nul 2>nul
"%GIT%" remote add origin "!REPO!"
echo   已关联: !REPO!

:have_repo

rem  Store bytes exactly as they are. The bundled git ships
rem  with core.autocrlf=true, which would silently rewrite every
rem  CRLF file on the way in -- start.cmd MUST keep CRLF to stay
rem  runnable -- and would make the first push report hundreds
rem  of phantom modifications.
"%GIT%" config core.autocrlf false

rem  The bundled git ships credential.helper=helper-selector, and
rem  on some machines its Git Credential Manager crashes outright
rem  (measured: exit 139, segfault). The push then dies at the
rem  login step with "could not read Username" and never even
rem  gets to ask. wincred keeps the login in the Windows
rem  credential store and only asks once.
rem
rem  The helper is looked up next to the git we actually launched.
rem  Deliberately NOT via "git --exec-path": that value comes back
rem  through the console code page and a non-ASCII user name (this
rem  machine has one) turns into mojibake, so the path never
rem  resolves. A batch variable keeps the real characters.
rem
rem  When git came from PATH there is no directory to walk up from,
rem  and that is fine: a git on PATH means a real install whose own
rem  helper (Git for Windows ships a working one) should be used.
rem  Nothing here ever overrides a helper the user configured.
set "WINCRED="
if not defined GITDIR goto :cred_done
set "WINCRED=!GITDIR!..\mingw64\bin\git-credential-wincred.exe"
if not exist "!WINCRED!" goto :cred_done
set "CRED="
for /f "usebackq delims=" %%c in (`"%GIT%" config credential.helper 2^>nul`) do set "CRED=%%c"
if not defined CRED set "CRED=none"
if /i "!CRED!"=="helper-selector" goto :cred_set
if /i "!CRED!"=="none" goto :cred_set
goto :cred_done
:cred_set
"%GIT%" config credential.helper wincred
echo.
echo   凭据助手已切到 wincred（原先的 helper-selector 在这台机器上会崩）
echo   第一次推送会要求登录 GitHub，下面这样填：
echo     用户名   你的 GitHub 账号
echo     密码     一个「访问令牌」，不是账号密码
echo   令牌在这里生成：github.com → 头像 → Settings → Developer settings
echo     → Personal access tokens → Tokens (classic) → Generate new token
echo     → 勾上 repo → 生成后复制那串 ghp_ 开头的字符
echo   只会问这一次，之后存在你本机的 Windows 凭据里。
:cred_done

rem ---- 3) which branch does the site live on? ----------------
rem  Ask the remote instead of assuming "main": a repo created
rem  years ago may still use "master".
set "BRANCH="
for /f "usebackq delims=" %%b in (`"%GIT%" config somnus.branch 2^>nul`) do set "BRANCH=%%b"
if defined BRANCH goto :branch_ok
for /f "usebackq tokens=1,2" %%a in (`"%GIT%" ls-remote --symref origin HEAD 2^>nul`) do (
  if "%%a"=="ref:" set "BRANCH=%%b"
)
if defined BRANCH set "BRANCH=!BRANCH:refs/heads/=!"
if not defined BRANCH set "BRANCH=main"
"%GIT%" config somnus.branch "!BRANCH!"
:branch_ok

rem ---- 4) connect the local history to the online one -------
rem  git refuses to push when the two sides share no ancestor.
rem  That happens on the very first run, and again if the
rem  folder was ever synced by uploading through the web UI
rem  instead of by pushing. Both are handled here: fetch, then
rem  move HEAD onto the online commit and let the "add -A"
rem  below re-stage the working tree. --mixed never touches the
rem  files on disk, so nothing can be lost.
rem  FETCH_HEAD is used instead of origin/<branch> on purpose:
rem  it is written by the fetch itself, so this also works when
rem  no remote-tracking ref exists yet.
echo.
echo   正在核对线上已有的内容...
"%GIT%" fetch origin "!BRANCH!" >nul 2>nul
if errorlevel 1 (
  echo   线上还没有 !BRANCH! 分支，这次就是首次推送。
  goto :ident
)
"%GIT%" merge-base HEAD FETCH_HEAD >nul 2>nul
if not errorlevel 1 (
  echo   已与线上同步，本次只推送差异。
  goto :ident
)
echo   本地和线上没有共同历史，先接上线上历史再推（本地文件不受影响）。
"%GIT%" reset --mixed FETCH_HEAD >nul

:ident
rem ---- 5) commit identity -----------------------------------
rem  git refuses to commit without a name and an email. They are
rem  derived from the pasted account so commits land on the right
rem  profile -- but an identity that already exists is never
rem  overwritten.
set "HAVEID="
for /f "usebackq delims=" %%e in (`"%GIT%" config user.email 2^>nul`) do set "HAVEID=1"
if defined HAVEID goto :stage
if not defined GHUSER goto :stage
"%GIT%" config user.name "!GHUSER!"
"%GIT%" config user.email "!GHUSER!@users.noreply.github.com"
echo   提交身份: !GHUSER!  ^<!GHUSER!@users.noreply.github.com^>

:stage
rem ---- 6) stage everything, then report what changed ---------
"%GIT%" add -A
"%GIT%" diff --cached --quiet
if not errorlevel 1 (
  echo.
  echo   没有需要推送的改动，收工。
  goto :done
)

echo.
echo   ── 这次要推送的改动 ──
"%GIT%" diff --cached --stat

set "DELN=0"
for /f "usebackq tokens=1" %%s in (`"%GIT%" diff --cached --name-status`) do (
  if "%%s"=="D" set /a DELN+=1
)
if not "%DELN%"=="0" (
  echo.
  echo   [注意] 有 %DELN% 个线上文件在本地已经不存在，推送后会被删掉。
  echo          如果里面有 README、CNAME 这类不想丢的文件，现在按 Ctrl+C 停下，
  echo          把它们先放回文件夹再重来。
  echo.
  set "ANS="
  set /p "ANS=确认继续？(y/N) "
  if /i not "!ANS!"=="y" goto :done
)

if defined DRY (
  echo.
  echo   （dry 模式：到此为止，没有提交也没有推送）
  goto :done
)

rem ---- 7) bump the service worker version --------------------
rem  sw.js is cache-first. If it does not change, an installed
rem  app keeps serving the OLD js and css forever -- the phone
rem  shows yesterday's app and it looks like the push failed.
rem  Changing the cache name is the only reliable fix, and
rem  forgetting it is a silent bug, so it is done here, always.
rem
rem  Written through PowerShell on purpose: sw.js is UTF-8 with
rem  Chinese comments, and a cmd redirection would rewrite the
rem  file in the console code page and mangle every non-ASCII
rem  byte in it.
set "NEWVER="
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='sw.js';$s=[IO.File]::ReadAllText($p);if($s -match 'VERSION = \x27v(\d+)\x27'){$n=[int]$Matches[1]+1;$s=[Text.RegularExpressions.Regex]::Replace($s,'VERSION = \x27v\d+\x27','VERSION = '+[char]39+'v'+$n+[char]39);[IO.File]::WriteAllText($p,$s,(New-Object Text.UTF8Encoding($false)));Write-Output ('v'+$n)}" > "%TEMP%\somnus-newver.txt" 2>nul
set /p NEWVER=<"%TEMP%\somnus-newver.txt"
if defined NEWVER (
  "%GIT%" add sw.js
  echo.
  echo   sw.js 版本已提到 !NEWVER!，已装机的用户下次打开才会拿到新代码。
) else (
  echo.
  echo   [警告] 没能自动更新 sw.js 的版本号，已装机的用户可能看不到这次更新。
)

rem ---- 8) commit and push -----------------------------------
"%GIT%" commit --quiet -m "update %DATE% %TIME%"
if errorlevel 1 goto :commit_fail

echo.
echo   正在推送...
"%GIT%" push -u origin "!BRANCH!"
if errorlevel 1 goto :push_fail

echo.
echo   ── 推送成功 ──
echo   网页大约 1 分钟后自己更新，等 GitHub Pages 构建完刷新页面就行。
echo   手机上装到桌面的那个图标，要多打开一次才会换到新代码。
echo.
pause
exit /b 0

:commit_fail
echo.
echo   [x] 提交失败，上面是 Git 的原话。这次没有推送到线上，可以放心重来。
echo.
pause
exit /b 1

:push_fail
echo.
echo   [x] 推送失败，上面是 Git 的原话。改动已经提交在本地，修好之后重新双击本文件即可。
echo.
echo   如果卡在登录（提示 could not read Username 或 Authentication failed），
echo   说明这台机器还没有可用的 GitHub 凭据。第一次要登录一次，步骤：
echo.
echo     1. 浏览器打开 github.com，右上角头像 → Settings
echo     2. 左侧最下面 Developer settings → Personal access tokens
echo        → Tokens (classic) → Generate new token (classic)
echo     3. 勾上 repo 这一项，生成后把那串 ghp_ 开头的字符复制下来
echo     4. 回这个窗口重新双击本文件：用户名填你的 GitHub 账号，
echo        密码位置粘贴刚才那串令牌（粘贴时屏幕不显示，是正常的）
echo.
echo   注意：密码位置要粘的是令牌，不是账号密码 —— GitHub 早就不收账号密码了。
echo   令牌只存在你本机的 Windows 凭据里，不会进仓库，也不会被推送出去。
echo.
pause
exit /b 1

:done
echo.
pause
exit /b 0

rem ------------------------------------------------------------
rem  Subroutine: run the candidate once for real and only accept
rem  it if that works. %1 = candidate command or path (quotes get
rem  re-added inside).
rem  Returns 0 = usable and recorded in GIT; 1 = missing / stub
:probe
"%~1" --version >nul 2>nul
if errorlevel 1 exit /b 1
set "GIT=%~1"
set "GITDIR=%~dp1"
exit /b 0
