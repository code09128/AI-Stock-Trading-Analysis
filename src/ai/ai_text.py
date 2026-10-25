"""
AI 回答的文字整理與數字核對 (ai_text.py)
- unverified_numbers：回答中出現、但不在原始資料裡的數字（給使用者人工核對）
- to_traditional／clean_math：小模型夾帶的簡體字轉繁體、LaTeX 數學語法轉成可讀符號
- _clean：送給 AI 前拿掉佔篇幅又沒幫助的欄位（NOISY_KEYS）
- _strip_opener：拿掉制式開場白
- extract_json：從模型回覆中取出第一個完整的 JSON 物件（略過思考過程、程式碼框、JSON 後面多寫的文字）
"""

from typing import Any, Dict, List, Optional
import json
import re

_NUM = re.compile(r"-?\d[\d,]*\.?\d*")


def _numbers(text: str) -> List[str]:
    return [m.group(0).replace(",", "").rstrip(".") for m in _NUM.finditer(text)]


def unverified_numbers(answer: str, data_text: str) -> List[str]:
    """回答中出現、但不在原始資料裡的數字（>=3 位數或含小數）。找不到不代表錯，但要人工核對。
    不列入：台股代號（資料中的 2330.TW、00 開頭的 ETF 如 006208）、指數名稱（標普 500、日經 225）、
    單位換算（張／萬／百萬／億）、四捨五入差 0.5% 以內（1358 vs 1358.34）、同一句標了「推算」的數字。"""
    known_floats = []
    for k in set(_numbers(data_text)):
        try:
            v = abs(float(k))
            known_floats.append(v)
            if v >= 1000:  # 模型常把股數／張數／金額換算成張（÷1000）、萬、百萬、萬張、億
                known_floats.extend(v / s for s in (1e3, 1e4, 1e6, 1e7, 1e8))
        except ValueError:
            continue
    known_set = {round(x, 2) for x in known_floats}
    codes = set(re.findall(r"\b(\d{4,6}[A-Z]?)\.TWO?\b", data_text))  # 資料裡出現過的台股代號
    cleaned_ans = re.sub(r"(?:標普|S&P)\s*500|日經\s*225|滬深\s*300|富時\s*100", "", answer)
    # 「（推算）」所在的那一句（以句號、分號、換行切）裡的數字是 AI 自己算的，提示詞已要求標註
    derived = set()
    for sent in re.split(r"[。；;\n]", cleaned_ans):
        if "推算" in sent:
            derived.update(_numbers(sent))
    bad = []
    for n in _numbers(cleaned_ans):
        digits = n.lstrip("-").replace(".", "")
        if len(digits) < 3 and "." not in n:
            continue  # 1、20、5% 這類小整數不檢查
        if n.lstrip("-") in codes or n in derived or re.fullmatch(r"00\d{2,4}[A-Z]?", n):  # 00 開頭＝台股 ETF 代號
            continue
        try:
            f = abs(float(n))
        except ValueError:
            continue
        if round(f, 2) in known_set or any(k and abs(f - k) <= max(abs(k) * 0.005, 0.01) for k in known_floats):
            continue
        bad.append(n)
    return sorted(set(bad))[:12]


NOISY_KEYS = {"level_candidates", "MACD_hist", "trades", "equity_curve", "endpoint", "ai_usage",
              "daily_equity", "mdd_hist", "final_hist", "chart_bars"}


# 小模型常夾帶簡體字：只轉換繁體中文裡不會用到的簡體字（「后、里、干」這類繁簡共用的字不動）
_S2T = str.maketrans("万与业东两个为么乐买争于亏亚产亿仅从仓们价会债偿兰关冲况净准减击则刚创别务动势区华单卖却历压双发变号启响场处备复头实对导将尔尽岁广应庞开弹当态战报拟拥择挤损换据撑数断时显机杂权杆杠条来极构标样检欧汇没测济涌润涨点烦状环现监盘着码确种积称税稳筑筹简类级纳线组织经结络统继续维缓缩网罗胜节荡获营虑虽补见观规计订认让议讯论证评该说调负质贴贸费资趋跃车转轮载较输边达过运还这进迟选释银键长门闭问间闻阶际险顾预频题额风", "萬與業東兩個為麼樂買爭於虧亞產億僅從倉們價會債償蘭關衝況淨準減擊則剛創別務動勢區華單賣卻歷壓雙發變號啟響場處備復頭實對導將爾盡歲廣應龐開彈當態戰報擬擁擇擠損換據撐數斷時顯機雜權桿槓條來極構標樣檢歐匯沒測濟湧潤漲點煩狀環現監盤著碼確種積稱稅穩築籌簡類級納線組織經結絡統繼續維緩縮網羅勝節盪獲營慮雖補見觀規計訂認讓議訊論證評該說調負質貼貿費資趨躍車轉輪載較輸邊達過運還這進遲選釋銀鍵長門閉問間聞階際險顧預頻題額風")


