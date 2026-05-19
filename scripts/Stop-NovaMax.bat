@echo off
title Stop NovaMax
cls

echo ========================================
echo    Stop NovaMax Service
echo ========================================
echo.

taskkill /FI "WINDOWTITLE eq NovaMax*" /F >nul 2>&1
taskkill /FI "IMAGENAME eq node.exe" /FI "MEMUSAGE gt 50000" /F >nul 2>&1

echo Service stopped
echo.
pause
