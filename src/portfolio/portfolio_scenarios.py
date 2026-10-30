"""
多情境壓力測試與曝險掃描 (portfolio_scenarios.py)
1. Beta 線性估算：大盤 -10%、-20%
2. 真實歷史期間回放（用你「現在的持股數量」套回當時的真實還權收盤價）：
   - 利率快速上升：2022 年美國聯準會連續升息（2022-01-03 ~ 2022-10-31）
   - 經濟衰退衝擊：2020 年疫情崩跌（2020-02-19 ~ 2020-03-23）
   當時還沒上市的持股不列入，並標示涵蓋比例。
3. 地區曝險（依市場）、產業曝險（台股：TWSE 產業別；美股：Yahoo sector；ETF／債券另列）
4. 高相關持股（近 1 年日報酬相關係數 ≥ 0.7）＝重複押注或隱藏關聯，拋售時容易一起跌
全部用真實資料計算，不呼叫 AI。
"""

from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Tuple

from src.market import etf_data, markets

from src.company import stock_info

from src.portfolio import stress
from src.market.data_adapter import DualMarketDataAdapter

HIST_SCENARIOS = [
    {
        "key": "rate_hike", "name": "利率快速上升", "event": "2022 年聯準會連續升息",
        "start": "2022-01-03", "end": "2022-10-31",
        "why": "升息會壓低成長股與高本益比股票的評價，長天期債券價格也會下跌（股債同跌）。",
    },
    {
        "key": "recession", "name": "經濟衰退衝擊", "event": "2020 年疫情崩跌",
        "start": "2020-02-19", "end": "2020-03-23",
        "why": "景氣急凍時，景氣循環股、高槓桿與高 Beta 標的通常跌最多，短天期公債相對抗跌。",
    },
]
BENCHMARKS = [("^TWII", "加權指數"), ("^GSPC", "S&P 500")]
CORR_HIGH = 0.7
SECTOR_ZH = {
    "Technology": "科技", "Communication Services": "通訊服務", "Consumer Cyclical": "非必需消費",
    "Consumer Defensive": "必需消費", "Financial Services": "金融", "Healthcare": "醫療保健",
    "Industrials": "工業", "Energy": "能源", "Basic Materials": "原物料", "Real Estate": "不動產",
    "Utilities": "公用事業",
}
# 避險／分散方式的取捨（一般性說明，不是個人化建議）
HEDGES = [
    {"name": "提高現金比重", "pros": "最簡單，沒有槓桿、到期或轉倉問題", "cons": "上漲時少賺", "cost": "機會成本"},
    {"name": "加入債券 ETF", "pros": "衰退時公債常抗跌（2020 長天期公債上漲）",
     "cons": "升息時長天期債券也會跌（2022 股債同跌），要看存續期間長短", "cost": "內扣費用、利率風險"},
    {"name": "反向 ETF（如 00632R、SH）", "pros": "不需期貨帳戶，最大損失是投入金額",
     "cons": "每日重設倍數，持有越久越偏離 -1 倍，盤整時會耗損；只適合短期", "cost": "內扣費用較高（約 1% 上下）"},
    {"name": "放空微台指／小台指期貨", "pros": "保證金低、交易成本低，可用口數精準調整避險比例",
     "cons": "每月結算要轉倉；行情上漲時期貨端虧損、可能被追繳保證金；需期貨帳戶", "cost": "手續費、期交稅、轉倉價差"},
    {"name": "買進賣權（Put）", "pros": "最大損失＝權利金，同時保留上漲空間",
     "cons": "時間價值每天流失，沒有下跌就等於白付保費", "cost": "權利金"},
    {"name": "降低集中部位、分散到低相關標的", "pros": "從根本降低單一標的或產業的風險",
     "cons": "可能要賣掉獲利部位；分散後報酬也可能變低", "cost": "交易成本、稅（台股證交稅、美股資本利得稅）"},
]
REGION_LABEL = {"TW": "台灣", "US": "美國", "HK": "香港", "JP": "日本", "UK": "英國", "CN": "中國", "KR": "韓國"}


def _period_closes(symbol: str, start: str, end: str) -> Optional[Dict[str, float]]:
    """start～end 這一段的還權日收盤（只抓回放要用的期間，不下載 10 年）。起點前多抓 14 天，讓 _window 判斷是否已上市。快取 12 小時。"""
    def load():
        ad = DualMarketDataAdapter()
        bars = etf_data.first_bars(symbol, lambda y: ad.fetch_period(y, _shift(start, -14), end))
        return {b.timestamp: b.close for b in bars} if bars else None

    return etf_data._cached(f"period_closes:{symbol}:{start}:{end}", load, ttl=12 * 3600)


