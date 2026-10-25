"""
回測策略清單 (strategies.py)
每支策略都是「只用到當天收盤為止的資料」產生訊號：1＝買進、-1＝賣出、0＝無；
訊號當天收盤確認，由回測引擎在隔天開盤成交，所以不會偷看未來。
- 參數定義（PARAMS）讓前端自動產生表單、後端檢查範圍
- GRID 是前後段驗證要掃的兩個參數；HEATMAP 是參數熱力圖的兩軸（格子比較細）
- needs：策略需要的額外資料（台股籌碼／月營收，來自 FinMind），由呼叫端用 BarSeries 附在日 K 上
"""

from typing import Any, Callable, Dict, List, Optional

from src.market.bar import Bar
from src.technical.indicators import calculate_ma


class BarSeries(list):
    """日 K 串列＋對齊好的額外資料（extra["inst"][i] 是第 i 根 K 棒當天的值）。
    驗證、熱力圖都是「整段算訊號、再切段成交」，所以切片後變回一般 list 也沒關係。"""

    def __init__(self, bars: List[Bar], extra: Dict[str, List[Any]]):
        super().__init__(bars)
        self.extra = extra


def _extra(bars: List[Bar], name: str) -> List[Any]:
    data = getattr(bars, "extra", None)
    if not data or name not in data:
        raise ValueError("這支策略需要台股籌碼／月營收資料（FinMind），資料沒有載入")
    return data[name]


def _p(key: str, label: str, default: float, lo: float, hi: float, tip: str, integer: bool = True) -> Dict[str, Any]:
    return {"key": key, "label": label, "default": default, "lo": lo, "hi": hi, "integer": integer, "tip": tip}


def kd_values(bars: List[Bar], n: int = 9) -> Dict[str, List[Optional[float]]]:
    """台灣常用 KD（9,3,3）：RSV＝(收盤－n 日最低)／(n 日最高－n 日最低)，K＝⅔K前＋⅓RSV，D＝⅔D前＋⅓K，起始值 50。"""
    ks: List[Optional[float]] = [None] * len(bars)
    ds: List[Optional[float]] = [None] * len(bars)
    k = d = 50.0
    for i in range(n - 1, len(bars)):
        win = bars[i - n + 1:i + 1]
        lo, hi = min(b.low for b in win), max(b.high for b in win)
        rsv = 50.0 if hi == lo else (bars[i].close - lo) / (hi - lo) * 100
        k = k * 2 / 3 + rsv / 3
        d = d * 2 / 3 + k / 3
        ks[i], ds[i] = k, d
    return {"k": ks, "d": ds}


def ma_cross(bars: List[Bar], p: Dict[str, Any]) -> List[int]:
    """短均線上穿長均線＝買進，跌回長均線下方＝賣出。"""
    closes = [b.close for b in bars]
    fast, slow = calculate_ma(closes, int(p["fast_ma"])), calculate_ma(closes, int(p["slow_ma"]))
    sig, in_pos = [0] * len(bars), False
    for i in range(1, len(bars)):
        if None in (fast[i], slow[i], fast[i - 1], slow[i - 1]):
            continue
        if not in_pos and fast[i] > slow[i] and fast[i - 1] <= slow[i - 1]:
            sig[i], in_pos = 1, True
        elif in_pos and fast[i] < slow[i]:
            sig[i], in_pos = -1, False
    return sig


def kd_cross(bars: List[Bar], p: Dict[str, Any]) -> List[int]:
    """K 在低檔（低於門檻）由下往上穿過 D＝買進；K 由上往下穿過 D＝賣出。"""
    kd = kd_values(bars, int(p["kd_n"]))
    k, d = kd["k"], kd["d"]
    sig, in_pos = [0] * len(bars), False
    for i in range(1, len(bars)):
        if None in (k[i], d[i], k[i - 1], d[i - 1]):
            continue
        if not in_pos and k[i] > d[i] and k[i - 1] <= d[i - 1] and k[i - 1] < p["buy_below"]:
            sig[i], in_pos = 1, True
        elif in_pos and k[i] < d[i] and k[i - 1] >= d[i - 1]:
            sig[i], in_pos = -1, False
    return sig


