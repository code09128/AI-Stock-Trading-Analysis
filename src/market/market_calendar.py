"""
交易日曆 (market_calendar.py)
判斷某一天市場有沒有開：
1. 週六、週日一律休市
2. 有日 K 可對照（日期在資料範圍內）時，以「那天有沒有 K 棒」為準——任何年份、任何假日都準
3. 超出 K 線範圍（今天、未來）時：
   - 台股：證交所開放資料 holidaySchedule（只有當年度；排除「開始交易日／最後交易日」，含「市場無交易」日），快取 1 天
   - 美股：依 NYSE 規則計算
   - 其他市場（港、日、韓、英…）：沒有內建假日表，只排除週末（元旦、MLK、總統日、耶穌受難日、陣亡將士、六月節、獨立、勞動、感恩、聖誕；週末順延）
抓不到證交所資料時只判斷週末，並在 reason 標示。
"""

from datetime import date, timedelta
from typing import Dict, Iterable, Optional, Set, Tuple
import threading
import time

TWSE_HOLIDAY_URL = "https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule"
_TW_CACHE: Dict[str, object] = {"t": 0.0, "days": None}
_LOCK = threading.Lock()


def _roc_to_date(s: str) -> Optional[date]:
    try:
        s = str(s).strip()
        return date(int(s[:-4]) + 1911, int(s[-4:-2]), int(s[-2:]))
    except (ValueError, IndexError):
        return None


def tw_holidays() -> Optional[Set[date]]:
    """證交所公告的休市日（當年度）；抓取失敗回 None。"""
    with _LOCK:
        if _TW_CACHE["days"] is not None and time.time() - float(_TW_CACHE["t"]) < 86400:
            return _TW_CACHE["days"]  # type: ignore[return-value]
    from src.market import quote_provider as qp  # 延遲匯入，避免循環

    try:
        rows = qp._http_json(TWSE_HOLIDAY_URL, timeout=15)
    except Exception:
        return None
    days = {
        d for r in rows
        if "交易日" not in str(r.get("Name", "")) and (d := _roc_to_date(r.get("Date", "")))
    }
    with _LOCK:
        _TW_CACHE.update(t=time.time(), days=days)
    return days


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    d = date(year, month, 1)
    d += timedelta(days=(weekday - d.weekday()) % 7)
    return d + timedelta(weeks=n - 1)


def _last_weekday(year: int, month: int, weekday: int) -> date:
    d = date(year, month + 1, 1) - timedelta(days=1) if month < 12 else date(year, 12, 31)
    return d - timedelta(days=(d.weekday() - weekday) % 7)


def _easter(year: int) -> date:
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7  # noqa: E741
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def _observed(d: date) -> Optional[date]:
    """週六的假日提前到週五、週日延到週一（NYSE 規則：元旦遇週六不補）。"""
    if d.weekday() == 5:
        return None if (d.month, d.day) == (1, 1) else d - timedelta(days=1)
    if d.weekday() == 6:
        return d + timedelta(days=1)
    return d


def us_holidays(year: int) -> Dict[date, str]:
    days = {
        _observed(date(year, 1, 1)): "元旦",
        _nth_weekday(year, 1, 0, 3): "馬丁路德金恩紀念日",
        _nth_weekday(year, 2, 0, 3): "總統日",
        _easter(year) - timedelta(days=2): "耶穌受難日",
        _last_weekday(year, 5, 0): "陣亡將士紀念日",
        _observed(date(year, 7, 4)): "獨立紀念日",
        _nth_weekday(year, 9, 0, 1): "勞動節",
        _nth_weekday(year, 11, 3, 4): "感恩節",
        _observed(date(year, 12, 25)): "聖誕節",
    }
    if year >= 2022:
        days[_observed(date(year, 6, 19))] = "六月節"
    days.pop(None, None)
    return days  # type: ignore[return-value]


def trading_day(market: str, d: date, bar_dates: Optional[Iterable[str]] = None) -> Tuple[bool, str]:
    """回傳 (是否交易日, 原因說明)。bar_dates 是 'YYYY-MM-DD' 的日 K 日期，有提供且 d 在範圍內時以它為準。"""
    if d.weekday() >= 5:
        return False, "週末休市"
    if bar_dates:
        ds = sorted(bar_dates)
        if ds[0] <= d.isoformat() <= ds[-1]:
            return (True, "有日 K 紀錄") if d.isoformat() in set(ds) else (False, "當天沒有成交紀錄（休市）")
    if market.upper() == "TW":
        hol = tw_holidays()
        if hol is None:
            return True, "無法取得證交所休市日，只排除週末"
        if d.year != date.today().year and not any(h.year == d.year for h in hol):
            return True, "證交所只提供當年度休市日，只排除週末"
        return (False, "證交所公告休市") if d in hol else (True, "證交所交易日")
    if market.upper() == "US":
        name = us_holidays(d.year).get(d)
        return (False, f"美股休市（{name}）") if name else (True, "美股交易日")
    return True, "這個市場沒有內建假日表，只排除週末（過去日期會以有沒有日 K 判斷）"