def _window(closes: Dict[str, float], start: str, end: str) -> Optional[List[Tuple[str, float]]]:
    pts = sorted((d, v) for d, v in closes.items() if start <= d <= end)
    # 第一筆資料要在起點後 7 天內，否則代表當時還沒上市（或資料缺），不能拿來算
    if len(pts) < 5 or pts[0][0] > _shift(start, 7):
        return None
    return pts


def _shift(day: str, n: int) -> str:
    from datetime import date, timedelta
    return (date.fromisoformat(day) + timedelta(days=n)).isoformat()


def beta_scenarios(total_twd: float, beta: float) -> List[Dict[str, Any]]:
    return [
        {"market_move_pct": -m, "portfolio_move_pct": round(-m * beta, 2), "loss_twd": round(-total_twd * m * beta / 100)}
        for m in (10, 20)
    ]


def replay(holdings: List[Dict[str, Any]], sc: Dict[str, Any]) -> Dict[str, Any]:
    syms = [h["symbol"] for h in holdings] + [b for b, _ in BENCHMARKS]
    with ThreadPoolExecutor(max_workers=6) as ex:
        series = dict(zip(syms, ex.map(lambda s: _period_closes(s, sc["start"], sc["end"]), syms)))
    total = sum(h["value_twd"] for h in holdings) or 1.0
    rows, paths, covered = [], [], 0.0
    for h in holdings:
        pts = _window(series.get(h["symbol"]) or {}, sc["start"], sc["end"])
        if not pts:
            rows.append({"symbol": h["symbol"], "weight_pct": h["weight_pct"], "return_pct": None,
                         "note": "當時尚未上市或查無資料，不列入"})
            continue
        ret = pts[-1][1] / pts[0][1] - 1
        low = min(v for _, v in pts) / pts[0][1] - 1
        rows.append({"symbol": h["symbol"], "weight_pct": h["weight_pct"], "return_pct": round(ret * 100, 2),
                     "worst_pct": round(low * 100, 2)})
        covered += h["value_twd"]
        # 用目前市值當權重：等於「現在這些部位，當時各自漲跌多少」
        paths.append((h["value_twd"], dict(pts)))
    if not paths:
        return {**sc, "available": False, "reason": "持股在這段期間都沒有資料（多半是當時尚未上市）", "rows": rows}

    dates = sorted({d for _, p in paths for d in p})
    first = {id(p): p[min(p)] for _, p in paths}
    last_px: Dict[int, float] = {}
    curve = []
    for d in dates:
        v = 0.0
        for w, p in paths:
            if d in p:
                last_px[id(p)] = p[d]
            v += w * last_px.get(id(p), first[id(p)]) / first[id(p)]
        curve.append(v)
    base = curve[0]
    peak, mdd = base, 0.0
    for v in curve:
        peak = max(peak, v)
        mdd = min(mdd, v / peak - 1)
    port_ret = curve[-1] / base - 1
    bench = []
    for b, name in BENCHMARKS:
        pts = _window(series.get(b) or {}, sc["start"], sc["end"])
        if pts:
            bench.append({"symbol": b, "name": name, "return_pct": round((pts[-1][1] / pts[0][1] - 1) * 100, 2)})
    for r in rows:  # 比組合跌更多＝拋售時拖累最大的部位
        r["drags"] = r["return_pct"] is not None and r["return_pct"] < port_ret * 100 - 5
    return {
        **sc, "available": True,
        "coverage_pct": round(covered / total * 100, 1),
        "portfolio_return_pct": round(port_ret * 100, 2),
        "portfolio_max_drawdown_pct": round(mdd * 100, 2),
        "loss_twd_now": round(covered * port_ret),
        "benchmarks": bench,
        "rows": rows,
    }


def _sector(symbol: str, market: str) -> str:
    def load():
        cat = stock_info.classify(symbol)["category"]
        if cat == "BOND":
            return "債券 ETF"
        if cat == "ETF":
            return "股票 ETF（已在穿透曝險拆解）"
        n = DualMarketDataAdapter.normalize_symbol(symbol)
        if market == "TW":
            ind = stock_info._profile_tw_stock(n["raw_code"]).get("產業別")
            return ind or "未分類（上櫃或查無產業別）"
        sec = stock_info._profile_yahoo(symbol).get("板塊")
        return SECTOR_ZH.get(sec, sec) if sec else "未分類"

    return etf_data._cached(f"sector:{symbol}", load, ttl=24 * 3600) or "未分類"


