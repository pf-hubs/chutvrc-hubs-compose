@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title chutvrc Compose - Windows Setup

REM Define ANSI escape character for colored output (Windows 10+)
for /f %%e in ('echo prompt $E ^| cmd') do set "ESC=%%e"

echo.
echo ============================================================
echo   chutvrc Compose - Windows Setup
echo ============================================================
echo.

REM -- Phase 1: Prerequisites -------------------------------------------------

echo Phase 1: Checking prerequisites...
echo.

REM 1.1 Docker Desktop
where docker >nul 2>&1
if errorlevel 1 (
    echo !ESC![91m[ERROR] Docker is not installed.!ESC![0m
    echo !ESC![93mPlease install Docker Desktop for Windows:!ESC![0m
    echo !ESC![93m  https://docs.docker.com/desktop/setup/install/windows-install/!ESC![0m
    echo.
    echo !ESC![93mAfter installing, re-run this script.!ESC![0m
    goto :end
)
docker info >nul 2>&1
if errorlevel 1 (
    echo [WARNING] Docker daemon is not running.
    echo Please start Docker Desktop and wait for it to be ready.
    echo.
    echo Waiting for Docker to start...
    :waitdocker
    timeout /t 3 /nobreak >nul
    docker info >nul 2>&1
    if errorlevel 1 goto :waitdocker
)
echo   [OK] Docker is running.

REM 1.2 Git / Git Bash
set "GIT_BASH="
REM Check common Git Bash locations
if exist "C:\Program Files\Git\bin\bash.exe" (
    set "GIT_BASH=C:\Program Files\Git\bin\bash.exe"
)
if exist "C:\Program Files (x86)\Git\bin\bash.exe" (
    set "GIT_BASH=C:\Program Files (x86)\Git\bin\bash.exe"
)
REM Try to find via PATH
if "!GIT_BASH!"=="" (
    where git >nul 2>&1
    if not errorlevel 1 (
        for /f "delims=" %%G in ('where git') do (
            set "GIT_DIR=%%~dpG"
            if exist "!GIT_DIR!bash.exe" set "GIT_BASH=!GIT_DIR!bash.exe"
            if exist "!GIT_DIR!..\bin\bash.exe" set "GIT_BASH=!GIT_DIR!..\bin\bash.exe"
        )
    )
)
if "!GIT_BASH!"=="" (
    echo !ESC![91m[ERROR] Git Bash not found.!ESC![0m
    echo !ESC![93mPlease install Git for Windows:!ESC![0m
    echo !ESC![93m  https://gitforwindows.org/!ESC![0m
    echo.
    echo !ESC![93mMake sure to select "Git Bash" during installation.!ESC![0m
    echo !ESC![93mAfter installing, re-run this script.!ESC![0m
    goto :end
)
echo   [OK] Git Bash found: !GIT_BASH!

REM 1.3 Configure git line endings
for /f "delims=" %%V in ('git config --global core.autocrlf 2^>nul') do set "AUTOCRLF=%%V"
if not "!AUTOCRLF!"=="false" (
    echo   Setting git core.autocrlf to false...
    git config --global core.autocrlf false
    echo   [OK] git core.autocrlf set to false.
    echo.
    echo   [WARNING] If you already cloned this repository with autocrlf enabled,
    echo   you should delete and re-clone it. Otherwise line endings may cause issues.
    echo.
) else (
    echo   [OK] git core.autocrlf is already false.
)

REM 1.4 mkcert (downloaded directly from GitHub; no admin / package manager needed)
where mkcert >nul 2>&1
if not errorlevel 1 goto :mkcert_done

echo   mkcert not found. Downloading the latest release from GitHub...
set "MKCERT_INSTALL_DIR="
for /f "usebackq tokens=1,* delims==" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bin\install-mkcert.ps1"`) do (
    if /i "%%A"=="INSTALL_DIR" set "MKCERT_INSTALL_DIR=%%B"
)
if not defined MKCERT_INSTALL_DIR goto :mkcert_missing

REM Make the new binary visible to this session (child processes inherit this PATH)
set "PATH=!MKCERT_INSTALL_DIR!;%PATH%"

where mkcert >nul 2>&1
if not errorlevel 1 goto :mkcert_done

:mkcert_missing
echo.
echo   !ESC![91m[WARNING] Automatic mkcert download failed ^(network/proxy issue?^).!ESC![0m
echo   !ESC![93mInstall it manually using one of the options below. Setup will wait.!ESC![0m
echo.
echo   !ESC![93m  Option A ^(manual download, no admin^):!ESC![0m
echo   !ESC![93m    1. Open https://github.com/FiloSottile/mkcert/releases/latest!ESC![0m
echo   !ESC![93m    2. Download mkcert-v*-windows-amd64.exe!ESC![0m
echo   !ESC![93m       ^(or -windows-arm64.exe on ARM machines^)!ESC![0m
echo   !ESC![93m    3. Rename it to mkcert.exe!ESC![0m
echo   !ESC![93m    4. Move it to %LOCALAPPDATA%\mkcert\mkcert.exe!ESC![0m
echo   !ESC![93m       ^(create the mkcert folder if it doesn't exist^)!ESC![0m
echo.
echo   !ESC![93m  Option B ^(Scoop, no admin needed^):!ESC![0m
echo   !ESC![93m    scoop install mkcert!ESC![0m
echo.

:mkcert_wait
echo   Press any key after mkcert is installed to continue ^(or Ctrl+C to abort^)...
pause >nul

REM Make sure this session sees a binary dropped into %LOCALAPPDATA%\mkcert
if exist "%LOCALAPPDATA%\mkcert\mkcert.exe" set "PATH=%LOCALAPPDATA%\mkcert;%PATH%"

where mkcert >nul 2>&1
if errorlevel 1 (
    echo   !ESC![91m  mkcert still not found on PATH.!ESC![0m
    echo   !ESC![93m  Double-check the install location ^(%LOCALAPPDATA%\mkcert\mkcert.exe^) or add its folder to PATH.!ESC![0m
    echo.
    goto :mkcert_wait
)

:mkcert_done
echo   [OK] mkcert installed.

REM 1.5 mutagen and mutagen-compose
set "MUTAGEN_MISSING=0"
where mutagen >nul 2>&1
if errorlevel 1 set "MUTAGEN_MISSING=1"
where mutagen-compose >nul 2>&1
if errorlevel 1 set "MUTAGEN_MISSING=1"

if "!MUTAGEN_MISSING!"=="1" (
    echo.
    echo   !ESC![91m[ERROR] mutagen and/or mutagen-compose not found.!ESC![0m
    echo.
    echo   !ESC![93mPlease install both from the official releases:!ESC![0m
    echo   !ESC![93m  Mutagen:         https://github.com/mutagen-io/mutagen/releases!ESC![0m
    echo   !ESC![93m  Mutagen Compose: https://github.com/mutagen-io/mutagen-compose/releases!ESC![0m
    echo.
    echo   !ESC![93mInstallation steps:!ESC![0m
    echo   !ESC![93m  1. Download the Windows zip for each from the links above!ESC![0m
    echo   !ESC![93m  2. Extract mutagen.exe and mutagen-compose.exe!ESC![0m
    echo   !ESC![93m  3. Place them in a directory that is in your PATH!ESC![0m
    echo   !ESC![93m     ^(e.g., C:\Program Files\Mutagen\^)!ESC![0m
    echo   !ESC![93m  4. Add that directory to your system PATH if needed!ESC![0m
    echo.
    echo   !ESC![93mIMPORTANT: The Mutagen and Mutagen Compose versions must match.!ESC![0m
    echo   !ESC![93mInstall the latest of both at the same time.!ESC![0m
    echo.
    echo   !ESC![93mAfter installing, re-run this script.!ESC![0m
    goto :end
)
echo   [OK] mutagen and mutagen-compose installed.

echo.
echo   [OK] All prerequisites satisfied.
echo.

REM -- Phase 2: Hosts file ----------------------------------------------------

echo Phase 2: Configuring hosts file...

REM Use "hubs-client" as a completeness marker — it was NOT in the older
REM (hubs.local / hubs-proxy.local) versions, so its presence means the hosts
REM file has been updated by the current version of bin\update-hosts.ps1.
findstr /C:"hubs-client" "%WINDIR%\System32\drivers\etc\hosts" >nul 2>&1
if not errorlevel 1 (
    echo   [OK] Hosts file already contains all hubs entries.
    goto :hosts_done
)

:hosts_try
echo   Adding hubs entries to hosts file ^(a UAC prompt will appear^)...
powershell -NoProfile -Command "Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0bin\update-hosts.ps1' -Verb RunAs -Wait"

findstr /C:"hubs-client" "%WINDIR%\System32\drivers\etc\hosts" >nul 2>&1
if not errorlevel 1 (
    echo   [OK] Hosts file updated.
    goto :hosts_done
)

echo.
echo   !ESC![91m[WARNING] Could not update hosts file automatically.!ESC![0m
echo   !ESC![93mSetup cannot proceed without these entries. Please add them manually:!ESC![0m
echo.
echo     127.0.0.1   hubs.local
echo     127.0.0.1   hubs-proxy.local
echo     127.0.0.1   hubs-client
echo     127.0.0.1   hubs-admin
echo     127.0.0.1   spoke
echo     127.0.0.1   dialog
echo.
echo   !ESC![93mOption A - Notepad as Administrator:!ESC![0m
echo     1. Right-click Notepad and choose "Run as administrator"
echo     2. Open %WINDIR%\System32\drivers\etc\hosts
echo     3. Append the six lines above, save, close
echo.
echo   !ESC![93mOption B - Run in an ADMIN PowerShell:!ESC![0m
echo     Add-Content "$env:WinDir\System32\drivers\etc\hosts" "`n127.0.0.1 hubs.local`n127.0.0.1 hubs-proxy.local`n127.0.0.1 hubs-client`n127.0.0.1 hubs-admin`n127.0.0.1 spoke`n127.0.0.1 dialog"
echo.
echo   Press any key once you've updated the hosts file ^(or Ctrl+C to abort^)...
pause >nul

findstr /C:"hubs-client" "%WINDIR%\System32\drivers\etc\hosts" >nul 2>&1
if errorlevel 1 (
    echo   !ESC![91m[ERROR] Required entries still missing from hosts file. Retrying...!ESC![0m
    goto :hosts_try
)
echo   [OK] Hosts file updated.

:hosts_done
echo.

REM -- Phase 3: Run setup via Git Bash ----------------------------------------

echo Phase 3: Running setup via Git Bash...
echo   (This will open a Git Bash window for the remaining steps.)
echo   (The setup may take a while -- please be patient.)
echo.

REM Convert Windows path to Unix-style for Git Bash
set "PROJECT_DIR=%~dp0"
set "PROJECT_DIR=!PROJECT_DIR:\=/!"
REM Remove trailing slash
if "!PROJECT_DIR:~-1!"=="/" set "PROJECT_DIR=!PROJECT_DIR:~0,-1!"

"!GIT_BASH!" --login -c "cd '!PROJECT_DIR!' && source ./local-setup-common.sh && ensure_docker_running && echo '' && run_init && echo '' && generate_certs && echo '' && copy_certs_to_services && echo '' && rebuild_dialog && echo '' && start_services && guided_post_setup"

if errorlevel 1 (
    echo.
    echo   !ESC![91m[ERROR] Setup encountered an error. Check the Git Bash output above.!ESC![0m
    echo   You can re-run this script to retry.
    echo.
    echo   !ESC![93m---- Common issue: mutagen-compose vs Docker Engine 29+ ----!ESC![0m
    echo.
    echo   If the failure happened at "bin/up" with a message like:
    echo.
    echo     !ESC![91munable to process project: unable to query daemon metadata:!ESC![0m
    echo     !ESC![91mError response from daemon:!ESC![0m
    echo.
    echo   ...you've hit the Docker Engine 29 API-version incompatibility.
    echo   mutagen-compose 0.18.1 speaks Docker API 1.43 max, but Docker Engine
    echo   29+ requires clients to speak at least API 1.44. Lower the daemon's
    echo   minimum API version to unblock setup:
    echo.
    echo     1. Right-click the Docker Desktop tray icon ^> Settings
    echo     2. Left sidebar ^> Docker Engine
    echo     3. In the JSON editor on the right, add this key
    echo        ^(merge with the existing JSON object, don't replace it^):
    echo.
    echo          !ESC![96m"min-api-version": "1.43"!ESC![0m
    echo.
    echo     4. Click "Apply ^& restart" and wait for the whale icon to stop animating.
    echo.
    echo   Then in Git Bash ^(to clear any stuck mutagen state^):
    echo     !ESC![96mmutagen daemon stop!ESC![0m
    echo     !ESC![96mbin/up!ESC![0m
    echo.
    echo   Or just re-run this .bat script.
    echo.
    echo   Remove the "min-api-version" override once mutagen-compose ships a
    echo   release with a newer bundled Docker SDK.
)

:end
echo.
pause
