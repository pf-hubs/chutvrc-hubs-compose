@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title chutvrc Compose - Windows Setup

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
    echo [ERROR] Docker is not installed.
    echo Please install Docker Desktop for Windows:
    echo   https://docs.docker.com/desktop/setup/install/windows-install/
    echo.
    echo After installing, re-run this script.
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
    echo [ERROR] Git Bash not found.
    echo Please install Git for Windows:
    echo   https://gitforwindows.org/
    echo.
    echo Make sure to select "Git Bash" during installation.
    echo After installing, re-run this script.
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

REM 1.4 mkcert
where mkcert >nul 2>&1
if errorlevel 1 (
    echo   mkcert not found. Attempting to install...
    REM Try Chocolatey
    where choco >nul 2>&1
    if not errorlevel 1 (
        echo   Installing mkcert via Chocolatey...
        choco install mkcert -y
        goto :mkcert_done
    )
    REM Try Scoop
    where scoop >nul 2>&1
    if not errorlevel 1 (
        echo   Installing mkcert via Scoop...
        scoop install mkcert
        goto :mkcert_done
    )
    echo   [ERROR] mkcert is not installed and no package manager found.
    echo   Please install mkcert using one of these methods:
    echo     Option A: Install Chocolatey (https://chocolatey.org/install) then run:
    echo       choco install mkcert
    echo     Option B: Install Scoop (https://scoop.sh/) then run:
    echo       scoop install mkcert
    echo.
    echo   After installing mkcert, re-run this script.
    goto :end
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
    echo   [ERROR] mutagen and/or mutagen-compose not found.
    echo.
    echo   Please install both from the official releases:
    echo     Mutagen:         https://github.com/mutagen-io/mutagen/releases
    echo     Mutagen Compose: https://github.com/mutagen-io/mutagen-compose/releases
    echo.
    echo   Installation steps:
    echo     1. Download the Windows zip for each from the links above
    echo     2. Extract mutagen.exe and mutagen-compose.exe
    echo     3. Place them in a directory that is in your PATH
    echo        (e.g., C:\Program Files\Mutagen\)
    echo     4. Add that directory to your system PATH if needed
    echo.
    echo   IMPORTANT: The Mutagen and Mutagen Compose versions must match.
    echo   Install the latest of both at the same time.
    echo.
    echo   After installing, re-run this script.
    goto :end
)
echo   [OK] mutagen and mutagen-compose installed.

echo.
echo   [OK] All prerequisites satisfied.
echo.

REM -- Phase 2: Hosts file ----------------------------------------------------

echo Phase 2: Configuring hosts file...

findstr /C:"hubs.local" C:\Windows\System32\drivers\etc\hosts >nul 2>&1
if errorlevel 1 (
    echo   Adding hubs.local entries to hosts file...
    echo   This requires administrator privileges. A UAC prompt may appear.
    echo.
    powershell -Command "Start-Process powershell -ArgumentList '-Command \"Add-Content -Path C:\Windows\System32\drivers\etc\hosts -Value \"`n127.0.0.1   hubs.local`n127.0.0.1   hubs-proxy.local\"\"' -Verb RunAs -Wait" 2>nul
    findstr /C:"hubs.local" C:\Windows\System32\drivers\etc\hosts >nul 2>&1
    if errorlevel 1 (
        echo   [WARNING] Could not update hosts file automatically.
        echo   Please manually add these lines to C:\Windows\System32\drivers\etc\hosts:
        echo     127.0.0.1   hubs.local
        echo     127.0.0.1   hubs-proxy.local
        echo.
        echo   To edit the hosts file:
        echo     1. Open Notepad as Administrator
        echo     2. Open C:\Windows\System32\drivers\etc\hosts
        echo     3. Add the two lines above and save
        echo.
    ) else (
        echo   [OK] Hosts file updated.
    )
) else (
    echo   [OK] Hosts file already contains hubs.local entries.
)
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
    echo   [ERROR] Setup encountered an error. Check the Git Bash output above.
    echo   You can re-run this script to retry.
)

:end
echo.
pause
