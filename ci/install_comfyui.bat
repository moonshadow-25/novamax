@echo off
setlocal enabledelayedexpansion

:: ============================================
:: ComfyUI 安装脚本（bat 版本）
:: 路径由 NovaMax 后端通过环境变量传入：
::   COMFYUI_ROOT    ComfyUI 解压目录
::   ROCM_PATH       ROCm 环境目录（含 python.exe）
::   MODELS_TARGET   模型目录（将被 junction 链接）
:: ============================================

echo ========================================
echo ComfyUI Auto Installation Script
echo ========================================
echo   ComfyUI Root:  %COMFYUI_ROOT%
echo   ROCm Python:   %ROCM_PATH%\python.exe
echo   Models Target: %MODELS_TARGET%
echo.

set VENV_PATH=%COMFYUI_ROOT%\venv
set VENV_PYTHON=%VENV_PATH%\Scripts\python.exe
set REQUIREMENTS=%COMFYUI_ROOT%\requirements.txt
set MODELS_LINK=%COMFYUI_ROOT%\models

:: [1/4] 检查 ROCm
echo [1/4] Checking ROCm environment...
if not exist "%ROCM_PATH%\python.exe" (
    echo [ERROR] ROCm Python not found: %ROCM_PATH%\python.exe
    exit /b 1
)
echo   [OK] Found: %ROCM_PATH%\python.exe
echo.

:: [2/4] 创建 venv
echo [2/4] Creating virtual environment...
if exist "%VENV_PYTHON%" (
    echo   [SKIP] venv already exists
) else (
    "%ROCM_PATH%\python.exe" -m venv "%VENV_PATH%" --system-site-packages
    if errorlevel 1 ( echo [ERROR] Failed to create venv & exit /b 1 )
    echo   [OK] venv created
)
echo.

:: [3/4] 安装依赖
echo [3/4] Installing dependencies...
if exist "%REQUIREMENTS%" (
    "%VENV_PYTHON%" -m pip install --no-cache-dir -r "%REQUIREMENTS%"
    if errorlevel 1 ( echo [ERROR] Failed to install dependencies & exit /b 1 )
    "%VENV_PYTHON%" -m pip uninstall -y torch torchvision torchaudio 2>nul
    echo   [OK] Dependencies installed, ROCm torch preserved
) else (
    echo   [SKIP] requirements.txt not found
)
echo.

:: [4/4] 链接模型目录
echo [4/4] Setting up models directory junction...
if not exist "%MODELS_TARGET%" mkdir "%MODELS_TARGET%"
if exist "%MODELS_LINK%" (
    dir "%COMFYUI_ROOT%" | findstr /C:"<JUNCTION>" | findstr /C:"models" >nul
    if not errorlevel 1 (
        echo   [SKIP] Junction already exists
        goto done
    )
    rmdir /s /q "%MODELS_LINK%"
)
mklink /J "%MODELS_LINK%" "%MODELS_TARGET%"
if errorlevel 1 ( echo [ERROR] Failed to create junction & exit /b 1 )
echo   [OK] Junction created

:done
echo.
echo ========================================
echo Installation completed successfully!
echo ========================================
endlocal
exit /b 0
