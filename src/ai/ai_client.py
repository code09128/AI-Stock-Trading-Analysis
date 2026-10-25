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
提示詞（研究主管口吻、各頁任務）在 ai_prompts.py；數字核對、簡轉繁、LaTeX 清理在 ai_text.py。
"""

from typing import Any, Dict, List
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request

# 提示詞與文字整理分在兩個檔案；這裡重新匯出，舊的 ai_client.XXX 用法照樣可用
from src.ai.ai_prompts import JSON_GUARD, MODULE_TASKS, SYSTEM_GUARD
from src.ai.ai_text import _clean, _strip_opener, to_traditional, unverified_numbers

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


MAX_DATA_CHARS = 24000


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