def ma_align(bars: List[Bar], p: Dict[str, Any]) -> List[int]:
    """短＞中＞長均線、收盤站上短均線（多頭排列成形）＝買進；收盤跌破中均線＝賣出。"""
    closes = [b.close for b in bars]
    s, m, l = (calculate_ma(closes, int(p[k])) for k in ("short_ma", "mid_ma", "long_ma"))
    sig, in_pos = [0] * len(bars), False
    for i in range(1, len(bars)):
        if None in (s[i], m[i], l[i], s[i - 1], m[i - 1], l[i - 1]):
            continue
        now = s[i] > m[i] > l[i] and closes[i] > s[i]
        before = s[i - 1] > m[i - 1] > l[i - 1] and closes[i - 1] > s[i - 1]
        if not in_pos and now and not before:
            sig[i], in_pos = 1, True
        elif in_pos and closes[i] < m[i]:
            sig[i], in_pos = -1, False
    return sig


def volume_breakout(bars: List[Bar], p: Dict[str, Any]) -> List[int]:
    """收盤創 N 日新高、且成交量大於 N 日均量的倍數＝買進；收盤跌破出場均線＝賣出。"""
    n, exit_n = int(p["lookback"]), int(p["exit_ma"])
    closes = [b.close for b in bars]
    vols = [b.volume for b in bars]
    vol_ma, exit_ma = calculate_ma(vols, n), calculate_ma(closes, exit_n)
    sig, in_pos = [0] * len(bars), False
    for i in range(n, len(bars)):
        if vol_ma[i - 1] is None or exit_ma[i] is None:
            continue
        if not in_pos:
            if closes[i] > max(closes[i - n:i]) and vols[i] > vol_ma[i - 1] * p["vol_mult"]:
                sig[i], in_pos = 1, True
        elif closes[i] < exit_ma[i]:
            sig[i], in_pos = -1, False
    return sig


def bias_revert(bars: List[Bar], p: Dict[str, Any]) -> List[int]:
    """乖離率＝(收盤－均線)／均線。跌到負乖離門檻以下＝買進（超跌），回到出場乖離以上＝賣出。"""
    closes = [b.close for b in bars]
    ma = calculate_ma(closes, int(p["ma"]))
    sig, in_pos = [0] * len(bars), False
    for i in range(len(bars)):
        if not ma[i]:
            continue
        bias = (closes[i] - ma[i]) / ma[i] * 100
        if not in_pos and bias <= -abs(p["entry_bias"]):
            sig[i], in_pos = 1, True
        elif in_pos and bias >= p["exit_bias"]:
            sig[i], in_pos = -1, False
    return sig


def gap_up(bars: List[Bar], p: Dict[str, Any]) -> List[int]:
    """當天最低價高於前一天最高價至少 X%（向上跳空）且量增＝買進；收盤跌回缺口下緣（缺口被回補）＝賣出。"""
    n = 20
    vols = [b.volume for b in bars]
    vol_ma = calculate_ma(vols, n)
    sig, in_pos, gap_floor = [0] * len(bars), False, 0.0
    for i in range(1, len(bars)):
        prev, cur = bars[i - 1], bars[i]
        if not in_pos:
            if (prev.high > 0 and cur.low > prev.high * (1 + p["min_gap_pct"] / 100)
                    and vol_ma[i - 1] and cur.volume > vol_ma[i - 1]):
                sig[i], in_pos, gap_floor = 1, True, prev.high
        elif cur.close < gap_floor:
            sig[i], in_pos = -1, False
    return sig


def inst_buy(bars: List[Bar], p: Dict[str, Any]) -> List[int]:
    """三大法人合計連續 N 天買超＝買進；連續 M 天賣超＝賣出。沒有資料的日子中斷連續天數。"""
    net = _extra(bars, "inst")
    n, m = int(p["days"]), int(p["exit_days"])
    sig, in_pos, up, down = [0] * len(bars), False, 0, 0
    for i, v in enumerate(net):
        up = up + 1 if v is not None and v > 0 else 0
        down = down + 1 if v is not None and v < 0 else 0
        if not in_pos and up >= n:
            sig[i], in_pos = 1, True
        elif in_pos and down >= m:
            sig[i], in_pos = -1, False
    return sig


