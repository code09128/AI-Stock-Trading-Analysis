"""
統一的 AI 連線層 (ai_client.py) — 全系統共用，不綁定特定廠商
一個「連線設定 (profile)」長這樣（由前端「設定」頁管理，存在瀏覽器，每次呼叫時帶上）：
  {"type": "gemini" | "openai" | "anthropic" | "openrouter" | "openai_compatible" | "rules",
   "base_url": "...", "model": "...", "api_key": "...", "name": "..."}
- gemini / openai / anthropic：雲端服務（可改 base_url 走代理）。
- openrouter：一把金鑰可用多家模型（含 :free 免費模型）；回應會附實際花費，模型清單附單價。
- openai_compatible：本地或自架（Ollama、LM Studio、llama.cpp server、vLLM、各種閘道），只要支援 /v1/chat/completions。
- rules：不用 AI，使用內建規則引擎。
API Key 留空時，會嘗試讀環境變數 GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY。
AI 只能「解讀」程式算好的數字：explain() 會檢查回答中出現的數字是否真的在提供的資料裡，找不到的會列為「未驗證數字」。
"""

from typing import Any, Dict, List
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request

DEFAULTS = {
    "gemini": "https://generativelanguage.googleapis.com",
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com",
    "openrouter": "https://openrouter.ai/api/v1",
    "openai_compatible": "http://127.0.0.1:11434/v1",  # Ollama 預設
}
ENV_KEYS = {"gemini": "GEMINI_API_KEY", "openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY",
            "openrouter": "OPENROUTER_API_KEY"}
# OpenRouter 建議帶上的來源標示（只用於對方後台統計，不含個人資料）
OPENROUTER_HEADERS = {"HTTP-Referer": "http://127.0.0.1:8088", "X-Title": "TW-US Trading Analyzer"}

SYSTEM_GUARD = (
    "你是一位在台股與美股有 20 年經驗的研究主管兼交易員，待過外資券商研究部與自營部，"
    "現在要在晨會上對交易員與客戶簡報。寫法像券商研究報告與盤後評論：結論先行、數字說話、有立場、講得出理由，也講得出自己可能錯在哪。\n"
    "【資料紀律（最重要）】\n"
    "- 只能使用提供的資料中的數字。價格、價位、指標、日期、統計值都不得自行編造或憑記憶補充。\n"
    "- 支撐、壓力、停損、目標價一律引用資料裡系統算好的價位（例如 support_levels、resistance_levels、scenarios.levels、"
    "decision 的 entry／stop_loss／target）；資料沒有的價位不要寫。自己用資料算出的數字（例如距離 %、賺賠比）要標「（推算）」。\n"
    "- 資料沒有的面向直接寫「資料不足：缺 XXX」，不要猜，也不要用一般常識補。"
    "事件與日期（財報日、選舉、政策、產品發表）也只能引用資料裡出現的新聞標題或系統提供的日期。\n"
    "【針對使用者的實際狀況】\n"
    "- 資料裡有「我的持股部位」時，使用者已經持有這檔：建議要以他的成本與目前損益為出發點（續抱、加碼、減碼、停損放哪），"
    "用「你」稱呼，不要只寫空手者的進場建議。\n"
    "- 有「使用者想問」時，先在最相關的段落正面回答問題，再補充其他分析。\n"
    "【寫作風格】\n"
    "- 第一行就給結論。不要寒暄、不要開場白，不要寫「以下是分析」「根據您提供的資料」。\n"
    "- 用研究部的口吻，例如「我們看法」「市場目前在定價的是…」「預期差在於…」「這裡的風險報酬不對稱」，"
    "每個判斷都要接「因為（引用哪個數字）」。\n"
    "- 禁用空話：「值得注意的是」「綜合來看」「整體而言」「需持續關注」（除非同時寫出要看什麼、門檻是多少）、"
    "「建議投資人審慎評估」「股市瞬息萬變」「僅供參考」。\n"
    "- 先寫重要的，不要每個指標都平均描述；彼此矛盾的訊號要明講，並判斷哪一邊比較重要、為什麼。\n"
    "- 只用繁體中文（台灣用語：成交量、融資、法人、停損、加碼、減碼），不要出現簡體字。專業術語第一次出現時用括號補一句白話。\n"
    "- 數學與比較符號請直接寫 ≥、≤、×、÷、±、≈、→，禁止使用 LaTeX 語法（例如不要寫 $\\ge$、$\\times$）。\n"
    "- 結尾只寫一行：「以上依系統資料整理的研究觀點，非個人化投資建議。」不要再加其他免責段落。"
)

# 結構化輸出（JSON）用：只要資料紀律，不要報告格式與結尾聲明，否則會破壞 JSON
JSON_GUARD = (
    "你是台股／美股的量化分析助理。只能使用提供的資料中的數字，不得自行編造或憑記憶補充價格、指標、日期或統計值；"
    "資料不足時照實說明。文字欄位用繁體中文（台灣用語）。"
)

# ---------- 用量紀錄 ----------
# 每個 API 請求在自己的執行緒裡收集這次呼叫 AI 用掉的 tokens；api_server 會附在回應的 ai_usage 欄位，
# 前端記到瀏覽器並依「設定」頁填的單價估算費用。伺服器本身不保存。
_TLS = threading.local()


def begin_usage() -> None:
    _TLS.items = []


def collect_usage() -> List[Dict[str, Any]]:
    items = getattr(_TLS, "items", None) or []
    _TLS.items = None
    return items


