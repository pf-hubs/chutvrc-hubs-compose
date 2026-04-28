@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title chutvrc Compose - Start

REM Double-click to start chutvrc Compose.
REM Use AFTER local-setup-windows.bat has been run once. Daily start only.

echo.
echo ============================================================
echo   chutvrc Compose - Start
echo ============================================================
echo.

REM Docker check
where docker >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not installed. Run local-setup-windows.bat first.
    pause
    exit /b 1
)
docker info >nul 2>&1
if errorlevel 1 (
    echo [WARNING] Docker daemon is not running. Please start Docker Desktop.
    echo Waiting for Docker to start...
    :waitdocker
    timeout /t 3 /nobreak >nul
    docker info >nul 2>&1
    if errorlevel 1 goto :waitdocker
)

REM Setup check
if not exist ".bin-init-completed" (
    echo [ERROR] Setup not completed yet. Run local-setup-windows.bat first.
    pause
    exit /b 1
)

REM Locate Git Bash
set "GIT_BASH="
if exist "C:\Program Files\Git\bin\bash.exe" set "GIT_BASH=C:\Program Files\Git\bin\bash.exe"
if exist "C:\Program Files (x86)\Git\bin\bash.exe" set "GIT_BASH=C:\Program Files (x86)\Git\bin\bash.exe"
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
    echo [ERROR] Git Bash not found. Install Git for Windows: https://gitforwindows.org/
    pause
    exit /b 1
)

set "PROJECT_DIR=%~dp0"
set "PROJECT_DIR=!PROJECT_DIR:\=/!"
if "!PROJECT_DIR:~-1!"=="/" set "PROJECT_DIR=!PROJECT_DIR:~0,-1!"

echo Starting services with bin/up...
"!GIT_BASH!" --login -c "cd '!PROJECT_DIR!' && bin/up"

echo.
echo Services are starting in the background.
echo   Open: https://hubs.local:4000
echo   Stop: bin/down  (or double-click stop-windows.bat if available)
echo.
pause
