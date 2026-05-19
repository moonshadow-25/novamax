@echo off
setlocal EnableDelayedExpansion
title NovaMax
cls

echo ========================================
echo    NovaMax - AI Model Platform
echo ========================================
echo.

set "APP_DIR=%~dp0"
set "APP_DIR=!APP_DIR:~0,-1!"
set NODE_ENV=production

:start
echo Starting service...
echo.
cd /d "!APP_DIR!"
"!APP_DIR!\external\node\node.exe" "!APP_DIR!\backend\dist\index.js"

if exist "!APP_DIR!\data\updates\pending" (
    echo.
    echo [NovaMax Updater] Applying update...
    set /p STAGING=<"!APP_DIR!\data\updates\pending"
    robocopy "!STAGING!" "!APP_DIR!" /E /XD "data" /NFL /NDL /NJH /NJS /R:2 /W:1
    if errorlevel 8 (
        echo [NovaMax Updater] Apply failed (robocopy exit code: !errorlevel!).
        echo [NovaMax Updater] Keep pending marker for retry on next launch.
        pause
        exit /b 1
    )
    del "!APP_DIR!\data\updates\pending" 2>nul
    rmdir /S /Q "!STAGING!" 2>nul
    echo [NovaMax Updater] Done. Restarting...
    goto start
)

echo.
echo Service stopped
pause
