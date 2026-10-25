"""
自訂策略（條件積木）(custom_rules.py)
使用者用「左邊指標 × 比較方式 × 右邊指標或數字」組出進場與出場條件，不用寫程式：
  {"name": "我的策略",
   "entry": {"logic": "all" | "any", "rules": [{"left": 運算元, "op": ">"|"<"|"cross_up"|"cross_down", "right": 運算元}, ...]},
   "exit":  {...同上...}}
運算元：{"type": "close"} 或 {"type": "sma", "n": 20} 或 {"type": "number", "value": 30} …（見 OPERANDS）
- 所有指標都只用到當天收盤為止的資料（沒有「往後位移」這種運算元），所以組不出偷看未來的條件
- 條件裡的數字（天數、門檻）會變成策略參數 n1、n2…，可以像內建策略一樣調整、掃參數熱力圖
- register() 依內容產生固定的策略代號（custom_xxxx），放進 strategies.STRATEGIES，之後回測、驗證、今日訊號、Pine 匯出都通用
"""

import copy
import hashlib
import json
from typing import Any, Dict, List, Optional, Tuple

from src.backtest import strategies
from src.market.bar import Bar
from src.technical.indicators import calculate_atr, calculate_ema, calculate_ma, calculate_macd, calculate_rsi

# type: (中文名稱, 需要天數 n 嗎, 預設 n)
OPERANDS: Dict[str, Tuple[str, bool, int]] = {
    "close": ("收盤價", False, 0),
    "open": ("開盤價", False, 0),
    "high": ("最高價", False, 0),
    "low": ("最低價", False, 0),
    "volume": ("成交量", False, 0),
    "sma": ("均線（SMA）", True, 20),
    "ema": ("指數均線（EMA）", True, 20),
    "vol_sma": ("均量", True, 20),
    "rsi": ("RSI", True, 14),
    "kd_k": ("KD 的 K 值", True, 9),
    "kd_d": ("KD 的 D 值", True, 9),
    "macd_dif": ("MACD 快線（DIF）", False, 0),
    "macd_signal": ("MACD 慢線（訊號線）", False, 0),
    "macd_hist": ("MACD 柱狀體", False, 0),
    "atr": ("ATR 真實波動", True, 14),
    "bias": ("乖離率 %", True, 20),
    "highest": ("N 日最高收盤（不含當天）", True, 20),
    "lowest": ("N 日最低收盤（不含當天）", True, 20),
    "inst_net": ("三大法人買賣超（張，僅台股）", False, 0),
    "number": ("數字", False, 0),
}
OPS = {">": "大於", "<": "小於", "cross_up": "向上穿越", "cross_down": "向下穿越"}
MAX_RULES = 6

