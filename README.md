# 台美股看盤與 AI 分析系統

## 啟動
需要 Python 3.10+（只用標準函式庫，不用 pip install）與網路。

```bash
python run.py
```
會自動打開 http://127.0.0.1:8088/ 。Windows 也可雙擊 `啟動.bat`。停止：關閉視窗或按 Ctrl+C。
只開伺服器不開瀏覽器：`python -m src.api_server [埠號]`。服務只綁定 127.0.0.1，僅本機可連。

## 使用
- **看盤**：左側自選股／ETF 精選／我的持股，右側分時圖、五檔、模擬下單。快捷鍵：`/` 搜尋、`↑↓` 切換標的。
- **我的持股**：輸入或貼上 CSV（代號,股數,成本價），即時算損益，並可一鍵送去「組合風控」。
- **設定**：連接雲端 AI（Gemini／OpenAI／Claude）或本地模型（Ollama、LM Studio…），全系統共用；不設定也能用內建規則引擎。
- 其餘分頁：技術分析、新聞判斷、策略回測、組合風控、交易檢討、系統自檢、說明（含新手導覽）。
- 資料來源與真實／範例的區分請看「說明」頁或 `Continu.md`。

## 開發
```bash
python -m unittest discover tests   # 後端測試
npx @biomejs/biome check web        # 前端語法/無障礙檢查
```
可選環境變數：`TRADING_ALLOW_SAMPLE=1`（離線開發時允許使用假資料，預設查不到行情會報錯）、
`FINMIND_TOKEN`、`GEMINI_API_KEY`、`OPENAI_API_KEY`。AI 金鑰只有在「設定」新增對應連線（金鑰欄留空）並選用時才會使用；
選「內建規則引擎」時一律不呼叫 AI。
這些也可以寫在專案根目錄的 `.env`（每行 `KEY=VALUE`，已列入 `.gitignore`），啟動時自動載入，已設定的環境變數優先。
`FINMIND_TOKEN` 設了之後 FinMind 額度由 300 提高到 600 次／小時；token 以 Authorization 標頭送出，不會出現在抓取紀錄。
