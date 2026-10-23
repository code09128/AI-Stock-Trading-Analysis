@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 啟動股票交易分析系統... 關閉此視窗即停止
python run.py
pause