TEMPLATES: List[Dict[str, Any]] = [
    {"name": "RSI 超賣反彈",
     "entry": {"logic": "all", "rules": [{"left": {"type": "rsi", "n": 14}, "op": "cross_up", "right": {"type": "number", "value": 30}}]},
     "exit": {"logic": "any", "rules": [{"left": {"type": "rsi", "n": 14}, "op": "cross_down", "right": {"type": "number", "value": 70}},
                                        {"left": {"type": "close"}, "op": "<", "right": {"type": "sma", "n": 60}}]}},
    {"name": "均線黃金交叉＋量增",
     "entry": {"logic": "all", "rules": [{"left": {"type": "sma", "n": 5}, "op": "cross_up", "right": {"type": "sma", "n": 20}},
                                         {"left": {"type": "volume"}, "op": ">", "right": {"type": "vol_sma", "n": 20}}]},
     "exit": {"logic": "any", "rules": [{"left": {"type": "sma", "n": 5}, "op": "cross_down", "right": {"type": "sma", "n": 20}}]}},
    {"name": "MACD 柱狀體翻正",
     "entry": {"logic": "all", "rules": [{"left": {"type": "macd_hist"}, "op": "cross_up", "right": {"type": "number", "value": 0}},
                                         {"left": {"type": "close"}, "op": ">", "right": {"type": "sma", "n": 60}}]},
     "exit": {"logic": "any", "rules": [{"left": {"type": "macd_hist"}, "op": "cross_down", "right": {"type": "number", "value": 0}}]}},
    {"name": "KD 低檔交叉＋站上月線",
     "entry": {"logic": "all", "rules": [{"left": {"type": "kd_k", "n": 9}, "op": "cross_up", "right": {"type": "kd_d", "n": 9}},
                                         {"left": {"type": "kd_k", "n": 9}, "op": "<", "right": {"type": "number", "value": 40}},
                                         {"left": {"type": "close"}, "op": ">", "right": {"type": "sma", "n": 20}}]},
     "exit": {"logic": "any", "rules": [{"left": {"type": "close"}, "op": "<", "right": {"type": "sma", "n": 20}}]}},
    {"name": "法人買超＋突破月線（台股）",
     "entry": {"logic": "all", "rules": [{"left": {"type": "inst_net"}, "op": ">", "right": {"type": "number", "value": 0}},
                                         {"left": {"type": "close"}, "op": "cross_up", "right": {"type": "sma", "n": 20}}]},
     "exit": {"logic": "any", "rules": [{"left": {"type": "close"}, "op": "<", "right": {"type": "sma", "n": 20}}]}},
]


# ---------------------------------------------------------------- 檢查與參數
def _check_operand(o: Any, where: str) -> Dict[str, Any]:
    if not isinstance(o, dict) or o.get("type") not in OPERANDS:
        raise ValueError(f"{where}：指標種類不正確")
    t = o["type"]
    out: Dict[str, Any] = {"type": t}
    if OPERANDS[t][1]:
        try:
            n = int(o.get("n", OPERANDS[t][2]))
        except (TypeError, ValueError):
            raise ValueError(f"{where}：天數必須是整數") from None
        if not 2 <= n <= 250:
            raise ValueError(f"{where}：天數必須介於 2～250（目前 {n}）")
        out["n"] = n
    if t == "number":
        try:
            out["value"] = float(o.get("value", 0))
        except (TypeError, ValueError):
            raise ValueError(f"{where}：必須是數字") from None
    return out


def normalize(defn: Any) -> Dict[str, Any]:
    """檢查格式、補預設值，回傳乾淨的定義；有問題丟 ValueError（訊息給使用者看）。"""
    if not isinstance(defn, dict):
        raise ValueError("自訂策略格式不正確")
    name = str(defn.get("name") or "我的自訂策略").strip()[:30]
    out: Dict[str, Any] = {"name": name}
    for side, label in (("entry", "進場"), ("exit", "出場")):
        block = defn.get(side) or {}
        rules = block.get("rules") or []
        if not isinstance(rules, list) or not rules:
            raise ValueError(f"{label}條件至少要有一條")
        if len(rules) > MAX_RULES:
            raise ValueError(f"{label}條件最多 {MAX_RULES} 條")
        clean = []
        for i, r in enumerate(rules, start=1):
            where = f"{label}第 {i} 條"
            if not isinstance(r, dict) or r.get("op") not in OPS:
                raise ValueError(f"{where}：比較方式不正確")
            left, right = _check_operand(r.get("left"), f"{where}左邊"), _check_operand(r.get("right"), f"{where}右邊")
            if left["type"] == "number":
                raise ValueError(f"{where}：左邊要是指標，不能是數字")
            if left == right:
                raise ValueError(f"{where}：左右兩邊相同，條件永遠不會成立")
            clean.append({"left": left, "op": r["op"], "right": right})
        out[side] = {"logic": "any" if block.get("logic") == "any" else "all", "rules": clean}
    return out


FAMILY = {"kd_k": "kd", "kd_d": "kd"}  # K 與 D 用同一組 KD 天數