def revenue_high(bars: List[Bar], p: Dict[str, Any]) -> List[int]:
    """新公布的月營收是近 N 個月最高、且比去年同月成長＝買進；收盤跌破出場均線，或新公布的月營收年減＝賣出。"""
    rev = _extra(bars, "revenue")
    n = int(p["lookback"])
    exit_ma = calculate_ma([b.close for b in bars], int(p["exit_ma"]))
    sig, in_pos = [0] * len(bars), False
    for i in range(1, len(bars)):
        r = rev[i]
        new = r is not None and (rev[i - 1] is None or rev[i - 1]["month"] != r["month"])
        if not in_pos:
            if new and len(r["history"]) >= n and r["revenue"] >= max(r["history"][-n:]) \
                    and r["yoy_pct"] is not None and r["yoy_pct"] > 0:
                sig[i], in_pos = 1, True
        elif (exit_ma[i] is not None and bars[i].close < exit_ma[i]) or \
                (new and r["yoy_pct"] is not None and r["yoy_pct"] < 0):
            sig[i], in_pos = -1, False
    return sig


def margin_down(bars: List[Bar], p: Dict[str, Any]) -> List[int]:
    """融資餘額 N 天內減少 X% 以上、且收盤站上均線（籌碼從散戶流出、股價仍強）＝買進；
    收盤跌破均線，或融資 N 天內反而增加 X% 以上＝賣出。"""
    mg = _extra(bars, "margin")
    n, x = int(p["days"]), float(p["drop_pct"]) / 100
    ma = calculate_ma([b.close for b in bars], int(p["ma"]))
    sig, in_pos = [0] * len(bars), False
    for i in range(n, len(bars)):
        now, before = mg[i], mg[i - n]
        if now is None or not before or ma[i] is None:
            continue
        chg = now / before - 1
        if not in_pos and chg <= -x and bars[i].close > ma[i]:
            sig[i], in_pos = 1, True
        elif in_pos and (bars[i].close < ma[i] or chg >= x):
            sig[i], in_pos = -1, False
    return sig


