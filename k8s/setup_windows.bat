@echo off
:: =============================================================================
:: Hubs Local Setup for Windows
:: Double-click this file to start the setup process.
:: =============================================================================

echo.
echo ======================================
echo   Hubs Local Setup for Windows
echo ======================================
echo.
echo This will set up your Windows PC for running Hubs locally.
echo.
echo IMPORTANT: This requires Administrator privileges.
echo A new window will open requesting permission.
echo.
pause

:: Run PowerShell script as Administrator
powershell -Command "Start-Process powershell -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%~dp0setup_windows.ps1\"' -Verb RunAs"
