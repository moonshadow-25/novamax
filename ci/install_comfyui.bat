@echo off
setlocal enabledelayedexpansion

:: ============================================
:: ComfyUI 安装脚本 v2.0（bat 版本）
:: 预打包运行环境，无需 venv / pip install
::
:: 环境变量（由 NovaMax 后端传入）：
::   INSTALL_ROOT    ComfyUI 解压目录
::   PROJECT_ROOT    项目根目录
::   NOVAMAX_RUNTIME_ID         运行时 ID（如 rocm:rdna35）
::   NOVAMAX_SKIP_RUNTIME_DOWNLOAD  1 = 跳过运行时下载
:: ============================================

echo ========================================
echo ComfyUI Installation (v2.0 pre-packaged)
echo ========================================
echo   Install Root: %INSTALL_ROOT%
echo   Runtime ID:   %NOVAMAX_RUNTIME_ID%
echo.

if "%NOVAMAX_SKIP_RUNTIME_DOWNLOAD%"=="1" (
    echo   [OK] 运行时由引擎下载器处理，安装脚本跳过下载/解压
) else (
    echo   [SKIP] 旧版 install 路径，仅写标记
)

:: 写入 .installed 标记
set MARKER_PATH=%INSTALL_ROOT%\.installed
set TS=%DATE:~0,4%-%DATE:~5,2%-%DATE:~8,2%T%TIME:~0,2%:%TIME:~3,2%:%TIME:~6,2%Z
echo {"installed_at":"%TS%","engine":"comfyui","runtime_id":"%NOVAMAX_RUNTIME_ID%","version":"%INSTALL_ROOT%"} > "%MARKER_PATH%"
echo   [OK] .installed marker written

echo.
echo ========================================
echo ComfyUI installation completed!
echo ========================================
endlocal
exit /b 0