def _groups(defn: Dict[str, Any]) -> List[Dict[str, Any]]:
    """條件裡的數字 → 參數。同一種指標、同樣天數（例如進場與出場都用 20 日均線）合成一個參數，
    改一次就全部跟著變；比較用的門檻數字每個各自一個參數。"""
    groups: List[Dict[str, Any]] = []
    by_n: Dict[Tuple[str, int], Dict[str, Any]] = {}
    for side in ("entry", "exit"):
        for i, r in enumerate(defn[side]["rules"]):
            for pos in ("left", "right"):
                o = r[pos]
                if "n" in o:
                    fam = FAMILY.get(o["type"], o["type"])
                    g = by_n.get((fam, o["n"]))
                    if g is None:
                        g = {"field": "n", "type": o["type"], "family": fam, "default": o["n"], "members": []}
                        by_n[(fam, o["n"])] = g
                        groups.append(g)
                    g["members"].append((side, i, pos))
                elif o["type"] == "number":
                    groups.append({"field": "value", "default": o["value"], "members": [(side, i, pos)],
                                   "where": f"{'進場' if side == 'entry' else '出場'}第 {i + 1} 條",
                                   "against": _operand_text(r["left"])})
    for k, g in enumerate(groups, start=1):
        g["key"] = f"n{k}"
    return groups


def _operand_text(o: Dict[str, Any]) -> str:
    if o["type"] == "number":
        return f"{o['value']:g}"
    name = OPERANDS[o["type"]][0]
    return f"{o['n']} 日{name}" if "n" in o else name


def rule_text(defn: Dict[str, Any]) -> str:
    def block(b: Dict[str, Any]) -> str:
        join = "且" if b["logic"] == "all" else "或"
        return f" {join} ".join(f"{_operand_text(r['left'])} {OPS[r['op']]} {_operand_text(r['right'])}" for r in b["rules"])
    return f"進場：{block(defn['entry'])}。出場：{block(defn['exit'])}。訊號收盤確認、隔天開盤成交。"


def param_specs(defn: Dict[str, Any]) -> List[Dict[str, Any]]:
    specs = []
    for g in _groups(defn):
        if g["field"] == "n":
            name = "KD" if g["family"] == "kd" else OPERANDS[g["type"]][0]
            specs.append({"key": g["key"], "label": f"{name}天數", "default": g["default"],
                          "lo": 2, "hi": 250, "integer": True,
                          "tip": f"條件裡所有「{g['default']} 日{name}」都用這個天數（共 {len(g['members'])} 處），可以調整或掃參數熱力圖。"})
        else:
            specs.append({"key": g["key"], "label": f"{g['where']}門檻（{g['against']}）", "default": g["default"],
                          "lo": -1e9, "hi": 1e9, "integer": False, "tip": "條件裡比較用的數字。"})
    # 同名的參數加上 ①②③（例如短、長兩條均線），畫面與熱力圖才分得出來
    total = {x["label"]: sum(1 for y in specs if y["label"] == x["label"]) for x in specs}
    seen: Dict[str, int] = {}
    for x in specs:
        base = x["label"]
        if total[base] > 1:
            seen[base] = seen.get(base, 0) + 1
            x["label"] = base + "①②③④⑤⑥⑦⑧⑨⑩"[min(seen[base], 10) - 1]
    return specs


def _apply(defn: Dict[str, Any], params: Dict[str, Any]) -> Dict[str, Any]:
    d = copy.deepcopy(defn)
    for g in _groups(defn):
        if g["key"] in params:
            v = int(params[g["key"]]) if g["field"] == "n" else float(params[g["key"]])
            for side, i, pos in g["members"]:
                d[side]["rules"][i][pos][g["field"]] = v
    return d


def _axis(spec: Dict[str, Any], count: int) -> Tuple:
    v = spec["default"]
    if spec["integer"]:
        mults = (0.5, 0.75, 1, 1.25, 1.5, 2) if count == 6 else (0.5, 1, 1.5, 2)
        vals = sorted({min(250, max(2, round(v * m))) for m in mults})
    else:
        step = abs(v) * 0.2 if v else 1
        offs = (-2, -1, 0, 1, 2, 3) if count == 6 else (-1, 0, 1, 2)
        vals = sorted({round(v + o * step, 4) for o in offs})
    return tuple(vals)