STRATEGIES: Dict[str, Dict[str, Any]] = {
    "ma_cross": {
        "label": "雙均線交叉",
        "kind": "趨勢",
        "rule": "短均線由下往上穿過長均線買進；短均線跌回長均線下方賣出。",
        "fn": ma_cross,
        "params": [
            _p("fast_ma", "短均線", 5, 2, 250, "短均線上穿長均線＝買進（黃金交叉）。"),
            _p("slow_ma", "長均線", 20, 3, 250, "必須大於短均線。"),
        ],
        "grid": {"fast_ma": (3, 5, 10, 20), "slow_ma": (20, 30, 60, 120)},
        "heatmap": {"fast_ma": (3, 5, 8, 10, 13, 20), "slow_ma": (20, 30, 40, 60, 90, 120)},
    },
    "kd_cross": {
        "label": "KD 低檔黃金交叉",
        "kind": "擺盪",
        "rule": "K 值在門檻以下時由下往上穿過 D 值買進；K 值往下穿過 D 值賣出。KD 採台灣常用 (9,3,3)。",
        "fn": kd_cross,
        "params": [
            _p("kd_n", "KD 天數", 9, 5, 30, "RSV 用幾天的最高、最低價計算，台灣常用 9。"),
            _p("buy_below", "買進 K 值門檻", 50, 10, 90, "只在 K 值低於這個數字時的黃金交叉才買，避開高檔追價。"),
        ],
        "grid": {"kd_n": (5, 9, 14, 20), "buy_below": (20, 30, 50, 80)},
        "heatmap": {"kd_n": (5, 7, 9, 12, 14, 20), "buy_below": (20, 30, 40, 50, 60, 80)},
    },
    "ma_align": {
        "label": "均線多頭排列",
        "kind": "趨勢",
        "rule": "短均線＞中均線＞長均線、且收盤站上短均線時買進；收盤跌破中均線賣出。",
        "fn": ma_align,
        "params": [
            _p("short_ma", "短均線", 5, 2, 60, "例如 5 日線（週線）。"),
            _p("mid_ma", "中均線", 20, 5, 120, "例如 20 日線（月線），也是出場線；要大於短均線。"),
            _p("long_ma", "長均線", 60, 20, 250, "例如 60 日線（季線），要大於中均線。"),
        ],
        "grid": {"short_ma": (3, 5, 10, 20), "mid_ma": (20, 30, 40, 60)},
        "heatmap": {"short_ma": (3, 5, 8, 10, 13, 20), "mid_ma": (15, 20, 25, 30, 40, 50)},
    },
    "volume_breakout": {
        "label": "量價突破",
        "kind": "突破",
        "rule": "收盤創 N 日新高、且成交量大於 N 日均量的倍數時買進；收盤跌破出場均線賣出。",
        "fn": volume_breakout,
        "params": [
            _p("lookback", "突破天數 N", 20, 5, 120, "收盤要高於前 N 天的最高收盤。"),
            _p("vol_mult", "量能倍數", 1.5, 1.0, 5.0, "成交量要大於前 N 日均量的幾倍，代表有資金推動。", integer=False),
            _p("exit_ma", "出場均線", 10, 3, 60, "收盤跌破這條均線就出場。"),
        ],
        "grid": {"lookback": (10, 20, 40, 60), "vol_mult": (1.2, 1.5, 2.0, 3.0)},
        "heatmap": {"lookback": (10, 15, 20, 30, 40, 60), "vol_mult": (1.0, 1.2, 1.5, 2.0, 2.5, 3.0)},
    },
    "bias_revert": {
        "label": "乖離率回歸",
        "kind": "逆勢",
        "rule": "股價跌離均線超過門檻（超跌）時買進，回到均線附近賣出。適合盤整盤，空頭時容易越跌越買；"
                "超跌常發生在大盤下跌時，開啟大盤濾網會擋掉大部分訊號。",
        "fn": bias_revert,
        "params": [
            _p("ma", "均線天數", 20, 5, 120, "乖離率以這條均線為基準。"),
            _p("entry_bias", "進場負乖離 %", 8, 1, 30, "股價低於均線幾 % 才買，例如 8＝比均線低 8%。", integer=False),
            _p("exit_bias", "出場乖離 %", 0, -10, 20, "乖離回到幾 % 以上賣出，0＝回到均線。", integer=False),
        ],
        "grid": {"ma": (10, 20, 40, 60), "entry_bias": (4, 6, 8, 12)},
        "heatmap": {"ma": (10, 20, 30, 40, 60, 90), "entry_bias": (3, 4, 6, 8, 10, 12)},
    },
    "gap_up": {
        "label": "跳空缺口",
        "kind": "突破",
        "rule": "當天最低價高於前一天最高價（向上跳空）、且量大於 20 日均量時買進；收盤跌回缺口下緣（缺口被回補）賣出。",
        "fn": gap_up,
        "params": [
            _p("min_gap_pct", "最小缺口 %", 1, 0, 10, "缺口至少要多大才算，0＝只要有跳空就算。", integer=False),
        ],
        "grid": {"min_gap_pct": (0, 0.5, 1, 2, 3)},
        "heatmap": {"min_gap_pct": (0, 0.5, 1, 1.5, 2, 3)},
    },
    "inst_buy": {
        "label": "法人連買",
        "kind": "籌碼",
        "rule": "三大法人（外資＋投信＋自營商）合計連續 N 天買超時買進；連續 M 天賣超時賣出。法人資料當天收盤後公布，隔天開盤成交。只支援台股。",
        "fn": inst_buy,
        "needs": ("inst",),
        "params": [
            _p("days", "連續買超天數 N", 3, 1, 20, "法人合計連續幾天買超才進場。"),
            _p("exit_days", "連續賣超天數 M", 2, 1, 20, "法人合計連續幾天賣超就出場。"),
        ],
        "grid": {"days": (2, 3, 5, 8), "exit_days": (1, 2, 3, 5)},
        "heatmap": {"days": (1, 2, 3, 4, 5, 8), "exit_days": (1, 2, 3, 4, 5, 8)},
    },
    "revenue_high": {
        "label": "月營收創新高",
        "kind": "基本面",
        "rule": "新公布的月營收是近 N 個月最高、且比去年同月成長時買進；收盤跌破出場均線、或新公布的月營收年減時賣出。"
                "月營收一律從次月 10 日（法定公布期限）起才算已知，不會偷看未來。只支援台股。",
        "fn": revenue_high,
        "needs": ("revenue",),
        "params": [
            _p("lookback", "比較月數 N", 12, 3, 36, "新公布的月營收要是近幾個月的最高，12＝近一年新高。"),
            _p("exit_ma", "出場均線", 60, 10, 120, "收盤跌破這條均線就出場，例如 60 日季線。"),
        ],
        "grid": {"lookback": (6, 12, 18, 24), "exit_ma": (20, 40, 60, 120)},
        "heatmap": {"lookback": (6, 9, 12, 18, 24, 36), "exit_ma": (20, 30, 40, 60, 90, 120)},
    },
    "margin_down": {
        "label": "融資減少",
        "kind": "籌碼",
        "rule": "融資餘額 N 天內減少 X% 以上、且收盤站上均線（散戶退場、股價仍強）時買進；收盤跌破均線、或融資 N 天內反而增加 X% 以上時賣出。只支援台股（有融資的股票）。",
        "fn": margin_down,
        "needs": ("margin",),
        "params": [
            _p("days", "比較天數 N", 10, 3, 60, "融資餘額和幾天前比較。"),
            _p("drop_pct", "融資變化 %", 5, 1, 30, "減少超過這個 % 才算「融資減少」；增加超過這個 % 就出場。", integer=False),
            _p("ma", "均線天數", 20, 5, 120, "收盤要站上這條均線才進場，跌破就出場。"),
        ],
        "grid": {"days": (5, 10, 20, 40), "drop_pct": (3, 5, 8, 12)},
        "heatmap": {"days": (5, 10, 15, 20, 30, 40), "drop_pct": (2, 3, 5, 8, 10, 15)},
    },
}


