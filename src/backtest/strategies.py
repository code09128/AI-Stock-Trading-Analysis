"""
回測策略清單 (strategies.py)
每支策略都是「只用到當天收盤為止的資料」產生訊號：1＝買進、-1＝賣出、0＝無；
訊號當天收盤確認，由回測引擎在隔天開盤成交，所以不會偷看未來。
- 參數定義（PARAMS）讓前端自動產生表單、後端檢查範圍
- GRID 是前後段驗證要掃的兩個參數；HEATMAP 是參數熱力圖的兩軸（格子比較細）
"""

from typing import Any, Callable, Dict, List, Optional

from src.market.bar import Bar
from src.technical.indicators import calculate_ma


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
}


def catalog() -> List[Dict[str, Any]]:
    """給前端的策略清單（不含函式）。"""
    return [{"key": k, **{f: v[f] for f in ("label", "kind", "rule", "params")}} for k, v in STRATEGIES.items()]


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
