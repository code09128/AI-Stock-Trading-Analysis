"""
產業鏈資料連網檢查 (tools/check_chains.py)：改完 src/market/chain_data.py 後執行。
  python tools/check_chains.py          # 台股（chain_data.py）
  python tools/check_chains.py --us     # 美股（chain_data_us.py）：每檔都要查得到 Yahoo 即時報價
核對每一檔股票的代號是否存在、簡稱是否對得上（上市櫃清單來自 FinMind 公開資料，不需金鑰）。
另外列出「同一檔出現在很多條鏈」與「產業別拼錯」的提醒。有錯誤時結束碼為 1。
離線的結構檢查（連線方向、重複代號…）在 tests/test_industry_map.py。
"""

import json
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src.market import chain_data  # noqa: E402

URL = "https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo"


def fetch_names():
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        rows = json.load(r)["data"]
    names = {}
    for row in rows:
        names.setdefault(str(row["stock_id"]), set()).add(str(row["stock_name"]))
    return names


def same(a, b):
    """簡稱常有差異（「台灣光罩」vs「光罩」），其中一個包含另一個就算對得上。"""
    return a in b or b in a


def main_us():
    """美股鏈：每個代號（含類股 ETF）都要有 Yahoo 報價。逐檔、每檔隔 0.5 秒，連續 3 次連線失敗就停（不是代號的問題，別再送）。"""
    from src.market import chain_data_us as us
    from src.market import quote_provider as qp
    from src.market.data_adapter import DualMarketDataAdapter as D

    errors, warnings, use = 0, 0, {}
    layout_names = {n for col in us.LAYOUT for n in col}
    for chain in us.CHAINS:
        if chain["sector"] not in layout_names:
            print(f"[錯誤] {chain['id']}：產業別「{chain['sector']}」不在 LAYOUT 裡")
            errors += 1
        for node in chain["nodes"]:
            for code, _name in node["stocks"]:
                use.setdefault(code, []).append(chain["id"])
    for sector, etf in us.SECTOR_ETF.items():
        use.setdefault(etf, []).append(f"類股「{sector}」")
    unreachable, conn_fail = [], 0
    codes = sorted(use)
    for i, code in enumerate(codes):
        q = qp.fetch_us_quote(D.normalize_symbol(code), {})
        if q.get("price") is None or q.get("change_pct") is None:
            if "查無" in str(q.get("error")):
                print(f"[錯誤] {'、'.join(use[code])}：{code} Yahoo 查無此代號（可能已下市、改名或代號寫錯）")
                errors += 1
            else:
                unreachable.append(code)
                conn_fail += 1
                if conn_fail >= 3:
                    unreachable += codes[i + 1:]
                    print("[提醒] Yahoo 連續連線失敗，已停止送出剩下的請求，請稍後重跑")
                    break
        else:
            conn_fail = 0
        time.sleep(0.5)
    if unreachable:
        print(f"[提醒] {len(unreachable)} 檔因連線失敗或無報價沒能確認：{'、'.join(unreachable[:10])}")
        warnings += 1
    total = sum(len(n["stocks"]) for c in us.CHAINS for n in c["nodes"])
    print(f"\n檢查 {len(us.CHAINS)} 條美股鏈、{total} 個個股欄位（{len(codes)} 個不重複代號，含 {len(us.SECTOR_ETF)} 檔類股 ETF）：錯誤 {errors}、提醒 {warnings}")
    return 1 if errors else 0


def main():
    names = fetch_names()
    errors, warnings, use = 0, 0, {}
    layout_names = {n for col in chain_data.LAYOUT for n in col}
    for chain in chain_data.CHAINS:
        if chain["sector"] not in layout_names:
            print(f"[錯誤] {chain['id']}：產業別「{chain['sector']}」不在 LAYOUT 裡")
            errors += 1
        for node in chain["nodes"]:
            for code, name in node["stocks"]:
                use.setdefault(code, []).append(chain["id"])
                got = names.get(code)
                if not got:
                    print(f"[錯誤] {chain['id']}/{node['id']}：查無代號 {code}（{name}）")
                    errors += 1
                elif not any(same(name, g) for g in got):
                    print(f"[錯誤] {chain['id']}/{node['id']}：{code} 檔案寫「{name}」，清單是「{'、'.join(sorted(got))}」")
                    errors += 1
    # FinMind 的清單會留著已下市／合併的舊代號，所以再用證交所即時行情確認每一檔真的查得到。
    # 分批、批間暫停，避免一次打太多被證交所斷線；連線失敗只提醒（不是代號有問題），「查無此代號」才算錯誤。
    import time
    from src.market import quote_provider as qp
    codes, unreachable = sorted(use), []
    for i in range(0, len(codes), 20):
        batch_bad = 0
        for q in qp.get_quotes(codes[i:i + 20], {}):
            code = q["symbol"].split(".")[0]
            if q.get("price") is not None:
                continue
            if "查無" in str(q.get("error")):
                print(f"[錯誤] {'、'.join(use[code])}：{code} 證交所行情查無（可能已下市或合併）")
                errors += 1
            else:
                unreachable.append(code)
                batch_bad += 1
        if batch_bad >= 10:  # 這一批大半連不上＝很可能被證交所擋了：立刻停，剩下的不再送，避免越打越糟
            unreachable += codes[i + 20:]
            print("[提醒] 證交所連線連續失敗，已停止送出剩下的請求，請隔幾小時再重跑")
            break
        time.sleep(5)
    if unreachable:
        print(f"[提醒] {len(unreachable)} 檔因證交所連線失敗或無報價沒能確認，稍後重跑：{'、'.join(unreachable[:10])}")
        warnings += 1
    for code, ids in sorted(use.items()):
        if len(ids) >= 4:
            print(f"[提醒] {code} 出現在 {len(ids)} 條鏈（{'、'.join(ids)}）")
            warnings += 1
    total = sum(len(n["stocks"]) for c in chain_data.CHAINS for n in c["nodes"])
    print(f"\n檢查 {len(chain_data.CHAINS)} 條鏈、{total} 個個股欄位（{len(use)} 檔不重複）：錯誤 {errors}、提醒 {warnings}")
    return 1 if errors else 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows 終端機預設編碼會讓中文變亂碼
    except Exception:
        pass
    sys.exit(main_us() if "--us" in sys.argv[1:] else main())
