@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================================
echo   股票交易分析系統 - 一鍵打包工具
echo ============================================================
echo 正在打包 資料夾版 與 安裝包 _Setup.exe，請稍候...
echo （要另外產生免安裝單一執行檔：package.bat --portable）
echo.

python build_app.py %*
if errorlevel 1 goto failed

echo.
echo ============================================================
echo [成功] 打包完成！產出檔案位於 dist 資料夾：
echo   1. dist\股票交易分析系統\           資料夾版（自己測試，直接執行裡面的 exe）
echo   2. dist\股票交易分析系統_Setup.exe 一鍵安裝包（給別人用）
if /i "%~1"=="--portable" echo   3. dist\股票交易分析系統.exe       免安裝單一執行檔
echo ============================================================
goto end

:failed
echo.
echo [失敗] 打包過程發生錯誤，請檢查上方訊息。

:end
echo.
pause
