@echo off
REM Double-click to install or start chutvrc with a graphical installer.
REM local-setup-windows.bat does the same in a terminal.
set "CHUTVRC_INSTALLER=%~dp0bin\setup-gui.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-STA','-File',('\"{0}\"' -f $env:CHUTVRC_INSTALLER))"
