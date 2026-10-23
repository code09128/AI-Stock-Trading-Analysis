"""
時區 (tz.py)
優先用標準庫 zoneinfo；Windows 沒裝 tzdata 套件時 zoneinfo 找不到時區資料，改用內建規則，
讓系統「只用標準函式庫」也能在 Windows 啟動：
- 固定時差（沒有日光節約）：台北、香港、上海、新加坡 UTC+8，東京、首爾 UTC+9
- 北美規則（2007 年起：3 月第 2 個週日 02:00 ～ 11 月第 1 個週日 02:00）：紐約、多倫多
- 歐盟／英國規則（3 月最後一個週日 01:00 UTC ～ 10 月最後一個週日 01:00 UTC）：倫敦、柏林
- 澳洲東部規則（10 月第 1 個週日 02:00 ～ 4 月第 1 個週日 03:00，南半球）：雪梨
"""

from datetime import datetime, timedelta, timezone, tzinfo
from typing import Dict


def _nth_sunday(year: int, month: int, n: int) -> datetime:
    d = datetime(year, month, 1)
    d += timedelta(days=(6 - d.weekday()) % 7)
    return d + timedelta(weeks=n - 1)


def _last_sunday(year: int, month: int) -> datetime:
    d = datetime(year + (month == 12), month % 12 + 1, 1) - timedelta(days=1)
    return d - timedelta(days=(d.weekday() + 1) % 7)


class _DstZone(tzinfo):
    """以「每年 DST 開始／結束的 UTC 時刻」描述的時區；子類別實作 _window_utc(year)。"""

    def __init__(self, name: str, std_hours: float):
        self._name = name
        self.STD = timedelta(hours=std_hours)
        self.DST = self.STD + timedelta(hours=1)

    def _window_utc(self, year: int):
        raise NotImplementedError

    def _is_dst_utc(self, naive_utc: datetime) -> bool:
        start, end = self._window_utc(naive_utc.year)
        return start <= naive_utc < end if start < end else not (end <= naive_utc < start)

    def utcoffset(self, dt):
        if dt is None:
            return self.STD
        # 由當地時間反推：先假設標準時間換算成 UTC 判斷（重疊／跳過的那一小時視為標準時間）
        return self.DST if self._is_dst_utc(dt.replace(tzinfo=None) - self.STD) else self.STD

    def dst(self, dt):
        return self.utcoffset(dt) - self.STD

    def tzname(self, dt):
        return self._name

    def fromutc(self, dt):
        naive = dt.replace(tzinfo=None)
        return (naive + (self.DST if self._is_dst_utc(naive) else self.STD)).replace(tzinfo=self)

    def __repr__(self):
        return self._name


class NorthAmericaRules(_DstZone):
    def _window_utc(self, year):
        start = _nth_sunday(year, 3, 2) + timedelta(hours=2) - self.STD  # 當地標準時間 02:00
        end = _nth_sunday(year, 11, 1) + timedelta(hours=2) - self.DST  # 當地夏令時間 02:00
        return start, end


class EuropeRules(_DstZone):
    def _window_utc(self, year):
        return _last_sunday(year, 3) + timedelta(hours=1), _last_sunday(year, 10) + timedelta(hours=1)


class AustraliaEastRules(_DstZone):
    def _window_utc(self, year):
        start = _nth_sunday(year, 10, 1) + timedelta(hours=2) - self.STD  # 10 月開始
        end = _nth_sunday(year, 4, 1) + timedelta(hours=3) - self.DST  # 隔年 4 月結束（同一年的 4 月先結束）
        return start, end


def NewYorkRules() -> tzinfo:  # noqa: N802 （保留舊名稱給既有程式與測試）
    return NorthAmericaRules("America/New_York", -5)


TAIPEI_FIXED = timezone(timedelta(hours=8), "Asia/Taipei")

_FALLBACK: Dict[str, tzinfo] = {
    "UTC": timezone.utc,
    "Asia/Taipei": TAIPEI_FIXED,
    "Asia/Hong_Kong": timezone(timedelta(hours=8), "Asia/Hong_Kong"),
    "Asia/Shanghai": timezone(timedelta(hours=8), "Asia/Shanghai"),
    "Asia/Singapore": timezone(timedelta(hours=8), "Asia/Singapore"),
    "Asia/Tokyo": timezone(timedelta(hours=9), "Asia/Tokyo"),
    "Asia/Seoul": timezone(timedelta(hours=9), "Asia/Seoul"),
    "America/New_York": NorthAmericaRules("America/New_York", -5),
    "America/Toronto": NorthAmericaRules("America/Toronto", -5),
    "Europe/London": EuropeRules("Europe/London", 0),
    "Europe/Berlin": EuropeRules("Europe/Berlin", 1),
    "Australia/Sydney": AustraliaEastRules("Australia/Sydney", 10),
}


def zone(name: str) -> tzinfo:
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(name)
    except Exception:  # ZoneInfoNotFoundError（Windows 沒有 tzdata）或舊版 Python
        return _FALLBACK[name]