_LATEX_SUBS = (
    (r"\\frac\{([^{}]*)\}\{([^{}]*)\}", r"(\1 / \2)"),
    (r"\\(?:text|mathrm|mathbf|textbf)\{([^{}]*)\}", r"\1"),
    (r"\\(?:ge|geq|geqslant)\b", "≥"),
    (r"\\(?:le|leq|leqslant)\b", "≤"),
    (r"\\(?:ne|neq)\b", "≠"),
    (r"\\(?:approx|sim)\b", "≈"),
    (r"\\times\b", "×"),
    (r"\\cdot\b", "·"),
    (r"\\div\b", "÷"),
    (r"\\pm\b", "±"),
    (r"\\(?:to|rightarrow|longrightarrow|Rightarrow)\b", "→"),
    (r"\\(?:leftarrow|Leftarrow)\b", "←"),
    (r"\\uparrow\b", "↑"),
    (r"\\downarrow\b", "↓"),
    (r"\\infty\b", "∞"),
    (r"\\beta\b", "Beta"),
    (r"\\alpha\b", "Alpha"),
    (r"\\%", "%"),
    (r"\\(?:left|right|quad|qquad|,|;|!)\b", ""),
)


def clean_math(text: str) -> str:
    """將模型偶爾輸出的 LaTeX 數學語法（如 $\\ge 0.7$）轉為可讀符號（≥ 0.7），並保留金額符號（如 $100 ～ $120）。"""
    for pat, rep in _LATEX_SUBS:
        text = re.sub(pat, rep, text)
    text = re.sub(r"\$\$([^$]+)\$\$", r"\1", text)
    return re.sub(r"(?<![A-Za-z])\$([^$\n]+?)\$(?!\d)", r"\1", text)


def to_traditional(text: str) -> str:
    return clean_math(text.translate(_S2T))


def _clean(obj: Any) -> Any:
    """去掉對解讀沒幫助、又佔篇幅的欄位（重複的逐筆交易、全部候選價位…）。"""
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items() if k not in NOISY_KEYS and v not in (None, "", [], {})}
    if isinstance(obj, list):
        return [_clean(v) for v in obj]
    return obj


_OPENER = re.compile(r"^\s*(根據|依據|以下|好的|針對|這是|您好|身為|作為).{0,80}$")


def _strip_opener(text: str) -> str:
    """拿掉「根據您提供的資料，以下是…」這類制式開場白（只看最前面兩行，且不能是段落標題）。"""
    lines = text.strip().splitlines()
    for _ in range(2):
        if lines and _OPENER.match(lines[0]) and "【" not in lines[0]:
            lines.pop(0)
            while lines and not lines[0].strip():
                lines.pop(0)
    return "\n".join(lines)


_THINK = re.compile(r"<think>.*?</think>", re.S | re.I)
_FENCE = re.compile(r"```(?:json)?", re.I)


def extract_json(raw: str, want: Optional[str] = None) -> Dict[str, Any]:
    """模型常在 JSON 前後多寫字、重複輸出兩次 JSON，或先輸出 <think> 思考過程（裡面也可能有大括號）。
    依序從每個「{」嘗試解析一個完整物件，回傳第一個含 want 欄位的（沒指定就回第一個）；都失敗才拋 ValueError。"""
    text = _FENCE.sub("", _THINK.sub("", raw or ""))
    dec = json.JSONDecoder()
    first: Optional[Dict[str, Any]] = None
    last_err: Optional[str] = None
    for m in re.finditer(r"\{", text):
        try:
            obj, _end = dec.raw_decode(text, m.start())
        except json.JSONDecodeError as e:
            last_err = str(e)
            continue
        if isinstance(obj, dict):
            if want is None or want in obj:
                return obj
            first = first or obj
    if want is not None:
        # 外層 JSON 壞掉（常見：回覆太長被截斷）時，不要誤拿裡面的某個小物件當結果；
        # 但模型直接回一個陣列（[{...}, {...}]）時，視為 want 的內容
        for m in re.finditer(r"\[", text):
            try:
                arr, _end = dec.raw_decode(text, m.start())
            except json.JSONDecodeError:
                continue
            if isinstance(arr, list) and arr and all(isinstance(x, dict) for x in arr):
                return {want: arr}
        raise ValueError(f"模型回覆的 JSON 不完整或缺少「{want}」（可能回覆太長被截斷）"
                         + (f"：{last_err}" if last_err else ""))
    if first is not None:
        return first
    raise ValueError("模型回覆中找不到完整的 JSON" + (f"（{last_err}）" if last_err else ""))
