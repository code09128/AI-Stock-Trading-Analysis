#!/bin/bash
# 股票交易分析系統 - Mac 一鍵打包工具（Windows 用 package.bat）
# 在 Finder 雙擊這個檔案即可；第一次若被擋，按右鍵 →「打開」。
# 第一次要先安裝打包工具：pip3 install -r requirements-desktop.txt
cd "$(dirname "$0")" || exit 1

echo "============================================================"
echo "  股票交易分析系統 - Mac 一鍵打包工具"
echo "============================================================"
echo "正在打包 .app 與 .dmg，請稍候..."
echo

if ! command -v python3 >/dev/null 2>&1; then
  echo "[失敗] 找不到 python3。請先安裝 Python 3.10 以上（https://www.python.org/downloads/macos/）。"
  read -r -p "按 Enter 關閉視窗" _
  exit 1
fi

python3 build_app.py "$@"
status=$?

echo
if [ $status -eq 0 ]; then
  echo "============================================================"
  echo "[成功] 打包完成！產出檔案位於 dist 資料夾："
  echo "  1. dist/股票交易分析系統.app   應用程式（雙擊開啟，可拖到「應用程式」）"
  echo "  2. dist/股票交易分析系統.dmg   安裝映像檔（給別人用）"
  echo "============================================================"
  open dist 2>/dev/null
else
  echo "[失敗] 打包過程發生錯誤，請檢查上方訊息。"
  echo "缺少套件時先執行：pip3 install -r requirements-desktop.txt"
fi
echo
read -r -p "按 Enter 關閉視窗" _
exit $status