# ---------------------------------------------------------------- 計算
def _series(o: Dict[str, Any], bars: List[Bar], cache: Dict[str, List[Optional[float]]]) -> List[Optional[float]]:
    key = json.dumps(o, sort_keys=True)
    if key in cache:
        return cache[key]
    t, n = o["type"], o.get("n")
    closes = [b.close for b in bars]
    if t in ("close", "open", "high", "low", "volume"):
        s: List[Optional[float]] = [getattr(b, t) for b in bars]
    elif t == "number":
        s = [o["value"]] * len(bars)
    elif t == "sma":
        s = calculate_ma(closes, n)
    elif t == "ema":
        s = calculate_ema(closes, n)
    elif t == "vol_sma":
        s = calculate_ma([b.volume for b in bars], n)
    elif t == "rsi":
        s = calculate_rsi(closes, n)
    elif t in ("kd_k", "kd_d"):
        s = strategies.kd_values(bars, n)["k" if t == "kd_k" else "d"]
    elif t.startswith("macd_"):
        m = calculate_macd(closes)
        s = m[{"macd_dif": "dif", "macd_signal": "signal", "macd_hist": "hist"}[t]]
    elif t == "atr":
        s = calculate_atr([b.high for b in bars], [b.low for b in bars], closes, n)
    elif t == "bias":
        ma = calculate_ma(closes, n)
        s = [(c - m) / m * 100 if m else None for c, m in zip(closes, ma)]
    elif t in ("highest", "lowest"):
        f = max if t == "highest" else min
        s = [f(closes[i - n:i]) if i >= n else None for i in range(len(bars))]
    elif t == "inst_net":
        s = list(strategies._extra(bars, "inst"))
    else:
        raise ValueError(f"未知的指標：{t}")
    cache[key] = s
    return s


def _cond(r: Dict[str, Any], bars: List[Bar], cache) -> List[bool]:
    a, b = _series(r["left"], bars, cache), _series(r["right"], bars, cache)
    op = r["op"]
    out = [False] * len(bars)
    for i in range(len(bars)):
        if a[i] is None or b[i] is None:
            continue
        if op == ">":
            out[i] = a[i] > b[i]
        elif op == "<":
            out[i] = a[i] < b[i]
        elif i > 0 and a[i - 1] is not None and b[i - 1] is not None:
            if op == "cross_up":
                out[i] = a[i] > b[i] and a[i - 1] <= b[i - 1]
            else:
                out[i] = a[i] < b[i] and a[i - 1] >= b[i - 1]
    return out


def _block(b: Dict[str, Any], bars: List[Bar], cache) -> List[bool]:
    conds = [_cond(r, bars, cache) for r in b["rules"]]
    f = all if b["logic"] == "all" else any
    return [f(c[i] for c in conds) for i in range(len(bars))]


def signals(defn: Dict[str, Any], bars: List[Bar], params: Optional[Dict[str, Any]] = None) -> List[int]:
    d = _apply(defn, params or {})
    cache: Dict[str, List[Optional[float]]] = {}
    entry, exit_ = _block(d["entry"], bars, cache), _block(d["exit"], bars, cache)
    sig, in_pos = [0] * len(bars), False
    for i in range(len(bars)):
        if not in_pos and entry[i]:
            sig[i], in_pos = 1, True
        elif in_pos and exit_[i]:
            sig[i], in_pos = -1, False
    return sig


def uses_inst(defn: Dict[str, Any]) -> bool:
    return any(r[pos]["type"] == "inst_net" for side in ("entry", "exit") for r in defn[side]["rules"]
               for pos in ("left", "right"))