def usage_from_response(provider: str, r: Any) -> Dict[str, Any]:
    """從各家回應取出 tokens：Gemini usageMetadata（思考 tokens 算輸出）、Claude／OpenAI 相容 usage。"""
    try:
        if provider == "gemini":
            u = r.get("usageMetadata") or {}
            out = (u.get("candidatesTokenCount") or 0) + (u.get("thoughtsTokenCount") or 0)
            return {"input_tokens": u.get("promptTokenCount"), "output_tokens": out if u else None}
        u = r.get("usage") or {}
        if provider == "anthropic":
            inp = (u.get("input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0) + (
                u.get("cache_read_input_tokens") or 0)
            return {"input_tokens": inp if u else None, "output_tokens": u.get("output_tokens")}
        out = {"input_tokens": u.get("prompt_tokens"), "output_tokens": u.get("completion_tokens")}
        if provider == "openrouter" and isinstance(u.get("cost"), (int, float)):
            out["cost_usd"] = float(u["cost"])  # OpenRouter 回報的實際扣款（美元）
        return out
    except AttributeError:
        return {"input_tokens": None, "output_tokens": None}


def record_usage(provider: str, model: str, name: str, r: Any, started: float) -> None:
    items = getattr(_TLS, "items", None)
    if items is None:
        return
    u = usage_from_response(provider, r)
    items.append({
        "time": time.strftime("%Y-%m-%d %H:%M:%S"),
        "provider": provider,
        "local": provider == "openai_compatible",
        "model": model,
        "profile": name or provider,
        "input_tokens": u["input_tokens"],
        "output_tokens": u["output_tokens"],
        "cost_usd": u.get("cost_usd"),
        "reported": u["input_tokens"] is not None or u["output_tokens"] is not None,
        "latency_ms": int((time.time() - started) * 1000),
    })


class AIError(RuntimeError):
    pass


def is_enabled(profile: Dict[str, Any] | None) -> bool:
    return bool(profile) and profile.get("type") not in (None, "", "rules")


def _key(profile: Dict[str, Any]) -> str:
    return (profile.get("api_key") or os.environ.get(ENV_KEYS.get(profile.get("type", ""), ""), "")).strip()


def _base(profile: Dict[str, Any]) -> str:
    base = (profile.get("base_url") or DEFAULTS.get(profile.get("type", ""), "")).strip().rstrip("/")
    if not re.match(r"^https?://", base):
        raise AIError("網址必須以 http:// 或 https:// 開頭")
    return base


def _mask(text: str, secret: str) -> str:
    return text.replace(secret, "***") if secret else text


RETRY_WAITS = (3, 8)  # 雲端模型忙碌（503）或請求太頻繁（429）時，等幾秒再試


def _request(url: str, headers: Dict[str, str], body: Dict[str, Any] | None, timeout: int, secret: str) -> Any:
    for wait in (*RETRY_WAITS, None):
        try:
            return _request_once(url, headers, body, timeout, secret)
        except AIError as e:
            if wait is None or not re.match(r"HTTP (503|429)", str(e)):
                raise
            time.sleep(wait)


def _request_once(url: str, headers: Dict[str, str], body: Dict[str, Any] | None, timeout: int, secret: str) -> Any:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", **headers},
                                 method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = _mask(e.read().decode("utf-8", "replace")[:300], secret)
        raise AIError(f"HTTP {e.code}：{detail}") from None
    except Exception as e:
        raise AIError(_mask(str(e), secret)) from None


def estimate_tokens(text: str) -> int:
    """粗估 token 數：中日韓文字約 1 字 1 token，其他（英數、JSON 符號）約 3.5 字元 1 token。"""
    cjk = sum(1 for c in text if "⺀" <= c <= "鿿" or "＀" <= c <= "￯")
    return cjk + (len(text) - cjk) // 3 + 1


_OLLAMA_CACHE: Dict[str, bool] = {}


def _ollama_root(base: str) -> str:
    return re.sub(r"/v1/?$", "", base)


def _is_ollama(base: str) -> bool:
    """Ollama 的 OpenAI 相容端點不能調上下文長度（預設 4096，超過會默默砍掉前面的資料），要改走原生 /api/chat。"""
    root = _ollama_root(base)
    if root not in _OLLAMA_CACHE:
        try:
            _OLLAMA_CACHE[root] = "version" in _request(f"{root}/api/version", {}, None, 3, "")
        except AIError:
            _OLLAMA_CACHE[root] = False
    return _OLLAMA_CACHE[root]


def _ollama_chat(profile: Dict[str, Any], model: str, base: str, system: str, user: str, json_mode: bool,
                 timeout: int, started: float) -> str:
    need = estimate_tokens(system + user) + 2500  # 加上回答的空間
    num_ctx = next((c for c in (8192, 16384, 32768) if c >= need), 32768)
    body: Dict[str, Any] = {"model": model, "stream": False, "think": bool(profile.get("think")),
                            "options": {"num_ctx": num_ctx},
                            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    if json_mode:
        body["format"] = "json"
    url = f"{_ollama_root(base)}/api/chat"
    try:
        r = _request(url, {}, body, max(timeout, 180), "")
    except AIError as e:
        if "HTTP 400" not in str(e):
            raise
        body.pop("think", None)  # 舊版 Ollama 不認得 think 參數
        r = _request(url, {}, body, max(timeout, 180), "")
    record_usage("openai_compatible", model, profile.get("name", ""),
                 {"usage": {"prompt_tokens": r.get("prompt_eval_count"), "completion_tokens": r.get("eval_count")}},
                 started)
    try:
        return r["message"]["content"] or ""
    except (KeyError, TypeError):
        raise AIError(f"Ollama 回應格式異常：{str(r)[:200]}") from None


def complete(profile: Dict[str, Any], system: str, user: str, json_mode: bool = False,
             timeout: int = 90) -> str:
    t = profile.get("type")
    model = (profile.get("model") or "").strip()
    if t not in DEFAULTS:
        raise AIError(f"不支援的 AI 類型：{t}")
    if not model:
        raise AIError("尚未選擇模型（請到「設定」頁填入或按「取得模型清單」）")
    key, base = _key(profile), _base(profile)
    if t != "openai_compatible" and not key:
        raise AIError("尚未填入 API Key")
    started = time.time()
    if t == "gemini":
        body: Dict[str, Any] = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
        }
        if json_mode:
            body["generationConfig"] = {"responseMimeType": "application/json"}
        r = _request(f"{base}/v1beta/models/{model}:generateContent", {"x-goog-api-key": key}, body, timeout, key)
        record_usage(t, model, profile.get("name", ""), r, started)
        try:
            return "".join(p.get("text", "") for p in r["candidates"][0]["content"]["parts"])
        except (KeyError, IndexError):
            raise AIError(f"Gemini 回應格式異常：{str(r)[:200]}") from None
    if t == "anthropic":
        r = _request(f"{base}/v1/messages", {"x-api-key": key, "anthropic-version": "2023-06-01"},
                     {"model": model, "max_tokens": 2048, "system": system,
                      "messages": [{"role": "user", "content": user}]}, timeout, key)
        record_usage(t, model, profile.get("name", ""), r, started)
        try:
            return "".join(b.get("text", "") for b in r["content"] if b.get("type") == "text")
        except (KeyError, TypeError):
            raise AIError(f"Anthropic 回應格式異常：{str(r)[:200]}") from None
    if t == "openai_compatible" and _is_ollama(base):
        return _ollama_chat(profile, model, base, system, user, json_mode, timeout, started)
    # openai / openrouter / openai_compatible（同一套 /chat/completions 格式）
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    body = {"model": model, "stream": False,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    if t == "openrouter":
        headers.update(OPENROUTER_HEADERS)
        body["usage"] = {"include": True}  # 要求回報實際花費
    if json_mode:
        body["response_format"] = {"type": "json_object"}  # Ollama / LM Studio 等也支援，能大幅降低 JSON 格式錯誤
    if t == "openai_compatible" and not profile.get("think"):
        # 本地「思考型」模型（如 qwen3.5）預設關閉長篇思考：快數十倍，且不會把 JSON 吃掉
        body["reasoning_effort"] = "none"
    try:
        r = _request(f"{base}/chat/completions", headers, body, timeout, key)
    except AIError as e:
        local_retry = t == "openai_compatible" and "HTTP 4" in str(e)
        # OpenRouter 上部分模型不支援 JSON 模式，回 400 時改用一般模式重試
        router_retry = t == "openrouter" and json_mode and "HTTP 400" in str(e)
        if local_retry or router_retry:
            body.pop("response_format", None)  # 少數伺服器不認這些參數，退回一般模式重試
            body.pop("reasoning_effort", None)
            r = _request(f"{base}/chat/completions", headers, body, timeout, key)
        else:
            raise
    record_usage(t, model, profile.get("name", ""), r, started)
    try:
        return r["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError):
        raise AIError(f"回應格式異常：{str(r)[:200]}") from None


def _open_stream(url: str, headers: Dict[str, str], body: Dict[str, Any], timeout: int, secret: str) -> Any:
    """開啟串流 HTTP 連線（遇到 503／429 同樣自動重試）。"""
    data = json.dumps(body).encode("utf-8")
    for wait in (*RETRY_WAITS, None):
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", **headers}, method="POST")
        try:
            return urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            detail = _mask(e.read().decode("utf-8", "replace")[:300], secret)
            err = AIError(f"HTTP {e.code}：{detail}")
            if wait is None or e.code not in (503, 429):
                raise err from None
            time.sleep(wait)
        except Exception as e:
            raise AIError(_mask(str(e), secret)) from None


def _iter_sse_json(resp: Any):
    """逐筆讀取 SSE（data: {...}）或單一 JSON 回應（相容不支援 SSE 的模擬伺服器）。"""
    for raw in resp:
        line = raw.decode("utf-8", "replace").strip()
        if not line or line.startswith(":"):
            continue
        if line.startswith("data:"):
            payload = line[5:].strip()
            if not payload or payload == "[DONE]":
                continue
            try:
                yield json.loads(payload)
            except json.JSONDecodeError:
                continue
        elif line.startswith("{"):
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def complete_stream(profile: Dict[str, Any], system: str, user: str, timeout: int = 180):
    """串流呼叫各家模型，逐段產生 {'type': 'thinking', 'chars': int} 或 {'type': 'delta', 'text': str}。"""
    t = profile.get("type")
    model = (profile.get("model") or "").strip()
    if t not in DEFAULTS:
        raise AIError(f"不支援的 AI 類型：{t}")
    if not model:
        raise AIError("尚未選擇模型（請到「設定」頁填入或按「取得模型清單」）")
    key, base = _key(profile), _base(profile)
    if t != "openai_compatible" and not key:
        raise AIError("尚未填入 API Key")
    started = time.time()
    thought_chars = 0

    if t == "gemini":
        body: Dict[str, Any] = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
        }
        last_u: Dict[str, Any] = {}
        with _open_stream(f"{base}/v1beta/models/{model}:streamGenerateContent?alt=sse",
                          {"x-goog-api-key": key}, body, timeout, key) as resp:
            for obj in _iter_sse_json(resp):
                if obj.get("usageMetadata"):
                    last_u = {"usageMetadata": obj["usageMetadata"]}
                for c in obj.get("candidates") or []:
                    for p in (c.get("content") or {}).get("parts") or []:
                        txt = p.get("text") or ""
                        if p.get("thought") and txt:
                            thought_chars += len(txt)
                            yield {"type": "thinking", "chars": thought_chars}
                        elif txt:
                            yield {"type": "delta", "text": txt}
        record_usage(t, model, profile.get("name", ""), last_u, started)
        return

    if t == "anthropic":
        usage: Dict[str, Any] = {}
        with _open_stream(f"{base}/v1/messages", {"x-api-key": key, "anthropic-version": "2023-06-01"},
                          {"model": model, "max_tokens": 2048, "stream": True, "system": system,
                           "messages": [{"role": "user", "content": user}]}, timeout, key) as resp:
            for obj in _iter_sse_json(resp):
                ut = obj.get("type")
                if ut == "message_start":
                    usage.update((obj.get("message") or {}).get("usage") or {})
                elif ut == "message_delta":
                    usage.update(obj.get("usage") or {})
                elif ut == "content_block_delta":
                    d = obj.get("delta") or {}
                    if d.get("type") == "thinking_delta" and d.get("thinking"):
                        thought_chars += len(d["thinking"])
                        yield {"type": "thinking", "chars": thought_chars}
                    elif d.get("text"):
                        yield {"type": "delta", "text": d["text"]}
                elif obj.get("content"):  # 非串流回應相容
                    for b in obj["content"]:
                        if b.get("type") == "text" and b.get("text"):
                            yield {"type": "delta", "text": b["text"]}
        record_usage(t, model, profile.get("name", ""), {"usage": usage}, started)
        return

    if t == "openai_compatible" and _is_ollama(base):
        need = estimate_tokens(system + user) + 2500
        num_ctx = next((c for c in (8192, 16384, 32768) if c >= need), 32768)
        body = {"model": model, "stream": True, "think": bool(profile.get("think")),
                "options": {"num_ctx": num_ctx},
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        url = f"{_ollama_root(base)}/api/chat"
        try:
            resp_ctx = _open_stream(url, {}, body, max(timeout, 180), "")
        except AIError as e:
            if "HTTP 400" not in str(e):
                raise
            body.pop("think", None)
            resp_ctx = _open_stream(url, {}, body, max(timeout, 180), "")
        last_done: Dict[str, Any] = {}
        with resp_ctx as resp:
            for raw in resp:
                line = raw.decode("utf-8", "replace").strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                msg = obj.get("message") or {}
                if msg.get("thinking"):
                    thought_chars += len(msg["thinking"])
                    yield {"type": "thinking", "chars": thought_chars}
                if msg.get("content"):
                    yield {"type": "delta", "text": msg["content"]}
                if obj.get("done"):
                    last_done = obj
        record_usage("openai_compatible", model, profile.get("name", ""),
                     {"usage": {"prompt_tokens": last_done.get("prompt_eval_count"),
                                "completion_tokens": last_done.get("eval_count")}}, started)
        return

    # openai / openrouter / openai_compatible（/chat/completions SSE）
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    body = {"model": model, "stream": True,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    if t == "openrouter":
        headers.update(OPENROUTER_HEADERS)
        body["usage"] = {"include": True}
    elif t == "openai":
        body["stream_options"] = {"include_usage": True}
    if t == "openai_compatible" and not profile.get("think"):
        body["reasoning_effort"] = "none"
    try:
        resp_ctx = _open_stream(f"{base}/chat/completions", headers, body, timeout, key)
    except AIError as e:
        if "HTTP 4" in str(e):
            body.pop("reasoning_effort", None)
            body.pop("stream_options", None)
            resp_ctx = _open_stream(f"{base}/chat/completions", headers, body, timeout, key)
        else:
            raise
    last_u = {}
    with resp_ctx as resp:
        for obj in _iter_sse_json(resp):
            if obj.get("usage"):
                last_u = {"usage": obj["usage"]}
            for ch in obj.get("choices") or []:
                d = ch.get("delta") if "delta" in ch else (ch.get("message") or {})
                th = d.get("reasoning") or d.get("reasoning_content") or ""
                if th:
                    thought_chars += len(th)
                    yield {"type": "thinking", "chars": thought_chars}
                txt = d.get("content") or ""
                if txt:
                    yield {"type": "delta", "text": txt}
    record_usage(t, model, profile.get("name", ""), last_u, started)


def openrouter_models(profile: Dict[str, Any]) -> Dict[str, Any]:
    """OpenRouter 模型清單與單價（換算成美元／每百萬 tokens）；清單不需金鑰。免費模型排前面。"""
    r = _request(f"{_base(profile)}/models", OPENROUTER_HEADERS, None, 20, _key(profile))
    pricing: Dict[str, Dict[str, float]] = {}
    ids: List[str] = []
    for m in r.get("data", []):
        if not m.get("id"):
            continue
        ids.append(m["id"])
        pr = m.get("pricing") or {}
        try:
            p_in, p_out = float(pr.get("prompt") or 0), float(pr.get("completion") or 0)
        except (TypeError, ValueError):
            continue
        if p_in >= 0 and p_out >= 0:  # openrouter/auto 等依實際路由計價的回 -1，不給單價
            pricing[m["id"]] = {"in": round(p_in * 1e6, 4), "out": round(p_out * 1e6, 4)}
    free = {i for i, v in pricing.items() if not v["in"] and not v["out"]}
    return {"models": sorted(ids, key=lambda i: (i not in free, i)), "pricing": pricing}


def list_models(profile: Dict[str, Any]) -> List[str]:
    t = profile.get("type")
    if t not in DEFAULTS:
        raise AIError("此類型沒有模型清單")
    if t == "openrouter":
        return openrouter_models(profile)["models"]
    key, base = _key(profile), _base(profile)
    if t != "openai_compatible" and not key:
        raise AIError("尚未填入 API Key")
    if t == "gemini":
        r = _request(f"{base}/v1beta/models?pageSize=200", {"x-goog-api-key": key}, None, 20, key)
        return sorted(m["name"].split("/", 1)[-1] for m in r.get("models", [])
                      if "generateContent" in m.get("supportedGenerationMethods", []))
    if t == "anthropic":
        r = _request(f"{base}/v1/models?limit=100", {"x-api-key": key, "anthropic-version": "2023-06-01"},
                     None, 20, key)
        return [m["id"] for m in r.get("data", [])]
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    try:
        r = _request(f"{base}/models", headers, None, 15, key)
        return sorted(m["id"] for m in r.get("data", []))
    except AIError:
        if t == "openai_compatible":  # Ollama 原生清單
            root = re.sub(r"/v1$", "", base)
            r = _request(f"{root}/api/tags", {}, None, 15, key)
            return sorted(m["name"] for m in r.get("models", []))
        raise


def test(profile: Dict[str, Any]) -> Dict[str, Any]:
    started = time.time()
    try:
        out = complete(profile, "你是測試助手。", "請只回覆「OK」兩個字。", timeout=45)
        return {"ok": True, "latency_ms": int((time.time() - started) * 1000), "sample": out.strip()[:80]}
    except AIError as e:
        return {"ok": False, "error": str(e)}


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


MODULE_TASKS = {
    "mod1": (
        "請寫一份「盤後技術面快評」，格式如下（用小標題，總長約 400～700 字）：\n"
        "1.【觀點】一行：偏多／中性／偏空｜信心 高／中／低｜時間框架（短線 1～4 週或波段 1～3 個月）｜一句話理由。"
        "觀點必須和後面的核心理由同方向；理由多數偏空就不能寫偏多。\n"
        "2.【核心理由】依重要性列 3 點，每點都要引用數字（趨勢評分、均線排列、量價、法人籌碼、週線位置）。\n"
        "3.【關鍵價位】列出現價、最近的壓力與支撐（引用 scenarios.levels 或支撐壓力），並寫距離現價幾 %（推算）。\n"
        "4.【多空劇本】多頭／中性／空頭各一行：「若＿＿（觸發條件）→ 看＿＿（目標）；失效：＿＿」，直接引用 scenarios 的條件。"
        "說明目前哪個劇本的證據較多，但不要說它一定發生。\n"
        "5.【操作計畫】分「已持有」與「空手」兩種人寫：進場或加碼區、停損價、目標價，算出賺賠比（推算，例如 1：2.1）；"
        "賺賠比低於 1：1.5 就直接說「這個位置不值得進場」。部位大小用風險預算的講法（例如單筆虧損控制在總資金 1%～2%），"
        "不要給具體張數。\n"
        "6.【我可能錯在哪】寫出 1～2 個會推翻觀點的訊號（例如外資轉買、帶量突破某壓力）。\n"
        "7.【接下來盯什麼】列 2～3 個具體觀察點：價位、量能門檻、事件（例如月營收公布、財報日）。"
    ),
    "mod2": (
        "請寫一份「事件快評（Desk Note）」，像券商交易台在消息出來後寫給客戶的短評（約 300～500 字）：\n"
        "1.【定調】一行：真利多／利多出盡／利空測試／雜訊，加上信心高低。\n"
        "2.【市場已經定價了多少】引用事件前 5 日、20 日漲跌與 Priced-in 判斷，說明市場事前預期到什麼程度。\n"
        "3.【預期差】這則消息比市場原本想的更好、更差，還是差不多？引用標題與其他近期新聞，不要編造標題以外的細節。\n"
        "4.【交易含義】隔天開盤的處理方式：追價／等回測再進／不碰／減碼，搭配 ATR 預期波動區間的上下限，以及失效條件。\n"
        "5.【反方解讀】同一則消息的另一種看法，以及會讓這種看法成立的訊號。\n"
        "6.【驗證點】接下來 1～2 週要確認的事（價位、量能、下一個事件）。"
    ),
    "mod3": (
        "請以「量化研究主管審查策略」的口吻寫（約 400～600 字）：\n"
        "1.【審查結論】一行：可以進入模擬交易／需要修正後再測／建議放棄，並說明主因。\n"
        "2.【績效拆解】交易次數、勝率、平均獲利 vs 平均虧損（賺賠比）、獲利因子、最大回撤；指出這個策略是靠「高勝率」還是「大賺小賠」在賺錢。"
        "交易次數少於 30 筆時要明講統計可信度不足。\n"
        "3.【優勢從哪來、在哪失效】引用 regime_breakdown：多頭／盤整／空頭各自的表現，說清楚這是不是只在多頭有效的「順風策略」。\n"
        "4.【過度擬合檢查】引用 walk_forward：前段最佳參數到後段是否失效，你的參數和最佳參數相比如何。\n"
        "5.【下一個實驗】只提 1～2 個，一次只改一條規則，寫出要怎麼用後段資料驗證、什麼結果才算改善。"
    ),
    "mod4": (
        "請以「投資組合經理／風控長做組合健檢」的口吻寫（約 500～800 字）：\n"
        "1.【健檢結論】一行：風險等級 低／中／高／過高，加上最主要的原因。\n"
        "2.【三大風險】依嚴重程度排序，每項都要量化：集中度（單一標的或產業權重、穿透後曝險）、重複押注（相關係數 ≥ 0.7 的配對）、"
        "地區與幣別曝險、拋售時同步下跌的部位。\n"
        "3.【壓力測試怎麼看】市場修正 10%、熊市 20%（Beta 線性推估）與利率上升、經濟衰退（真實歷史回放）的損失金額；"
        "說明哪一種情境對這個組合傷害最大、哪個部位拖累最大。\n"
        "4.【調整建議】依優先順序列 2～3 項具體動作（例如把某產業權重從 X% 降到 Y%、增加低相關資產、避險），"
        "引用再平衡表與避險方式的取捨（成本、缺點）。不要給具體買賣張數。\n"
        "5.【可以不動的地方】指出組合中已經做得好的部分，避免過度調整。"
    ),
    "mod5": (
        "請以「自營部主管帶交易員做月度檢討」的口吻寫，直接但有建設性（約 400～600 字）：\n"
        "1.【一句話診斷】這位交易者最大的問題是什麼（例如「賺小賠大」「虧損單抱太久」「虧損後加碼報復」）。\n"
        "2.【數字說話】勝率、賺賠比、單筆期望值、賣飛率，說明這組數字代表什麼交易習慣。\n"
        "3.【具體案例】引用偵測到的偏誤與交易編號（例如 #03），說明那一筆哪裡做錯、應該怎麼做。\n"
        "4.【三條紀律】每條都要有數字門檻與動作（例如「單筆虧損達 -7% 收盤前無條件出場」），並說明對應哪個壞習慣。\n"
        "5.【下個月的目標】1～2 個可衡量的指標（例如賺賠比從 X 提高到 1.5 以上）。"
    ),
    "stock": (
        "請寫一份「個股研究短報」，像券商研究部的公司報告首頁（約 600～900 字）：\n"
        "1.【標題】一句話投資論點（例如「營收加速、評價仍合理，拉回是布局機會」）。\n"
        "2.【評等與時間框架】相對大盤 優於／中立／劣於，信心高低，時間框架 3～6 個月；說明理由。"
        "有分析師目標價資料時引用（平均、區間、家數）並說明距現價空間；沒有就寫「資料不足：無目標價」，不要自己算目標價。\n"
        "3.【市場怎麼想 vs 我們怎麼看】用「財報與市場預期」的 expectation_gap：哪些已反映在股價、哪些可能讓市場意外（正向或負向），"
        "並引用營收年增、EPS、毛利率、預估上下修、本益比等數字。\n"
        "4.【估值】本益比、前瞻本益比、殖利率等與成長是否匹配；只能用資料中的數字，不要和沒有資料的同業比較。\n"
        "5.【催化劑時間表】接下來可能推動股價的事件與日期（下次財報日、月營收公布、除息日等），沒有日期就寫「資料不足」。\n"
        "6.【三大利多／三大風險】各 3 點，依重要性排序。\n"
        "7.【部位建議】適合當核心持股、衛星部位，還是觀望；以及什麼價位或事件會改變評等。\n"
        "ETF 或債券沒有單一公司財報時，改寫成「配置角色」：成分股集中度、配息穩定度、費用率、在投資組合中適合扮演的角色。"
    ),
}


NOISY_KEYS = {"level_candidates", "MACD_hist", "trades", "equity_curve", "endpoint", "ai_usage"}
MAX_DATA_CHARS = 24000


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


def _build_explain_prompt(profile: Dict[str, Any], module: str, data: Any, question: str = "",
                          context: Dict[str, Any] | None = None):
    if not is_enabled(profile):
        raise AIError("尚未設定 AI 連線，請先到「設定」頁新增")
    page = json.dumps(_clean(data), ensure_ascii=False, separators=(",", ":"))
    extra = json.dumps(_clean(context), ensure_ascii=False, separators=(",", ":")) if context else ""
    data_text = f"【本頁資料】{page}" + (f"\n【補充資料（系統另外整理的同一檔標的多面向資料）】{extra}" if extra else "")
    truncated = len(data_text) > MAX_DATA_CHARS
    if truncated:  # 很少發生；真的超過就明講，不讓 AI 以為資料完整
        data_text = data_text[:MAX_DATA_CHARS] + "\n（資料過長已截斷，後段缺少的面向請標示資料不足）"
    task = MODULE_TASKS.get(module, "請解讀以下資料。")
    # 資料放前面、格式指示放最後：小模型讀完一大段資料容易忘記前面的指示，最後讀到的最會照做
    heads = re.findall(r"【([^】]+)】", task)
    skeleton = "\n".join(f"【{h}】" for h in heads)
    facts = key_facts(module, data)
    user = (f"{data_text}\n\n====\n"
            + (f"【關鍵數字（價位只能用這裡和上面資料裡的，不要自己推估價位）】\n{facts}\n\n" if facts else "")
            + f"【任務】{task}\n"
            + (f"【使用者想問】{question}\n請在對應段落直接回答這個問題。\n" if question else "")
            + (f"\n請直接從下面的骨架開始寫（第一行就是【{heads[0]}】），每個段落都要有內容，不要寫開場白：\n{skeleton}"
               if heads else ""))
    return user, data_text, facts, truncated


def _finalize_explain(profile: Dict[str, Any], answer: str, user: str, data_text: str, facts: str,
                      context: Dict[str, Any] | None, truncated: bool, started: float,
                      begin_count: int) -> Dict[str, Any]:
    if not answer.strip():
        raise AIError("模型回傳空白內容（免費或思考型模型偶爾會發生），請再按一次，或到「設定」換一個模型")
    answer = _strip_opener(to_traditional(answer))
    # 模型實際讀到的 token 明顯少於送出的量＝伺服器上下文太小，前面的資料被砍掉了
    used = (getattr(_TLS, "items", None) or [])[begin_count:]
    got = used[-1]["input_tokens"] if used and used[-1].get("input_tokens") else None
    expected = estimate_tokens(SYSTEM_GUARD + user)
    context_cut = bool(got and got < expected * 0.6)
    return {
        "answer": answer.strip(),
        "model": f"{profile.get('type')}:{profile.get('model')}",
        "latency_ms": int((time.time() - started) * 1000),
        "unverified_numbers": unverified_numbers(answer, data_text + facts),
        "input_chars": len(data_text),
        "context_sections": [k for k in (context or {}) if k not in ("標的", "名稱")],
        "truncated": truncated,
        "context_cut": context_cut,
        "context_note": (f"模型只讀到約 {got} 個 token（送出約 {expected}），前面的資料被模型伺服器截掉，回答可能不完整。"
                         "請在模型伺服器把上下文長度（context length）調到 16K 以上，或改用雲端模型。")
        if context_cut else None,
    }


def explain(profile: Dict[str, Any], module: str, data: Any, question: str = "",
            context: Dict[str, Any] | None = None) -> Dict[str, Any]:
    user, data_text, facts, truncated = _build_explain_prompt(profile, module, data, question, context)
    started = time.time()
    begin_count = len(getattr(_TLS, "items", None) or [])
    answer = complete(profile, SYSTEM_GUARD, user)
    if not answer.strip():  # 思考型或免費模型偶爾把額度用在思考、正文空白：重試一次
        answer = complete(profile, SYSTEM_GUARD, user)
    return _finalize_explain(profile, answer, user, data_text, facts, context, truncated, started, begin_count)


def explain_stream(profile: Dict[str, Any], module: str, data: Any, question: str = "",
                   context: Dict[str, Any] | None = None):
    """串流版 AI 解讀：逐段回傳 status / delta，最後一筆為 done（含完整 answer、數字核對與延遲）。"""
    user, data_text, facts, truncated = _build_explain_prompt(profile, module, data, question, context)
    started = time.time()
    begin_count = len(getattr(_TLS, "items", None) or [])
    answer = ""
    for attempt in range(2):
        buf: List[str] = []
        last_think_emit = 0
        for ev in complete_stream(profile, SYSTEM_GUARD, user):
            if ev.get("type") == "thinking" and not buf:
                c = ev.get("chars", 0)
                if c - last_think_emit >= 60 or last_think_emit == 0:
                    last_think_emit = c
                    yield {"type": "status", "status": f"模型正在推理思考中（已產生 {c} 字推理）…"}
            elif ev.get("type") == "delta" and ev.get("text"):
                chunk = to_traditional(ev["text"])
                buf.append(chunk)
                yield {"type": "delta", "text": chunk}
        answer = "".join(buf)
        if answer.strip():
            break
        if attempt == 0:
            yield {"type": "status", "status": "模型首次回傳空白，正在自動重試…"}
    res = _finalize_explain(profile, answer, user, data_text, facts, context, truncated, started, begin_count)
    yield {"type": "done", **res}


def key_facts(module: str, data: Any) -> str:
    """把各頁最關鍵、最常被模型寫錯的數字整理成一張小卡，緊貼在任務指示前面（小模型最容易照做）。"""
    if not isinstance(data, dict):
        return ""
    out: List[str] = []
    try:
        if module == "mod1":
            snap, sc, dec = data.get("snapshot") or {}, data.get("scenarios") or {}, data.get("decision") or {}
            out.append("｜".join(f"{k} {v}" for k, v in (("標的", snap.get("symbol")), ("現價", snap.get("latest_close")),
                                                       ("資料日期", snap.get("latest_date"))) if v is not None))
            lv = sc.get("levels") or {}
            if lv:
                out.append(f"支撐 S1 {lv.get('S1')}、S2 {lv.get('S2')}｜壓力 R1 {lv.get('R1')}、R2 {lv.get('R2')}｜ATR14 {lv.get('ATR14')}")
            for s in sc.get("scenarios") or []:
                out.append(f"{s['name']}：成立 {s['trigger']}；目標 {s['target']}；失效 {s['invalidation']}")
            if dec:
                e, sl, tp = (dec.get(k) for k in ("entry_price", "stop_loss_price", "take_profit_target"))
                rr = ""
                if all(isinstance(x, (int, float)) for x in (e, sl, tp)) and e != sl:
                    risk, reward = abs(e - sl), abs(tp - e)
                    rr = f"｜賺賠比 1：{reward / risk:.1f}（系統已算好，直接引用，不要自己重算）"
                out.append(f"系統決策 {dec.get('action')}｜進場 {e}｜停損 {sl}｜目標 {tp}{rr}")
            score = snap.get("trend_score") or {}
            if score:
                out.append(f"趨勢評分 {score.get('total')}/100（{score.get('signal_label')}）")
        elif module == "mod2":
            vb = data.get("volatility_bounds") or {}
            pi = data.get("priced_in_evaluation") or {}
            out.append(f"標的 {data.get('symbol')}｜標題：{data.get('headline')}")
            if pi:
                out.append(f"Priced-in 判斷：{json.dumps(pi, ensure_ascii=False)[:300]}")
            if vb:
                out.append(f"ATR 預期波動區間：{json.dumps(vb, ensure_ascii=False)[:300]}")
        elif module == "mod4":
            val = data.get("portfolio_valuation") or {}
            names = [f"{h['symbol']} {h.get('name', '')}".strip() + f" {h.get('weight_pct')}%" for h in val.get("holdings", [])]
            if names:
                out.append("持股（代號 名稱 目前權重）：" + "、".join(names))
            acts = (data.get("rebalance_verification") or {}).get("rebalance_actions") or []
            targets = {a.get("target_weight_pct") for a in acts if a.get("symbol") != "CASH"}
            if len(acts) > 2 and len(targets) == 1:
                out.append("注意：再平衡表的目標權重每檔都一樣，是系統自動平均分配的預設值，不是使用者設定的目標；"
                           "調整建議請依集中度、相關性與壓力測試自己判斷，不要建議「調到平均權重」。")
        elif module == "stock":
            out.append(f"標的 {data.get('symbol')} {data.get('name')}｜類別 {data.get('label')}｜現價 {data.get('price')} {data.get('currency')}")
    except (KeyError, TypeError):
        return ""
    return "\n".join(x for x in out if x)


# ---------- 偵測本機正在執行的模型服務 ----------
LOCAL_RUNTIMES = [
    ("Ollama", "http://127.0.0.1:11434"),
    ("LM Studio", "http://127.0.0.1:1234"),
    ("llama.cpp server", "http://127.0.0.1:8080"),
    ("vLLM", "http://127.0.0.1:8000"),
]


def detect_local() -> List[Dict[str, Any]]:
    """探測本機常見的模型服務，列出『實際安裝／載入』的模型（不是範例）。連不上的服務標示為未偵測到。"""
    out = []
    for name, root in LOCAL_RUNTIMES:
        entry: Dict[str, Any] = {"runtime": name, "base_url": f"{root}/v1", "running": False, "models": []}
        try:
            if name == "Ollama":
                r = _request(f"{root}/api/tags", {}, None, 3, "")
                entry["running"] = True
                for m in r.get("models", []):
                    d = m.get("details") or {}
                    entry["models"].append({
                        "id": m.get("name"),
                        "size_gb": round(m.get("size", 0) / 1e9, 2),
                        "params": d.get("parameter_size"),
                        "quant": d.get("quantization_level"),
                        "family": d.get("family"),
                    })
            else:
                r = _request(f"{root}/v1/models", {}, None, 3, "")
                entry["running"] = True
                entry["models"] = [{"id": m.get("id")} for m in r.get("data", [])]
        except AIError:
            pass
        out.append(entry)
    return out


# ---------- 讓 AI 真的「產出」結果（不只是解讀）的兩個功能 ----------
def _json_call(profile: Dict[str, Any], user: str, timeout: int = 150) -> Dict[str, Any]:
    raw = complete(profile, JSON_GUARD + "只輸出 JSON，不要任何其他文字。", user, json_mode=True, timeout=timeout)
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end <= start:
        raise AIError("模型回覆中找不到 JSON")
    try:
        return json.loads(raw[start : end + 1])
    except json.JSONDecodeError as e:
        raise AIError(f"模型回覆的 JSON 格式錯誤：{e}") from None


def classify_sentiment(profile: Dict[str, Any], headline: str, symbol: str) -> Dict[str, Any]:
    """AI 判斷新聞標題對該股的情緒方向。只回 POSITIVE / NEGATIVE / NEUTRAL 與理由。"""
    out = _json_call(profile, (
        f"判斷這則新聞對股票 {symbol} 的短期影響方向。\n新聞標題：{headline}\n"
        '回傳 JSON：{"sentiment": "POSITIVE"|"NEGATIVE"|"NEUTRAL", "reason": "一句話理由（繁體中文，不要編造數字）"}'
    ), timeout=90)
    s = str(out.get("sentiment", "")).upper()
    if s not in ("POSITIVE", "NEGATIVE", "NEUTRAL"):
        raise AIError(f"情緒結果不合法：{s}")
    return {"sentiment": s, "reason": str(out.get("reason", ""))[:200]}


def personal_rules(profile: Dict[str, Any], stats: Dict[str, Any], biases: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """AI 依據『真實統計＋偵測到的偏誤』寫 3 條個人化交易規則，每條都必須有可量化門檻。"""
    data = json.dumps({"statistics": stats, "detected_biases": biases}, ensure_ascii=False)[:8000]
    out = _json_call(profile, (
        "根據以下交易統計與偵測到的行為偏誤，寫出 3 條專屬這位交易者、可以立刻執行的規則。"
        "每條的 condition 必須含明確數字門檻（百分比、筆數、時間或價位），action 必須是具體動作。"
        "引用交易時請用資料中的交易編號（如 #03）。\n"
        f"【資料】{data}\n"
        '回傳 JSON：{"rules": [{"rule_name": "...", "condition": "...", "action": "...", '
        '"target_bias": "...", "evidence": "引用的交易編號或統計"}]}'
    ))
    rules = out.get("rules")
    if not isinstance(rules, list) or len(rules) < 3:
        raise AIError("AI 沒有產出 3 條規則")
    clean = []
    for i, r in enumerate(rules[:3], start=1):
        cond, act = str(r.get("condition", "")), str(r.get("action", ""))
        if not re.search(r"\d", cond) or len(act) < 4:
            raise AIError(f"第 {i} 條規則缺少數字門檻或具體動作，未採用")
        cjk = re.compile(r"[一-鿿]")
        if not cjk.search(cond) or not cjk.search(act) or re.search(r"&&|\|\||==|[A-Za-z]+_[A-Za-z]+", cond + act):
            raise AIError(f"第 {i} 條規則不是可讀的中文規則（像程式碼或亂碼），未採用")
        clean.append({"rule_number": i, "rule_name": str(r.get("rule_name", f"規則 {i}"))[:40],
                      "condition": cond[:200], "action": act[:200],
                      "target_bias": str(r.get("target_bias", ""))[:60], "evidence": str(r.get("evidence", ""))[:120]})
    return clean