def exposures(holdings: List[Dict[str, Any]]) -> Dict[str, Any]:
    region: Dict[str, float] = {}
    for h in holdings:
        k = REGION_LABEL.get(h["market"], h["market"])
        region[k] = region.get(k, 0.0) + h["weight_pct"]
    with ThreadPoolExecutor(max_workers=6) as ex:
        secs = list(ex.map(lambda h: _sector(h["symbol"], h["market"]), holdings))
    sector: Dict[str, Dict[str, Any]] = {}
    for h, s in zip(holdings, secs):
        g = sector.setdefault(s, {"weight_pct": 0.0, "symbols": []})
        g["weight_pct"] += h["weight_pct"]
        g["symbols"].append(h["symbol"])
    fmt = lambda d: sorted(({"name": k, "weight_pct": round(v, 2)} for k, v in d.items()), key=lambda x: -x["weight_pct"])  # noqa: E731
    return {
        "region": fmt(region),
        "sector": sorted(({"name": k, "weight_pct": round(v["weight_pct"], 2), "symbols": v["symbols"]}
                          for k, v in sector.items()), key=lambda x: -x["weight_pct"]),
        "note": "地區依交易市場分；美股 ETF 也可能持有海外公司，細節看穿透曝險。產業：台股用 TWSE 產業別、美股用 Yahoo sector。",
    }


def _returns(closes: Dict[str, float], days: List[str]) -> List[Optional[float]]:
    out, prev = [], None
    for d in days:
        v = closes.get(d)
        out.append(v / prev - 1 if v is not None and prev else None)
        if v is not None:
            prev = v
    return out


def _corr(a: List[float], b: List[float]) -> Optional[float]:
    n = len(a)
    if n < 60:
        return None
    ma, mb = sum(a) / n, sum(b) / n
    cov = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((y - mb) ** 2 for y in b)
    return round(cov / (va * vb) ** 0.5, 2) if va and vb else None


def correlated_pairs(holdings: List[Dict[str, Any]]) -> Dict[str, Any]:
    """近 1 年（約 250 個交易日）日報酬相關係數。只比同一市場（不同市場交易時間不同，日報酬對不齊）。"""
    series = {h["symbol"]: stress._closes(h["symbol"]) or {} for h in holdings}
    pairs = []
    for i, a in enumerate(holdings):
        for b in holdings[i + 1:]:
            if a["market"] != b["market"]:
                continue
            days = sorted(set(series[a["symbol"]]) & set(series[b["symbol"]]))[-250:]
            ra, rb = _returns(series[a["symbol"]], days), _returns(series[b["symbol"]], days)
            xy = [(x, y) for x, y in zip(ra, rb) if x is not None and y is not None]
            c = _corr([x for x, _ in xy], [y for _, y in xy])
            if c is not None:
                pairs.append({"a": a["symbol"], "b": b["symbol"], "corr": c, "high": c >= CORR_HIGH,
                              "weight_pct": round(a["weight_pct"] + b["weight_pct"], 2)})
    pairs.sort(key=lambda x: -x["corr"])
    return {
        "pairs": pairs[:10],
        "threshold": CORR_HIGH,
        "note": "相關係數 1＝走勢完全同步、0＝無關、負數＝反向。≥ 0.7 代表這兩檔幾乎一起漲跌，分散效果有限；跨市場不比較。",
    }


def build(holdings: List[Dict[str, Any]], total_twd: float, beta: float) -> Dict[str, Any]:
    with ThreadPoolExecutor(max_workers=3) as ex:
        reps = list(ex.map(lambda sc: replay(holdings, sc), HIST_SCENARIOS))
        exp_f = ex.submit(exposures, holdings)
        cor_f = ex.submit(correlated_pairs, holdings)
    return {
        "beta_scenarios": beta_scenarios(total_twd, beta),
        "historical_scenarios": reps,
        "exposures": exp_f.result(),
        "correlation": cor_f.result(),
        "hedges": HEDGES,
        "index_note": f"台股大盤 {markets.info('TW')['index']}、美股大盤 {markets.info('US')['index']}",
    }
