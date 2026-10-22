"""
LLM 結構化推論與防幻覺閘門模組 (llm_runner.py)
嚴格遵循：
- Rule 5: 僅將 LLM 用於非結構化摘要、分類與決策文案草擬；所有數學計算、指標、Tick 對齊與狀態路由 100% 由 Python 處理。
- Rule 12: 清楚回報執行模式（LIVE_GEMINI / LIVE_OPENAI / DETERMINISTIC_RULE_ENGINE），若未設定 API Key 或外部 API 錯誤絕不隱藏。
- 防幻覺強制驗收：LLM 回傳之結構化 JSON 必須通過 AntiHallucinationGuard.inspect_decision_payload() 檢查。
"""

from typing import Dict, Any, Optional
import urllib.request
import json
import os

from src import ai_client
from src.anti_hallucination import AntiHallucinationGuard
from src.market_rules import align_tw_tick


class LLMRunner:
    """結構化 LLM 推論與防幻覺驗證器"""

    def __init__(
        self,
        provider: str = "AUTO",
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        timeout: int = 12,
        profile: Optional[Dict[str, Any]] = None,
    ):
        self.profile = profile  # 「設定」頁的 AI 連線設定（優先於舊的 provider/api_key）
        self.provider = provider.upper()
        self.gemini_key = api_key or os.environ.get("GEMINI_API_KEY", "")
        self.openai_key = api_key or os.environ.get("OPENAI_API_KEY", "")
        self.model = model
        self.timeout = timeout

    def generate_technical_decision(
        self, snapshot: Dict[str, Any], custom_prompt: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        根據 data_adapter.build_technical_snapshot() 預先算好的客觀指標生成結構化決策，
        並強制通過 AntiHallucinationGuard 驗收。
        """
        guard = AntiHallucinationGuard(
            historical_high=snapshot["historical_high"],
            historical_low=snapshot["historical_low"],
            valid_indicators={
                k: v for k, v in snapshot["indicators"].items() if isinstance(v, (int, float))
            },
        )

        prompt_text = custom_prompt or self._build_mod1_prompt(snapshot)

        # 決定是否呼叫外部 LLM API
        llm_raw_payload: Optional[Dict[str, Any]] = None
        ai_rejected: Optional[Dict[str, Any]] = None
        execution_mode = "DETERMINISTIC_RULE_ENGINE"
        llm_notice = "未偵測到外部 LLM API Key，已由本地量化決策規則引擎直接產出 100% 合規報告（可在前端設定 API Key 切換為即時 LLM 推論）。"

        if ai_client.is_enabled(self.profile):
            try:
                raw = ai_client.complete(self.profile, ai_client.SYSTEM_GUARD, prompt_text, json_mode=True,
                                         timeout=150)
                candidate = self._extract_json(raw)
                issues = self._sanity_issues(candidate, snapshot, prompt_text)
                if issues:
                    ai_rejected = candidate
                    raise ValueError("AI 的輸出沒有通過合理性檢查：" + "；".join(issues))
                if "step_by_step_rationale" not in candidate and candidate.get("rationale"):
                    candidate["step_by_step_rationale"] = candidate["rationale"]
                llm_raw_payload = candidate
                execution_mode = f"LIVE_AI:{self.profile.get('type')}:{self.profile.get('model')}"
                llm_notice = f"已透過「{self.profile.get('name') or self.profile.get('type')}」完成結構化推論，並經防幻覺稽核。"
            except Exception as e:
                llm_notice = (
                    f"AI 已回覆但未通過檢查，已改用規則引擎。原因：{e}"
                    if ai_rejected is not None
                    else f"AI 呼叫失敗（{e}），已改用本地量化決策規則引擎。"
                )
        elif self.gemini_key and self.provider in ("AUTO", "GEMINI"):
            try:
                llm_raw_payload = self._call_gemini_json(prompt_text)
                execution_mode = "LIVE_GEMINI_API"
                llm_notice = "已透過 Google Gemini API 完成結構化推論。"
            except Exception as e:
                llm_notice = f"Gemini API 呼叫失敗 ({e})，自動切換至本地量化決策規則引擎。"
        elif self.openai_key and self.provider in ("AUTO", "OPENAI"):
            try:
                llm_raw_payload = self._call_openai_json(prompt_text)
                execution_mode = "LIVE_OPENAI_API"
                llm_notice = "已透過 OpenAI API 完成結構化推論。"
            except Exception as e:
                llm_notice = f"OpenAI API 呼叫失敗 ({e})，自動切換至本地量化決策規則引擎。"

        if llm_raw_payload is None:
            llm_raw_payload = self._deterministic_technical_decision(snapshot)

        # 強制通過 AntiHallucinationGuard 防價格幻覺檢查
        audit_result = guard.inspect_decision_payload(llm_raw_payload)

        return {
            "execution_mode": execution_mode,
            "notice": llm_notice,
            "decision_payload": llm_raw_payload,
            "ai_rejected_payload": ai_rejected,
            "anti_hallucination_audit": audit_result,
            "prompt_used": prompt_text,
        }

    @staticmethod
    def _sanity_issues(p: Dict[str, Any], snapshot: Dict[str, Any], prompt_text: str) -> list:
        """AI 決策的合理性檢查（防幻覺閘門只檢查價位範圍，這裡補上邏輯、格式與失效條件）。"""
        from src.market_rules import get_tw_tick_size
        from src.news_strategy import NewsStrategyAnalyzer

        issues = []
        market = snapshot["market"]
        if p.get("action") not in ("BUY", "HOLD", "SELL"):
            issues.append("action 必須是 BUY／HOLD／SELL")
        score = snapshot.get("trend_score") or {}
        if p.get("action") == "BUY" and score.get("buy_blocked"):
            issues.append("違反嚴進規則仍給 BUY：" + "；".join(score.get("hard_rules", [])))
        ot = p.get("order_type")
        if market == "TW" and ot not in ("ROD", "IOC", "FOK"):
            issues.append(f"台股委託別必須是 ROD／IOC／FOK（收到 {ot}）")
        if market == "US" and ot not in ("LIMIT", "MARKET", "STOP", "STOP_LIMIT"):
            issues.append(f"美股委託別不合法（收到 {ot}）")
        try:
            entry, stop = float(p["entry_price"]), float(p["stop_loss_price"])
            target = float(p["take_profit_target"]) if p.get("take_profit_target") is not None else None
            if p.get("action") in ("BUY", "HOLD"):
                if not stop < entry:
                    issues.append("停損價必須低於進場價")
                if target is not None and not target > entry:
                    issues.append("目標價必須高於進場價")
            if market == "TW":
                for name, v in (("進場價", entry), ("停損價", stop)):
                    tick = get_tw_tick_size(v)
                    if abs(v / tick - round(v / tick)) > 1e-6:
                        issues.append(f"{name} {v} 不符合台股跳動檔位 {tick}")
        except (KeyError, TypeError, ValueError):
            issues.append("缺少或無法解析 entry_price／stop_loss_price")
        inv = NewsStrategyAnalyzer(market=market).validate_invalidation_criteria(
            str(p.get("invalidation_criteria", "")))
        if not inv.get("valid"):
            issues.append("失效條件不夠具體：" + str(inv.get("reason", "")))
        rationale = p.get("rationale") or p.get("step_by_step_rationale") or []
        text = " ".join(map(str, rationale)) if isinstance(rationale, list) else str(rationale)
        bad = ai_client.unverified_numbers(text, prompt_text)
        if bad:
            issues.append("推論文字出現資料裡沒有的數字：" + "、".join(bad[:5]))
        return issues

    @staticmethod
    def _extract_json(raw: str) -> Dict[str, Any]:
        """從模型回覆中取出 JSON（容忍 ```json 圍欄與前後說明文字）。"""
        text = raw.strip()
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("模型回覆中找不到 JSON")
        return json.loads(text[start : end + 1])

    @staticmethod
    def _score_prompt_line(snapshot: Dict[str, Any]) -> str:
        score = snapshot.get("trend_score")
        if not score:
            return ""
        d = score["details"]
        line = (f"程式端 100 分趨勢評分：{score['total']}（趨勢{score['breakdown']['trend']}/30、"
                f"乖離{score['breakdown']['bias']}/20、MACD{score['breakdown']['macd']}/15、"
                f"量能{score['breakdown']['volume']}/15、RSI{score['breakdown']['rsi']}/10、"
                f"支撐{score['breakdown']['support']}/10），訊號＝{score['signal_label']}；"
                f"{d['alignment_label']}、MACD {d['macd_label']}、{d['volume_label']}、距 MA5 乖離 {d['bias_ma5_pct']}%\n")
        if score["hard_rules"]:
            line += "嚴進規則已觸發（action 不得為 BUY）：" + "；".join(score["hard_rules"]) + "\n"
        return line

    @staticmethod
    def _build_mod1_prompt(snapshot: Dict[str, Any]) -> str:
        ind = snapshot["indicators"]
        return (
            f"你是一位資深台美股量化分析師。請嚴格根據以下系統預先算好的客觀數據輸出 JSON 決策，禁止自行心算或捏造歷史區間外的價格。\n"
            f"標的：{snapshot['symbol']} (市場：{snapshot['market']} / 最小跳動：{snapshot['tick_size']})\n"
            f"最新收盤價：{snapshot['latest_close']} (歷史區間：[{snapshot['historical_low']}, {snapshot['historical_high']}])\n"
            f"預算均線：MA5={ind['MA5']}, MA20={ind['MA20']}, MA60={ind['MA60']}, MA200={ind['MA200']}\n"
            f"動能指標：RSI14={ind['RSI14']}, MACD_DIF={ind['MACD_DIF']}, MACD_HIST={ind['MACD_HIST']}, ATR14={ind['ATR14']}\n"
            f"系統識別支撐位：{snapshot['support_levels']}\n"
            f"系統識別壓力位：{snapshot['resistance_levels']}\n"
            + LLMRunner._score_prompt_line(snapshot)
            + f"請回傳 JSON 格式包含：action ('BUY'|'HOLD'|'SELL'), support_levels (陣列), resistance_levels (陣列), "
            f"entry_price, stop_loss_price, take_profit_target, order_type（台股只能 'ROD'|'IOC'|'FOK'；美股 'LIMIT'|'MARKET'）, "
            f"invalidation_criteria（必須含具體價位數字的失效條件）, step_by_step_rationale（字串陣列，逐步理由，只能引用上面給的數字）。"
        )

    @staticmethod
    def _deterministic_technical_decision(snapshot: Dict[str, Any]) -> Dict[str, Any]:
        """純確定性量化決策樹（遵循 Rule 5：狀態與指標明確時直接由程式碼精準給出基準決策）"""
        close = snapshot["latest_close"]
        market = snapshot["market"]
        ind = snapshot["indicators"]
        ma5 = ind.get("MA5") or close
        ma20 = ind.get("MA20") or close
        rsi14 = ind.get("RSI14") or 50.0
        atr14 = ind.get("ATR14") or (close * 0.02)

        supports = snapshot["support_levels"]
        resistances = snapshot["resistance_levels"]

        # 決定多空動作：以 100 分趨勢評分的訊號為準（含 RSI≥80、乖離>5% 不買的嚴進規則）
        score = snapshot.get("trend_score")
        if score:
            action = {"STRONG_BUY": "BUY", "BUY": "BUY", "STRONG_SELL": "SELL", "SELL": "SELL"}.get(
                score["signal"], "HOLD")
        elif close >= ma20 and 45.0 <= rsi14 <= 72.0:
            action = "BUY"
        elif close < ma20 and rsi14 < 42.0:
            action = "SELL"
        else:
            action = "HOLD"
        order_type = ("IOC" if action == "SELL" else "ROD") if market == "TW" else "LIMIT"

        raw_entry = supports[-1] if supports else close
        raw_stop = max(snapshot["historical_low"], round(raw_entry - atr14 * 1.2, 2))
        raw_target = resistances[-1] if resistances else round(close + atr14 * 1.5, 2)

        if market == "TW":
            entry_price = align_tw_tick(raw_entry, mode="floor")
            stop_loss = align_tw_tick(raw_stop, mode="floor")
            take_profit = align_tw_tick(raw_target, mode="ceil")
        else:
            entry_price = round(raw_entry, 2)
            stop_loss = round(raw_stop, 2)
            take_profit = round(raw_target, 2)

        return {
            "symbol": snapshot["symbol"],
            "market": market,
            "action": action,
            "order_type": order_type,
            "entry_price": entry_price,
            "take_profit_target": take_profit,
            "stop_loss_price": stop_loss,
            "support_levels": supports,
            "resistance_levels": resistances,
            "invalidation_criteria": f"若日線收盤正式跌破關鍵支撐價位 {stop_loss} 或單日爆量長黑跌破 MA20 ({round(ma20, 2)})，多頭結構失效立即停損出場。",
            "step_by_step_rationale": [
                f"1. 均線結構：最新收盤價 {close} 對比 MA5 ({round(ma5, 2)}) 與 MA20 ({round(ma20, 2)})，均由程式端還權 K 線精確計算。",
                f"2. 動能與波動：RSI(14) 為 {rsi14}，ATR(14) 真實波動為 {atr14}，所有支撐 {supports} 與壓力 {resistances} 均符合市場 Tick 規範。",
                f"3. 執行紀律：建議以 {order_type} 委託於 {entry_price} 布局，防守停損設於 {stop_loss}。",
            ] + ([
                f"4. 趨勢評分 {score['total']}/100（{score['signal_label']}）："
                f"{score['details']['alignment_label']}、MACD {score['details']['macd_label']}、"
                f"{score['details']['volume_label']}、距 MA5 乖離 {score['details']['bias_ma5_pct']}%。"
                + ("".join(f" 嚴進規則：{r}。" for r in score["hard_rules"]))
            ] if score else []),
        }

    def _call_gemini_json(self, prompt: str) -> Dict[str, Any]:
        model_name = self.model or "gemini-2.5-flash"
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={self.gemini_key}"
        body = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.1,
                "responseMimeType": "application/json",
            },
        }
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        return json.loads(text)

    def _call_openai_json(self, prompt: str) -> Dict[str, Any]:
        model_name = self.model or "gpt-4o-mini"
        url = "https://api.openai.com/v1/chat/completions"
        body = {
            "model": model_name,
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": "You are a quantitative trading assistant. Always output valid JSON."},
                {"role": "user", "content": prompt},
            ],
        }
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.openai_key}",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        text = data["choices"][0]["message"]["content"]
        return json.loads(text)
