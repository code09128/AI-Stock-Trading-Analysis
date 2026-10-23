"""交易檢討（/api/mod5/coach）"""

from typing import Dict, Any, List
import re
from datetime import datetime

from src.journal.journal_coach import JournalCoach, JournalEntry
from src.ai import ai_client


class JournalHandlers:
    """交易檢討（/api/mod5/coach）"""

    def _enrich_journal(self, entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """使用者的真實交易：自動補上損益、報酬率、持有天數，並用真實日 K 算『出場後 5 個交易日最高價』。"""
        out, bars_cache = [], {}
        date_re = re.compile(r"^\d{4}-\d{2}-\d{2}")
        for e in entries:
            e = dict(e)
            try:
                ep, xp, sh = float(e.get("entry_price") or 0), float(e.get("exit_price") or 0), int(float(e.get("shares") or 0))
            except (TypeError, ValueError):
                out.append(e)
                continue
            fees = float(e.get("fees") or 0)
            if ep and xp and sh:
                e["net_pnl"] = round((xp - ep) * sh - fees, 2)
            if ep and xp:
                e["return_pct"] = round((xp / ep - 1) * 100, 2)
            ed, xd = str(e.get("entry_time", "")), str(e.get("exit_time", ""))
            if date_re.match(ed) and date_re.match(xd):
                e["holding_days"] = (datetime.strptime(xd[:10], "%Y-%m-%d") - datetime.strptime(ed[:10], "%Y-%m-%d")).days
            if date_re.match(xd) and e.get("high_5d_after_exit") in (None, "", 0) and e.get("symbol"):
                sym = str(e["symbol"])
                if sym not in bars_cache:
                    try:
                        bars_cache[sym] = self.adapter.fetch_bars(sym, days=250)["bars"]
                    except Exception:
                        bars_cache[sym] = []
                after = [b for b in bars_cache[sym] if b.timestamp > xd[:10]][:5]
                if after:
                    e["high_5d_after_exit"] = max(b.high for b in after)
                    e["post_exit_source"] = "真實還權日 K（出場後 5 個交易日最高價；還權價與實際成交價可能有些微差異）"
            out.append(e)
        return out

    @staticmethod
    def _to_journal_entry(e: Dict[str, Any]) -> JournalEntry:
        """相容前端欄位名 (net_pnl/return_pct/high_5d_after_exit) 與引擎欄位名 (pnl_amount/pnl_pct/post_exit_5d_high)。"""
        g = lambda *keys, default=0: next((e[k] for k in keys if k in e and e[k] not in (None, "")), default)  # noqa: E731
        return JournalEntry(
            trade_id=str(g("trade_id", default="#00")),
            symbol=str(g("symbol", default="")),
            entry_time=str(g("entry_time", default="")),
            exit_time=str(g("exit_time", default="")),
            entry_price=float(g("entry_price")),
            exit_price=float(g("exit_price")),
            shares=int(g("shares")),
            pnl_amount=float(g("pnl_amount", "net_pnl")),
            pnl_pct=float(g("pnl_pct", "return_pct")),
            holding_days=int(g("holding_days")),
            post_exit_5d_high=float(g("post_exit_5d_high", "high_5d_after_exit")),
            emotion_score=int(g("emotion_score")),
        )

    def handle_mod5_coach(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        raw_entries = payload.get("entries")
        if raw_entries:
            raw_entries = self._enrich_journal(raw_entries)
            entries = [self._to_journal_entry(e) for e in raw_entries]
        else:
            entries = [
                JournalEntry("#01", "2330.TW", "09:10", "13:20", 1000.0, 1020.0, 1000, 20000.0, 2.0, 1, 1095.0),
                JournalEntry("#02", "2603.TW", "09:05", "13:30", 180.0, 175.0, 1000, -5000.0, -2.7, 1, 176.0),
                JournalEntry("#03", "3017.TW", "09:15", "10:00", 600.0, 528.0, 1000, -72000.0, -12.0, 10, 530.0),
                JournalEntry("#04", "2330.TW", "09:02", "09:35", 1020.0, 1010.0, 3000, -30000.0, -1.0, 1, 1015.0),
                JournalEntry("#08", "NVDA", "21:35", "23:50", 140.0, 124.0, 200, -3200.0, -11.4, 8, 125.0),
                JournalEntry("#09", "NVDA", "21:30", "22:15", 125.0, 122.0, 600, -1800.0, -2.4, 1, 128.0),
            ]

        coach = JournalCoach(entries)
        stats = coach.compute_statistics()
        biases = coach.detect_behavioral_biases()
        rules = coach.formulate_personalized_rules(biases)
        rules_source = "固定規則範本（未使用 AI，不是依你的交易量身產生）"
        if ai_client.is_enabled(payload.get("ai")):
            try:
                rules = ai_client.personal_rules(payload["ai"], stats, biases)
                rules_source = f"AI（{payload['ai'].get('model')}）依你的交易統計與偏誤產生，已檢查每條都有數字門檻"
            except ai_client.AIError as e:
                rules_source = f"AI 產生失敗，改用固定規則範本（{e}）"

        return {
            "module": 5,
            "statistics": stats,
            "detected_biases": biases,
            "personalized_3_rules": rules,
            "rules_source": rules_source,
            "entries_used": raw_entries if raw_entries else None,
        }