def catalog() -> List[Dict[str, Any]]:
    """給前端的策略清單（不含函式）。"""
    return [{"key": k, **{f: v[f] for f in ("label", "kind", "rule", "params")}, "needs": list(v.get("needs", ())),
             "tw_only": bool(v.get("needs"))} for k, v in STRATEGIES.items() if not v.get("custom_def")]


def resolve_params(key: str, raw: Dict[str, Any]) -> Dict[str, Any]:
    """依策略參數定義取值並檢查範圍；沒填用預設值。範圍錯誤丟 ValueError（訊息給使用者看）。"""
    if key not in STRATEGIES:
        raise ValueError(f"未知的策略：{key}")
    out: Dict[str, Any] = {}
    for d in STRATEGIES[key]["params"]:
        v = raw.get(d["key"], d["default"])
        try:
            v = float(v)
        except (TypeError, ValueError):
            raise ValueError(f"「{d['label']}」必須是數字") from None
        if not d["lo"] <= v <= d["hi"]:
            raise ValueError(f"「{d['label']}」必須介於 {d['lo']}～{d['hi']}（目前 {v:g}）")
        out[d["key"]] = int(v) if d["integer"] else v
    if key == "ma_cross" and out["slow_ma"] <= out["fast_ma"]:
        raise ValueError(f"長均線週期（{out['slow_ma']}）必須大於短均線週期（{out['fast_ma']}），例如 5 與 20")
    if key == "ma_align" and not out["short_ma"] < out["mid_ma"] < out["long_ma"]:
        raise ValueError("均線多頭排列需要 短均線 < 中均線 < 長均線，例如 5／20／60")
    return out


def valid_combo(key: str, params: Dict[str, Any]) -> bool:
    """參數掃描時跳過不合理的組合（例如短均線 ≥ 長均線）。"""
    try:
        resolve_params(key, params)
        return True
    except ValueError:
        return False


def signals(key: str, bars: List[Bar], params: Dict[str, Any]) -> List[int]:
    fn: Callable[[List[Bar], Dict[str, Any]], List[int]] = STRATEGIES[key]["fn"]
    return fn(bars, params)
