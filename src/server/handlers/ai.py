"""AI 連線測試、模型清單、偵測本機模型、AI 解讀"""

from typing import Dict, Any

from src.ai import ai_client, ai_context


class AIHandlers:
    """AI 連線測試、模型清單、偵測本機模型、AI 解讀"""

    def handle_ai(self, action: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        profile = payload.get("profile") or {}
        try:
            if action == "test":
                return ai_client.test(profile)
            if action == "detect":
                return {"runtimes": ai_client.detect_local()}
            if action == "models":
                if profile.get("type") == "openrouter":
                    return ai_client.openrouter_models(profile)
                return {"models": ai_client.list_models(profile)}
            if action == "explain":
                module, data = str(payload.get("module", "")), payload.get("data")
                context = None
                symbol = ai_context.symbol_of(module, data)
                if symbol and module in ai_context.SECTIONS_BY_MODULE and ai_client.is_enabled(profile):
                    context = ai_context.build(symbol, ai_context.pick_sections(module, payload.get("aspects")))
                return ai_client.explain(profile, module, data, str(payload.get("question", "")), context)
        except ai_client.AIError as e:
            return {"error": ai_client.friendly_error(e)}
        return {"error": f"未知的 AI 動作：{action}"}

    def handle_ai_context(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """預覽「會送給 AI 的資料面向」（不呼叫 AI、不花費用），給 AI 抽屜勾選面向用。"""
        return ai_context.preview(str(payload.get("symbol", "")), str(payload.get("module", "stock")))

    def handle_ai_explain_stream(self, payload: Dict[str, Any]):
        """串流版 AI 解讀：依序產出 status / delta / done 事件。"""
        profile = payload.get("profile") or {}
        try:
            module, data = str(payload.get("module", "")), payload.get("data")
            context = None
            symbol = ai_context.symbol_of(module, data)
            if symbol and module in ai_context.SECTIONS_BY_MODULE and ai_client.is_enabled(profile):
                yield {"type": "status", "status": f"正在整理 {symbol} 的價格、籌碼、評價與新聞資料…"}
                context = ai_context.build(symbol, ai_context.pick_sections(module, payload.get("aspects")))
            yield {"type": "status", "status": "已送交 AI 模型，等待回應中…"}
            for ev in ai_client.explain_stream(profile, module, data, str(payload.get("question", "")), context):
                yield ev
        except Exception as e:
            yield {"type": "error", "error": ai_client.friendly_error(e)}
