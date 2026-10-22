"""
統一的 AI 連線層 (ai_client.py) — 全系統共用，不綁定特定廠商
一個「連線設定 (profile)」長這樣（由前端「設定」頁管理，存在瀏覽器，每次呼叫時帶上）：
  {"type": "gemini" | "openai" | "anthropic" | "openai_compatible" | "rules",
   "base_url": "...", "model": "...", "api_key": "...", "name": "..."}
- gemini / openai / anthropic：雲端服務（可改 base_url 走代理）。
- openai_compatible：本地或自架（Ollama、LM Studio、llama.cpp server、vLLM、各種閘道），只要支援 /v1/chat/completions。
- rules：不用 AI，使用內建規則引擎。
API Key 留空時，會嘗試讀環境變數 GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY。
AI 只能「解讀」程式算好的數字：explain() 會檢查回答中出現的數字是否真的在提供的資料裡，找不到的會列為「未驗證數字」。
"""

from typing import Any, Dict, List
import json
import os
import re
import time
import urllib.error
import urllib.request

DEFAULTS = {
    "gemini": "https://generativelanguage.googleapis.com",
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com",
    "openai_compatible": "http://127.0.0.1:11434/v1",  # Ollama 預設
}
ENV_KEYS = {"gemini": "GEMINI_API_KEY", "openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}

SYSTEM_GUARD = (
    "你是台股／美股的量化分析助理。你只能使用使用者提供的資料中的數字，"
    "不得自行編造或回憶任何價格、指標、日期或統計值；資料沒有的就說「資料中沒有」。"
    "請用繁體中文，條列、精簡、客觀，並在結尾提醒這不是投資建議。"
)


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


def _request(url: str, headers: Dict[str, str], body: Dict[str, Any] | None, timeout: int, secret: str) -> Any:
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
    if t == "gemini":
        body: Dict[str, Any] = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
        }
        if json_mode:
            body["generationConfig"] = {"responseMimeType": "application/json"}
        r = _request(f"{base}/v1beta/models/{model}:generateContent", {"x-goog-api-key": key}, body, timeout, key)
        try:
            return "".join(p.get("text", "") for p in r["candidates"][0]["content"]["parts"])
        except (KeyError, IndexError):
            raise AIError(f"Gemini 回應格式異常：{str(r)[:200]}") from None
    if t == "anthropic":
        r = _request(f"{base}/v1/messages", {"x-api-key": key, "anthropic-version": "2023-06-01"},
                     {"model": model, "max_tokens": 2048, "system": system,
                      "messages": [{"role": "user", "content": user}]}, timeout, key)
        try:
            return "".join(b.get("text", "") for b in r["content"] if b.get("type") == "text")
        except (KeyError, TypeError):
            raise AIError(f"Anthropic 回應格式異常：{str(r)[:200]}") from None
    # openai / openai_compatible
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    body = {"model": model, "stream": False,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    if json_mode:
        body["response_format"] = {"type": "json_object"}  # Ollama / LM Studio 等也支援，能大幅降低 JSON 格式錯誤
    if t == "openai_compatible" and not profile.get("think"):
        # 本地「思考型」模型（如 qwen3.5）預設關閉長篇思考：快數十倍，且不會把 JSON 吃掉
        body["reasoning_effort"] = "none"
    try:
        r = _request(f"{base}/chat/completions", headers, body, timeout, key)
    except AIError as e:
        if t == "openai_compatible" and "HTTP 4" in str(e):
            body.pop("response_format", None)  # 少數伺服器不認這些參數，退回一般模式重試
            body.pop("reasoning_effort", None)
            r = _request(f"{base}/chat/completions", headers, body, timeout, key)
        else:
            raise
    try:
        return r["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError):
        raise AIError(f"回應格式異常：{str(r)[:200]}") from None


def list_models(profile: Dict[str, Any]) -> List[str]:
    t = profile.get("type")
    if t not in DEFAULTS:
        raise AIError("此類型沒有模型清單")
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
    """回答中出現、但不在原始資料裡的數字（>=3 位數或含小數）。找不到不代表錯，但要人工核對。"""
    known = set(_numbers(data_text))
    known_floats = set()
    for k in known:
        try:
            known_floats.add(round(float(k), 2))
        except ValueError:
            continue
    bad = []
    for n in _numbers(answer):
        digits = n.lstrip("-").replace(".", "")
        if len(digits) < 3 and "." not in n:
            continue  # 1、20、5% 這類小整數不檢查
        try:
            f = round(float(n), 2)
        except ValueError:
            continue
        if n in known or f in known_floats or abs(f) in known_floats:
            continue
        bad.append(n)
    return sorted(set(bad))[:12]


MODULE_TASKS = {
    "mod1": "請根據以下技術分析數據，用白話解釋目前趨勢、關鍵支撐壓力、動能狀態，並說明買進／觀望／賣出各自的條件與風險。",
    "mod2": "請根據以下新聞事件與事件前價格資料，解釋市場是否已提前反映（Priced-in）、可能的波動範圍，以及哪些情況會讓判斷失效。",
    "mod3": "請根據以下回測結果解讀策略優缺點（勝率、獲利因子、最大回撤、交易次數是否足夠），指出可能的過度擬合風險與可測試的改進方向。",
    "mod4": "請根據以下投資組合風控資料，指出最大的集中度與隱藏相關性風險、壓力測試的意義，並用白話建議可考慮的調整方向。",
    "mod5": "請根據以下交易紀錄統計與偵測到的行為偏誤，用白話說明最需要改善的習慣，並把建議寫成可以立即執行的規則。",
    "stock": "請根據以下標的基本資料與配息紀錄，用白話整理這檔標的的特性、配息節奏與需要留意的風險。",
}


def explain(profile: Dict[str, Any], module: str, data: Any, question: str = "") -> Dict[str, Any]:
    if not is_enabled(profile):
        raise AIError("尚未設定 AI 連線，請先到「設定」頁新增")
    data_text = json.dumps(data, ensure_ascii=False)[:12000]
    task = MODULE_TASKS.get(module, "請解讀以下資料。")
    user = f"{task}\n{('使用者補充問題：' + question) if question else ''}\n\n【系統計算好的資料（JSON）】\n{data_text}"
    started = time.time()
    answer = complete(profile, SYSTEM_GUARD, user)
    return {
        "answer": answer.strip(),
        "model": f"{profile.get('type')}:{profile.get('model')}",
        "latency_ms": int((time.time() - started) * 1000),
        "unverified_numbers": unverified_numbers(answer, data_text),
    }


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
    raw = complete(profile, SYSTEM_GUARD + "只輸出 JSON，不要任何其他文字。", user, json_mode=True, timeout=timeout)
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
