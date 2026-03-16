@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1

set "ROOT=%~dp0"
if "!ROOT:~-1!"=="\" set "ROOT=!ROOT:~0,-1!"

echo.
echo  NovaMax Build Tool
echo  ==================
echo.

:: Read version from backend/package.json
for /f "usebackq tokens=*" %%v in (`powershell -NoProfile -Command "(Get-Content '%ROOT%\backend\package.json' | ConvertFrom-Json).version"`) do set "VERSION=%%v"
echo  Version : !VERSION!

:: Parse mode (first argument)
set "MODE=%~1"
if /i "!MODE!"=="update" goto :update_mode

:: ── Initial Package (default, double-click) ────────────────
:initial_mode
echo  Mode    : Initial Package (full 7z)
echo.
cd /d "!ROOT!\backend"
node build-portable.js
goto :done

:: ── Update Package ─────────────────────────────────────────
:update_mode
echo  Mode    : Update Package (tar.gz + engines.json)
echo.

:: Positional args: 2=notes, 3=min_version
set "ARG_NOTES=%~2"
set "ARG_MINVER=%~3"

:: Interactive prompts for missing required args
if "!ARG_NOTES!"=="" (
    set /p "ARG_NOTES= Release notes : "
)

:: Defaults for optional args
if "!ARG_MINVER!"==""  set "ARG_MINVER=1.0.0"

echo.
echo  Building release directory...
cd /d "!ROOT!\backend"
node build-portable.js
if errorlevel 1 (
    echo.
    echo  ERROR: Build failed, aborting.
    pause
    exit /b 1
)

:: ── Create update tar.gz (exclude data/) ────────────────────
set "RELEASE_DIR=%ROOT%\release"
set "TGZ_NAME=novamax-%VERSION%-update.tar.gz"
set "TGZ_PATH=%ROOT%\%TGZ_NAME%"

if exist "!TGZ_PATH!" del "!TGZ_PATH!"
echo.
echo  Creating !TGZ_NAME!...

:: Primary: Windows built-in tar (Win10 1803+)
where tar >nul 2>&1
if !errorlevel! == 0 (
    tar -czf "!TGZ_PATH!" -C "!RELEASE_DIR!" --exclude="./data" .
    if errorlevel 1 (
        echo  ERROR: tar.gz creation failed.
        pause
        exit /b 1
    )
) else (
    :: Fallback: 7-Zip (two-step: tar then gzip)
    set "SEVENZIP=C:\Program Files\7-Zip\7z.exe"
    if not exist "!SEVENZIP!" (
        echo  ERROR: Neither tar nor 7-Zip found.
        pause
        exit /b 1
    )
    set "TMP_TAR=!ROOT!\_update_tmp.tar"
    if exist "!TMP_TAR!" del "!TMP_TAR!"
    "!SEVENZIP!" a -ttar "!TMP_TAR!" "!RELEASE_DIR!\*" -xr!data >nul
    "!SEVENZIP!" a -tgzip "!TGZ_PATH!" "!TMP_TAR!" >nul
    del "!TMP_TAR!"
)

:: ── Get file size ────────────────────────────────────────────
for /f "usebackq tokens=*" %%s in (`powershell -NoProfile -Command "(Get-Item '%ROOT%\%TGZ_NAME%').Length"`) do set "FILE_SIZE=%%s"

:: ── Get UTC release date ────────────────────────────────────
for /f "usebackq tokens=*" %%d in (`powershell -NoProfile -Command "[DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')"`) do set "RELEASE_DATE=%%d"

echo.
echo  ============================================================
echo   TGZ      : !TGZ_PATH!
echo   Size     : !FILE_SIZE! bytes
echo   MS Path  : !MS_FILE!
echo   JSON     : !ENGINES_JSON!
echo.
echo   Next: upload !TGZ_NAME! to ModelScope repo
echo         shoujiekeji/Novastudio3.0 at path app/
echo  ============================================================

:done
echo.
pause
