"""交易檢討（/api/mod5/coach）"""

from typing import Dict, Any, List
import re
from datetime import datetime

from src.journal.journal_coach import JournalCoach, JournalEntry
from src.ai import ai_client


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}")


def is_open_entry(e: Dict[str, Any]) -> bool:
    """還沒賣出的部位（出場時間空白或「持有中」）：只顯示帳面損益，不算進勝率、賺賠比與賣飛統計。"""
    xd = str(e.get("exit_time") or "").strip()
    return xd in ("", "持有中", "None") or (not DATE_RE.match(xd) and e.get("side") == "BUY")


class JournalHandlers:
    """交易檢討（/api/mod5/coach）"""

    def _enrich_journal(self, entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """使用者的真實交易：自動補上損益、報酬率、持有天數，並用真實日 K 算『出場後 5 個交易日最高價』（持有中則帶最新收盤價估算未實現損益）。"""
        out, bars_cache = [], {}
        date_re = re.compile(r"^\d{4}-\d{2}-\d{2}")
        today_str = datetime.now().strftime("%Y-%m-%d")

        def _get_bars(sym_str: str):
            if sym_str not in bars_cache:
                try:
                    bars_cache[sym_str] = self.adapter.fetch_bars(sym_str, days=250)["bars"]
                except Exception:
                    bars_cache[sym_str] = []
            return bars_cache[sym_str]

        for e in entries:
            e = dict(e)
            try:
                ep, xp, sh = float(e.get("entry_price") or 0), float(e.get("exit_price") or 0), float(e.get("shares") or 0)
            except (TypeError, ValueError):
                out.append(e)
                continue
            fees = float(e.get("fees") or 0)
            ed, xd = str(e.get("entry_time", "")), str(e.get("exit_time", ""))
            is_open = is_open_entry(e)
            sym = str(e.get("symbol") or "").strip()
            if is_open and sym:
                bars = _get_bars(sym)
                if bars:
                    xp = float(bars[-1].close)
                    e["exit_price"] = round(xp, 4)
                    e["price_date"] = bars[-1].timestamp
            if ep and xp and sh:
                e["net_pnl"] = round((xp - ep) * sh - fees, 2)
            if ep and xp:
                e["return_pct"] = round((xp / ep - 1) * 100, 2)
            if date_re.match(ed) and date_re.match(xd):
                e["holding_days"] = (datetime.strptime(xd[:10], "%Y-%m-%d") - datetime.strptime(ed[:10], "%Y-%m-%d")).days
            elif date_re.match(ed) and is_open:
                e["holding_days"] = max(1, (datetime.strptime(today_str, "%Y-%m-%d") - datetime.strptime(ed[:10], "%Y-%m-%d")).days)
            if date_re.match(xd) and e.get("high_5d_after_exit") in (None, "", 0) and sym:
                bars = _get_bars(sym)
                after = [b for b in bars if b.timestamp > xd[:10]][:5]
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
            shares=float(g("shares")),
            pnl_amount=float(g("pnl_amount", "net_pnl")),
            pnl_pct=float(g("pnl_pct", "return_pct")),
            holding_days=int(g("holding_days")),
            post_exit_5d_high=float(g("post_exit_5d_high", "high_5d_after_exit")),
            emotion_score=int(g("emotion_score")),
        )

    def _open_positions(self, payload: Dict[str, Any], open_entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """持有中的部位：交易紀錄裡標成持有中的，加上「我的持股」（前端一起送來），用最新收盤價算帳面損益。"""
        rows = [dict(e) for e in open_entries]
        seen = {str(e.get("symbol", "")).split(".")[0].upper() for e in rows}
        for h in payload.get("holdings") or []:
            sym = str(h.get("symbol") or "").strip()
            if not sym or sym.split(".")[0].upper() in seen or not float(h.get("shares") or 0) > 0:
                continue
            seen.add(sym.split(".")[0].upper())
            rows.append({"trade_id": "持股", "symbol": sym, "side": "BUY", "entry_time": h.get("opened") or "",
                         "exit_time": "持有中", "entry_price": h.get("cost"), "exit_price": h.get("cost"),
                         "shares": h.get("shares"), "source": "我的持股"})
        out = self._enrich_journal(rows)
        for e in out:
            e.pop("high_5d_after_exit", None)  # 還沒賣，沒有「出場後」可言
            e["current_price"] = e.pop("exit_price", None)
        return out

    def handle_mod5_coach(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        raw_entries = payload.get("entries")
        mine = bool(payload.get("mine"))  # 使用者自己的紀錄：沒有已平倉交易時也不要改用範例
        open_entries: List[Dict[str, Any]] = []
        if raw_entries or mine:
            raw_entries = raw_entries or []
            open_entries = [e for e in raw_entries if is_open_entry(e)]
            raw_entries = self._enrich_journal([e for e in raw_entries if not is_open_entry(e)]) + open_entries
            entries = [self._to_journal_entry(e) for e in raw_entries if not is_open_entry(e)]
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
        rules_source = "依你的交易紀錄計算門檻的規則（未使用 AI；每條附計算方式）"
        if not entries:
            rules_source = "還沒有已平倉交易，先不產生個人規則"
        elif ai_client.is_enabled(payload.get("ai")):
            try:
                ai_rules = ai_client.personal_rules(payload["ai"], stats, biases, fallback=rules)
                n_ai = sum(1 for r in ai_rules if r.get("source") == "AI")
                rules = ai_rules
                rules_source = f"AI（{payload['ai'].get('model')}）依你的交易統計與偏誤產生，已檢查每條都有數字門檻"
                if n_ai < len(ai_rules):
                    rules_source += f"；其中 {len(ai_rules) - n_ai} 條 AI 寫得不合格（重寫一次仍不行），改用依交易紀錄計算的規則補上"
            except ai_client.AIError as e:
                rules_source = f"AI 產生失敗，改用依交易紀錄計算的規則（{e}）"

        return {
            "module": 5,
            "statistics": stats,
            "detected_biases": biases,
            "personalized_3_rules": rules,
            "rules_source": rules_source,
            "entries_used": raw_entries if (raw_entries or mine) else None,
            "closed_trades_used": len(entries),
            "open_positions": self._open_positions(payload, open_entries) if (mine or raw_entries or payload.get("holdings")) else [],
        }