def register(raw: Any) -> str:
    """把自訂策略放進策略清單，回傳策略代號（同樣內容永遠得到同一個代號）。"""
    defn = normalize(raw)
    key = "custom_" + hashlib.sha1(json.dumps(defn, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:10]
    if key not in strategies.STRATEGIES:
        specs = param_specs(defn)
        tunable = [s for s in specs if s["integer"]][:2] or specs[:2]
        strategies.STRATEGIES[key] = {
            "label": f"自訂：{defn['name']}",
            "kind": "自訂",
            "rule": rule_text(defn),
            "fn": lambda bars, p, d=defn: signals(d, bars, p),
            "needs": ("inst",) if uses_inst(defn) else (),
            "params": specs,
            "grid": {s["key"]: _axis(s, 4) for s in tunable},
            "heatmap": {s["key"]: _axis(s, 6) for s in tunable},
            "custom_def": defn,
        }
    return key


def describe(raw: Any) -> Dict[str, Any]:
    """前端存檔前呼叫：檢查定義並回傳可調參數與白話規則。"""
    defn = normalize(raw)
    return {"definition": defn, "params": param_specs(defn), "rule": rule_text(defn), "tw_only": uses_inst(defn)}


# ---------------------------------------------------------------- Pine v5
def _pine_operand(o: Dict[str, Any], kd_used: set) -> str:
    t, n = o["type"], o.get("n")
    if t in ("close", "open", "high", "low", "volume"):
        return t
    if t == "number":
        return f"{o['value']:g}"
    if t == "sma":
        return f"ta.sma(close, {n})"
    if t == "ema":
        return f"ta.ema(close, {n})"
    if t == "vol_sma":
        return f"ta.sma(volume, {n})"
    if t == "rsi":
        return f"ta.rsi(close, {n})"
    if t in ("kd_k", "kd_d"):
        kd_used.add(n)
        return f"{'kK' if t == 'kd_k' else 'kD'}{n}"
    if t == "macd_dif":
        return "macdDif"
    if t == "macd_signal":
        return "macdSig"
    if t == "macd_hist":
        return "(macdDif - macdSig) * 2"
    if t == "atr":
        return f"ta.atr({n})"
    if t == "bias":
        return f"((close - ta.sma(close, {n})) / ta.sma(close, {n}) * 100)"
    if t == "highest":
        return f"ta.highest(close, {n})[1]"
    if t == "lowest":
        return f"ta.lowest(close, {n})[1]"
    return "na"  # inst_net：TradingView 沒有台股法人資料


def to_pine(defn: Dict[str, Any], params: Dict[str, Any]) -> str:
    d = _apply(defn, params)
    kd_used: set = set()

    def block(b: Dict[str, Any]) -> str:
        parts = []
        for r in b["rules"]:
            a, c = _pine_operand(r["left"], kd_used), _pine_operand(r["right"], kd_used)
            if r["op"] in (">", "<"):
                parts.append(f"({a} {r['op']} {c})")
            else:
                parts.append(f"ta.{'crossover' if r['op'] == 'cross_up' else 'crossunder'}({a}, {c})")
        return (" and " if b["logic"] == "all" else " or ").join(parts)

    buy, sell = block(d["entry"]), block(d["exit"])
    head = ["// 自訂策略：" + rule_text(d), "[macdDif, macdSig, _macdH] = ta.macd(close, 12, 26, 9)"]
    for n in sorted(kd_used):
        head += [f"var float kK{n} = 50.0", f"var float kD{n} = 50.0",
                 f"_lo{n} = ta.lowest(low, {n})", f"_hi{n} = ta.highest(high, {n})",
                 f"_rsv{n} = _hi{n} == _lo{n} ? 50.0 : (close - _lo{n}) / (_hi{n} - _lo{n}) * 100",
                 f"kK{n} := kK{n} * 2 / 3 + _rsv{n} / 3", f"kD{n} := kD{n} * 2 / 3 + kK{n} / 3"]
    if uses_inst(d):
        head.append("// ⚠️ 三大法人買賣超在 TradingView 取不到，這裡是 na，含它的條件不會成立")
    return "\n".join(head + [f"buySig = {buy}", f"sellSig = {sell}"])
