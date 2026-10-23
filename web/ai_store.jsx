// 全系統共用的 AI 設定與「AI 解讀」元件。設定存在瀏覽器 localStorage，每次呼叫時帶給本機伺服器，伺服器不保存金鑰。
(() => {
  const { useState, useEffect } = React;
  const { readLS, writeLS } = window.TA;

  const LS_AI = 'tw_us_ai_v1';
  const SCOPE_LABELS = {
    mod1: '技術分析（買賣決策由 AI 產出，仍需通過防幻覺稽核）',
    mod2: '新聞判斷（AI 解讀）',
    mod3: '策略回測（AI 解讀）',
    mod4: '組合風控（AI 解讀）',
    mod5: '交易檢討（AI 解讀）',
    stock: '個股／ETF 資訊（AI 解讀）',
  };
  const EMPTY = {
    profiles: [],
    activeId: null,
    scope: Object.fromEntries(Object.keys(SCOPE_LABELS).map((k) => [k, true])),
  };

  const loadAI = () => {
    const v = readLS(LS_AI, EMPTY);
    return { ...EMPTY, ...v, scope: { ...EMPTY.scope, ...(v.scope || {}) } };
  };
  const saveAI = (v) => {
    writeLS(LS_AI, v);
    window.dispatchEvent(new Event('ai-settings-changed'));
  };
  const activeProfile = (cfg = loadAI()) => cfg.profiles.find((p) => p.id === cfg.activeId) || null;
  const cleanProfile = (p) =>
    p && { type: p.type, base_url: p.base_url, model: p.model, api_key: p.api_key, name: p.name };

  // 任何元件都可以訂閱 AI 設定變動
  const useAISettings = () => {
    const [cfg, setCfg] = useState(loadAI);
    useEffect(() => {
      const on = () => setCfg(loadAI());
      window.addEventListener('ai-settings-changed', on);
      return () => window.removeEventListener('ai-settings-changed', on);
    }, []);
    return cfg;
  };

  // ---------- AI 用量與費用（只存在這個瀏覽器）----------
  // 後端把每次請求呼叫 AI 的 tokens 附在回應的 ai_usage；這裡攔截所有 /api/ 回應記下來，
  // 費用＝輸入 tokens × 輸入單價 ＋ 輸出 tokens × 輸出單價（單價：美元／每百萬 tokens，在「設定」填）。
  const LS_USAGE = 'tw_us_ai_usage_v1';
  const LS_PRICES = 'tw_us_ai_prices_v1';
  const USAGE_MAX = 2000;
  const ENDPOINT_LABELS = {
    '/api/mod1/analyze': '技術分析 AI 決策',
    '/api/mod2/news': '新聞 AI 情緒判斷',
    '/api/mod5/coach': '交易檢討 AI 規則',
    '/api/ai/explain': 'AI 解讀',
    '/api/ai/explain_stream': 'AI 解讀',
    '/api/ai/test': '測試連線',
  };
  const loadUsage = () => readLS(LS_USAGE, []);
  const loadPrices = () => readLS(LS_PRICES, {});
  const savePrices = (p) => {
    writeLS(LS_PRICES, p);
    window.dispatchEvent(new Event('ai-usage-changed'));
  };
  const clearUsage = () => {
    writeLS(LS_USAGE, []);
    window.dispatchEvent(new Event('ai-usage-changed'));
  };
  const recordUsage = (items, extra = {}) => {
    if (!items?.length) return;
    const next = [
      ...loadUsage(),
      ...items.map((u) => ({ ...u, label: ENDPOINT_LABELS[u.endpoint] || u.endpoint, ...extra })),
    ].slice(-USAGE_MAX);
    writeLS(LS_USAGE, next);
    window.dispatchEvent(new Event('ai-usage-changed'));
  };
  // 單筆估算費用（美元）；本地模型沒填單價視為 0；雲端模型沒填單價或沒回報 tokens 時回 null
  const usageCost = (u, prices = loadPrices()) => {
    if (typeof u.cost_usd === 'number') return u.cost_usd; // OpenRouter 回報的實際花費
    const p = prices[u.model];
    if (!p && u.local) return 0;
    if (!p || u.input_tokens == null || u.output_tokens == null) return null;
    return (
      ((u.input_tokens || 0) * (Number(p.in) || 0) +
        (u.output_tokens || 0) * (Number(p.out) || 0)) /
      1e6
    );
  };
  const useAIUsage = () => {
    const [st, setSt] = useState(() => ({ usage: loadUsage(), prices: loadPrices() }));
    useEffect(() => {
      const on = () => setSt({ usage: loadUsage(), prices: loadPrices() });
      window.addEventListener('ai-usage-changed', on);
      window.addEventListener('storage', on);
      return () => {
        window.removeEventListener('ai-usage-changed', on);
        window.removeEventListener('storage', on);
      };
    }, []);
    return st;
  };
  // 全站攔截一次：任何 /api/ 回應帶 ai_usage 就記錄（用 clone，不影響原本讀取回應）
  if (!window.__aiUsageHooked) {
    window.__aiUsageHooked = true;
    const origFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const res = await origFetch(input, init);
      const url = typeof input === 'string' ? input : input?.url || '';
      if (
        (url.startsWith('/api/') || url.includes('/api/')) &&
        !url.includes('/api/ai/explain_stream')
      ) {
        res
          .clone()
          .json()
          .then((d) => d && Array.isArray(d.ai_usage) && recordUsage(d.ai_usage))
          .catch(() => {});
      }
      return res;
    };
  }

  async function callAI(action, body) {
    const res = await fetch(`/api/ai/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  // AI 解讀任務放在全站共用的 store：換頁時元件會卸載，但請求會繼續跑、結果保留，回到該頁就看得到。
  // key＝模組（基本資料另外加上代號）；完成時如果那一頁沒開著，就用全站提示通知。
  const MODULE_NAMES = {
    mod1: '技術分析',
    mod2: '新聞判斷',
    mod3: '策略回測',
    mod4: '組合風控',
    mod5: '交易檢討',
    stock: '基本資料',
  };
  const aiTasks = {}; // key -> { busy, status, out, question, doneAt }
  const mounted = {}; // key -> 目前顯示中的元件數
  const emitTasks = () => window.dispatchEvent(new Event('ai-tasks-changed'));
  const getTask = (key) => aiTasks[key] || { busy: false, status: '', out: null, question: '' };
  const setTask = (key, patch) => {
    aiTasks[key] = { ...getTask(key), ...patch };
    emitTasks();
  };
  const startExplain = async (key, label, body) => {
    if (getTask(key).busy) return;
    setTask(key, { busy: true, status: '正在連線 AI 服務…', out: null });
    let out = null;
    let partial = '';
    try {
      const res = await fetch('/api/ai/explain_stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const raw of lines) {
          const line = raw.trim();
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === 'status') {
            setTask(key, { status: ev.status });
          } else if (ev.type === 'delta' && ev.text) {
            partial += ev.text;
            setTask(key, {
              status: '正在串流產生回答…',
              out: { answer: partial, streaming: true },
            });
          } else if (ev.type === 'done') {
            if (Array.isArray(ev.ai_usage)) recordUsage(ev.ai_usage);
            out = ev;
          } else if (ev.type === 'error') {
            if (Array.isArray(ev.ai_usage)) recordUsage(ev.ai_usage);
            out = { error: ev.error };
          }
        }
      }
      if (!out) {
        out = partial ? { answer: partial } : { error: 'AI 串流中斷，未收到完整回應' };
      }
    } catch (e) {
      out = { error: e.message };
    }
    setTask(key, {
      busy: false,
      status: '',
      out,
      doneAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }),
    });
    if (!mounted[key]) {
      window.TA.toast?.(
        out?.error
          ? `⚠️ ${label} 的 AI 解讀失敗：${out.error}`
          : `${label} 的 AI 解讀完成，回到該頁查看`,
      );
    }
  };
  const useAiTask = (key) => {
    const [task, setLocal] = useState(() => getTask(key));
    useEffect(() => {
      mounted[key] = (mounted[key] || 0) + 1;
      const on = () => setLocal(getTask(key));
      on();
      window.addEventListener('ai-tasks-changed', on);
      return () => {
        mounted[key] -= 1;
        window.removeEventListener('ai-tasks-changed', on);
      };
    }, [key]);
    return task;
  };

  // 每個分頁底部的「AI 解讀」區塊：把系統算好的資料交給 AI 用白話解釋，並檢查 AI 回答中的數字是否真的來自資料
  // 這一頁分析的標的與現價（找出使用者是否持有、算出部位損益）
  const pageSymbol = (module, d) =>
    module === 'mod1'
      ? d?.snapshot?.symbol
      : module === 'stock' || module === 'mod2'
        ? d?.symbol
        : null;
  const pagePrice = (module, d) =>
    module === 'mod1'
      ? d?.snapshot?.latest_close
      : module === 'stock'
        ? d?.price
        : module === 'mod2'
          ? d?.volatility_bounds?.current_price
          : null;

  function myPosition(module, d, holdings) {
    const sym = pageSymbol(module, d);
    if (!sym) return null;
    const { baseCode, normSym } = window.TA;
    const h = (holdings || []).find((x) => baseCode(normSym(x.symbol)) === baseCode(normSym(sym)));
    if (!h) return null;
    const px = pagePrice(module, d);
    const pnl = px != null && h.cost ? Math.round((px / h.cost - 1) * 10000) / 100 : null;
    return {
      代號: h.symbol,
      股數: h.shares,
      平均成本: h.cost,
      目前損益率: pnl,
      建立日期: h.opened || null,
    };
  }

  // 依頁面資料與持股，產生「可以這樣問」的建議問題
  function suggestQuestions(module, d, pos) {
    const f = (v) => (v == null ? '' : String(v));
    if (module === 'mod1') {
      const lv = d?.scenarios?.levels || {};
      return [
        pos
          ? `我持有 ${f(pos.股數)} 股、成本 ${f(pos.平均成本)}，現在該續抱、加碼還是減碼？停損設哪裡？`
          : '我還沒持有，現在適合進場嗎？請給進場區、停損和目標價。',
        lv.S1 && `如果收盤跌破 ${lv.S1}，我該怎麼處理？`,
        lv.R1 && `要突破 ${lv.R1} 需要什麼條件才算有效？`,
        '日線和週線方向不一致時，該以哪個為準？',
        '目前法人籌碼和融資變化，對股價是加分還是扣分？',
      ].filter(Boolean);
    }
    if (module === 'stock') {
      const etf = /ETF|債/.test(d?.label || '');
      return [
        pos &&
          `我持有成本 ${f(pos.平均成本)}（目前 ${f(pos.目前損益率)}%），以現在的評價還值得續抱嗎？`,
        etf
          ? '這檔適合放在投資組合的什麼角色？配息穩定嗎？'
          : '以目前估值，適合長期存股還是波段操作？',
        etf
          ? '和同類型 ETF 相比，費用率與成分股集中度如何？'
          : '下次財報前，市場最在意的是哪個數字？',
        '最大的下檔風險是什麼？什麼情況下應該賣出？',
      ].filter(Boolean);
    }
    if (module === 'mod2')
      return [
        '這則消息明天開盤該追價、等回測，還是先不碰？',
        pos
          ? `我已經持有（成本 ${f(pos.平均成本)}），這則消息要減碼還是續抱？`
          : '如果要因這則消息進場，停損該設哪裡？',
        '市場已經提前反映多少了？還有沒有預期差？',
        '這則消息的影響偏短線還是會影響長期獲利？',
      ];
    if (module === 'mod3')
      return [
        '這個策略能實際拿來用嗎？最大的風險是什麼？',
        '參數要怎麼調整才不會過度擬合？',
        '空頭或盤整時要不要停用這個策略？',
        '如果只用這個策略，部位大小該怎麼控制？',
      ];
    if (module === 'mod4')
      return [
        '我的組合最該先調整哪一個部位？請排優先順序。',
        '哪幾檔 ETF 重複押注？可以怎麼精簡？',
        '如果再遇到 2022 年那樣的升息，我該怎麼降低損失？',
        '要不要加入債券或現金？比例多少比較合理？',
      ];
    if (module === 'mod5')
      return [
        '我最需要先改掉哪一個習慣？',
        '幫我把三條紀律寫成下單前的檢查清單。',
        '以我的勝率和賺賠比，停損該設幾 % 比較合理？',
        '下個月要怎麼追蹤自己有沒有進步？',
      ];
    return [];
  }

  function AiExplain({ module, data, title = 'AI 解讀', provenance = [] }) {
    const cfg = useAISettings();
    const { holdings } = window.TA.usePortfolio();
    const [pid, setPid] = useState('');
    const code = module === 'stock' ? data?.code || data?.symbol || '' : '';
    const key = code ? `${module}:${code}` : module;
    const task = useAiTask(key);
    const { busy, out, question } = task;
    const setQuestion = (q) => setTask(key, { question: q });
    if (cfg.scope[module] === false) return null;
    const profile = cfg.profiles.find((p) => p.id === (pid || cfg.activeId)) || null;
    const label = `${MODULE_NAMES[module] || module}${code ? ` ${code}` : ''}`;
    const pos = myPosition(module, data, holdings);
    const suggestions = suggestQuestions(module, data, pos);
    const run = () =>
      startExplain(key, label, {
        module,
        data: {
          ...data,
          ...(provenance.length ? { 資料來源說明: provenance.map((x) => x.text) } : {}),
          // 使用者在這檔的實際部位：讓建議針對「已持有」的情況（續抱／加減碼／停損），而不是泛泛而談
          ...(pos ? { 我的持股部位: pos } : {}),
        },
        question,
        profile: cleanProfile(profile),
      });
    return (
      <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-bold text-violet-200">{title}</div>
          <div className="flex items-center gap-2 text-xs">
            {cfg.profiles.length > 0 && (
              <select
                value={pid || cfg.activeId || ''}
                onChange={(e) => setPid(e.target.value)}
                aria-label="選擇 AI 連線"
                className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-slate-200"
              >
                {cfg.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}（{p.model || '未選模型'}）
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => window.TA.goTab?.('settings')}
              className="text-slate-400 hover:text-white cursor-pointer"
            >
              設定
            </button>
          </div>
        </div>
        {!profile ? (
          <div className="text-xs text-slate-400">
            尚未設定 AI 連線。系統不用 AI 也能運作；若想要白話解讀，請到
            <button
              type="button"
              onClick={() => window.TA.goTab?.('settings')}
              className="mx-1 text-violet-300 underline cursor-pointer"
            >
              設定
            </button>
            新增雲端 AI（Gemini／OpenAI／Claude）或本地模型（Ollama、LM Studio）。
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !busy && run()}
                placeholder={`（選填）想問 AI 的問題，例如：${suggestions[0] || '現在適合分批買進嗎？'}`}
                aria-label="給 AI 的問題"
                className="flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
              />
              <button
                type="button"
                onClick={run}
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {busy ? '思考中…' : 'AI 解讀目前結果'}
              </button>
            </div>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-400">
                  可以這樣問
                  <window.TA.Tip text="依這一頁的分析結果與你的持股產生的問題。點一下會填進上方輸入框，可以再修改後按「AI 解讀」。不填問題就是請 AI 完整解讀整頁。" />
                  ：
                </span>
                {suggestions.map((s) => (
                  <button
                    type="button"
                    key={s}
                    onClick={() => setQuestion(s)}
                    className={`text-[11px] px-2 py-1 rounded-full border cursor-pointer text-left ${
                      question === s
                        ? 'border-violet-400 bg-violet-500/20 text-violet-100'
                        : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-violet-400 hover:text-white'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {pos && (
              <div className="text-[11px] text-emerald-300">
                ✅ 你持有這檔（{pos.股數} 股、成本 {pos.平均成本}
                {pos.目前損益率 != null
                  ? `、目前 ${pos.目前損益率 > 0 ? '+' : ''}${pos.目前損益率}%`
                  : ''}
                ），AI 會針對你的部位給建議。
              </div>
            )}
            {busy && (
              <div className="text-[11px] text-violet-300">
                {task.status || 'AI 正在處理中…'}{' '}
                <span className="text-slate-400">
                  （可先切到其他頁面，背景會繼續產生，完成後會通知你）
                </span>
              </div>
            )}
            <div className="text-[11px] text-slate-500">
              只會把這一頁已計算好的資料送給「{profile.name}」；AI 只負責解釋，不負責算數字。
            </div>
          </>
        )}
        {provenance.length > 0 && (
          <ul className="text-[11px] space-y-0.5">
            {provenance.map((x) => (
              <li key={x.text} className={x.sample ? 'text-amber-300' : 'text-emerald-300'}>
                {x.sample ? '⚠️' : '✅'} {x.text}
              </li>
            ))}
          </ul>
        )}
        {out?.error && <div className="text-xs text-rose-300">⚠️ {out.error}</div>}
        {out?.answer && (
          <div className="space-y-2">
            <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3">
              <window.TA.Markdown
                text={out.streaming ? `${out.answer} ▍` : out.answer}
              />
            </div>
            {!out.streaming && out.context_note && (
              <div className="text-[11px] text-rose-300 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1">
                ⚠️ {out.context_note}
              </div>
            )}
            {!out.streaming && out.unverified_numbers?.length > 0 && (
              <div className="text-[11px] text-amber-300">
                ⚠️ 這些數字在系統提供的資料裡找不到，可能是 AI
                自行推算或編造（標「推算」的距離、賺賠比屬正常），請自行核對：
                {out.unverified_numbers.join('、')}
              </div>
            )}
            {!out.streaming && (
              <div className="text-[10px] text-slate-500">
                {out.model}・{out.latency_ms} ms・{task.doneAt ? `${task.doneAt} 完成・` : ''}
                {(out.ai_usage || []).map((u) => {
                  if (!u.reported) return '供應商未回報用量・';
                  const c = usageCost(u);
                  const fee =
                    u.local && !c
                      ? '本地模型（免費）'
                      : c == null
                        ? '未設定單價'
                        : `約 US$${c.toFixed(4)}`;
                  return `${u.input_tokens ?? '?'} 入／${u.output_tokens ?? '?'} 出 tokens・${fee}・`;
                })}
                AI 內容僅供參考，不構成投資建議
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, {
    loadAI,
    saveAI,
    activeProfile,
    cleanProfile,
    useAISettings,
    callAI,
    useAIUsage,
    usageCost,
    loadPrices,
    savePrices,
    clearUsage,
    LS_USAGE,
    LS_PRICES,
    AiExplain,
    SCOPE_LABELS,
  });
})();
