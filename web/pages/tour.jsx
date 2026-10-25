// 新手導覽（會真的切換頁面、打開對應分頁，並把要看的區塊框起來）＋「功能怎麼串在一起」說明
(() => {
  const { useState, useEffect, useRef } = React;
  const { LS_TOUR, writeLS } = window.TA;

  // go＝切到哪一頁；watch＝看盤頁要開哪個左側／右側分頁；target＝要框起來的區塊（data-tour）
  const TOUR_STEPS = [
    {
      title: '歡迎',
      body: '這是「看盤 + 分析 + 模擬交易」的工具。行情是真實資料；分析由程式計算，AI 只是選配（到「設定」接雲端或本地模型）。接下來會一頁一頁帶你看，每一步都會切到那一頁並把位置框起來，你也可以直接在框內操作。',
      go: 'watch',
    },
    {
      title: '左側導覽列',
      body: '所有功能都在左邊（手機版點左上角 ☰ 打開選單）：行情（看盤）、分析（技術分析／新聞判斷／策略回測）、風控與檢討（組合風控／交易檢討）、系統（自檢／設定／說明）。最下方「« 收合」可縮成只剩圖示，顯示目前用的 AI。',
      go: 'watch',
      target: 'sidebar',
    },
    {
      title: '大盤指數列',
      body: '頂部一直顯示加權指數、S&P 500、那斯達克、道瓊、費半與美元匯率（真實資料，每 30 秒更新），紅漲綠跌。',
      go: 'watch',
      target: 'index-bar',
    },
    {
      title: '自選股：市場與分類',
      body: '先選「台股／美股・海外」，再用「股票／ETF／債券」篩選。上方輸入代號按「新增」即可加入（台股輸入 2330、美股輸入 NVDA）；按 / 快速搜尋、↑↓ 切換標的。',
      go: 'watch',
      watch: { listTab: 'watch' },
      target: 'watch-filters',
    },
    {
      title: '右側：行情',
      body: '最新成交價、當日分時圖（滑鼠移上去看每 5 分鐘）、今日與 52 週區間位置、開高低收、五檔。',
      go: 'watch',
      watch: { rightTab: 'quote' },
      target: 'watch-quote',
    },
    {
      title: '基本資料與配息',
      body: '切到「基本資料與配息」可看公司／ETF 資料、配息頻率、哪幾個月除息、下一次除息日與發放日（已公告或依歷史推測，會標明），ETF 還有前十大成分股。',
      go: 'watch',
      watch: { rightTab: 'info' },
      target: 'watch-subtabs',
    },
    {
      title: '股市熱力圖',
      body: '第 3 個分頁「股市熱力圖」：一格一檔，方塊大小＝成交金額（可切換市值、等權重、我的持股市值），顏色＝今天漲跌（紅漲綠跌）。範圍可選「我的自選＋持股」「台股熱門族群」「美股核心」。單擊選股、雙擊看行情，下方按鈕可一鍵送技術分析或「查今天的新聞」。',
      go: 'watch',
      watch: { rightTab: 'heatmap' },
      target: 'heatmap',
    },
    {
      title: '我的持股（所有頁面共用）',
      body: '在左側「我的持股」輸入代號、股數、成本，或貼券商 CSV。每檔有「分析」（跳到技術分析並對照你的成本）、「賣出」（帶入賣出委託）。這份持股會自動同步到技術分析與組合風控。',
      go: 'watch',
      watch: { listTab: 'hold', rightTab: 'quote' },
      target: 'watch-list',
    },
    {
      title: '模擬下單 → 成交',
      body: '填好委託按「加入暫存匣」，再按該筆的「成交」：買進會加入我的持股（自動算平均成本），賣出會扣持股並寫一筆交易紀錄（含手續費與證交稅），交易檢討會用到。若已產生個人交易規則，要全部勾選才能下單。',
      go: 'watch',
      watch: { rightTab: 'quote' },
      target: 'watch-order',
    },
    {
      title: '總覽・提醒・配息月曆',
      body: '「技術總覽」一張表看所有自選股的 RSI、距 20 日均線、量比與趨勢；「提醒」設價格／漲跌幅／RSI 條件（網頁開著才會檢查）；「配息月曆」看整份清單哪幾個月除息。',
      go: 'watch',
      watch: { listTab: 'overview' },
      target: 'watch-list',
    },
    {
      title: '技術分析',
      body: '輸入代號（下方會即時顯示名稱）按 Enter 或「查詢標的」：真實日 K 計算均線、RSI、MACD、ATR、支撐壓力，並給出買進／觀望／賣出條件。可切日線／週線，標示「規則引擎」或「AI」來源。',
      go: 'mod1',
      target: 'mod1-query',
    },
    {
      title: '技術分析 × 我的持股',
      body: '如果你持有這檔，這裡會顯示持有股數與成本、目前未實現損益，以及「跌到停損價」「漲到目標價」時你的部位會賺賠多少。上方代號可一鍵切換分析你的其他持股；也能跳回看盤頁賣出或加碼。',
      go: 'mod1',
      target: 'mod1-holding',
    },
    {
      title: '回測這檔',
      body: '技術分析裡的「回測這檔」會把同一檔送到策略回測，用真實歷史日 K 模擬策略（預設雙均線，可換 KD、量價突破、法人連買等 9 種或自訂條件，並設停損停利與大盤濾網；訊號隔日開盤成交、扣手續費與稅）。回測的交易是「模擬成交」，不是你的真實交易。',
      go: 'mod1',
      target: 'mod1-backtest',
    },
    {
      title: '新聞判斷',
      body: '按「抓取最新新聞」同時從多個來源（台股：Google News、鉅亨網、Yahoo奇摩、MoneyDJ、證交所重訊與分析專欄）取得真實新聞，附摘要、可用「新聞／公告／分析專欄」篩選。點一則就會用發布當下已知的價格算「事件前漲了多少」（是否已反映）與事件後實際反應。接了 AI 可勾選「改由 AI 判斷」情緒。',
      go: 'mod2',
      target: 'mod2-news',
    },
    {
      title: '組合風控',
      body: '自動帶入「我的持股」，算集中度、ETF 穿透曝險、Beta、大盤跌 20% 估算與「歷史回落重演」（用你的持股回推過去 2 年真實最大回撤）。沒有持股才會用範例，上方會標明。',
      go: 'mod4',
      target: 'mod4-source',
    },
    {
      title: '交易檢討',
      body: '自動分析「我的交易紀錄」（模擬成交或 CSV 匯入）：勝率、賺賠比、賣太早、處置效應、報復性交易，最後產生 3 條規則。規則會同步顯示在技術分析、組合風控，並成為下單前的勾選清單。',
      go: 'mod5',
      target: 'mod5-source',
    },
    {
      title: '設定：接 AI（選配）',
      body: '不接 AI 也能用。要接的話：雲端（Gemini／OpenAI／Claude）填 Key；本地模型這裡會自動掃描你電腦上的 Ollama／LM Studio，按「新增並使用」。AI 只解讀程式算好的資料，輸出會經過檢查，不通過就退回規則引擎。',
      go: 'settings',
      target: 'settings-local',
    },
    {
      title: '各頁底部「AI 解讀」',
      body: '每個分析頁最下面都有「AI 解讀」：把這頁算好的數字交給 AI，用研究報告的口吻整理重點，並依你的持股給建議；「可以這樣問」的按鈕可直接帶入常見問題。回答裡的數字會自動和資料核對，對不上的會標示出來。沒接 AI 時這一區會提示到設定頁連線。',
      go: 'mod1',
      target: 'ai-explain-mod1',
    },
    {
      title: '說明頁',
      body: '說明頁有「功能怎麼串在一起」的流程圖（每個方塊都能點去那一頁或從那一步開始導覽）、K 線怎麼看、基本交易策略與名詞辭典。隨時可以從左側「說明」或看盤頁「新手導覽」重看。',
      go: 'guide',
      target: 'guide-flow',
    },
  ];

  function useTargetRect(selector, active) {
    const [rect, setRect] = useState(null);
    useEffect(() => {
      setRect(null);
      if (!active || !selector) return undefined;
      let tries = 0;
      let scrolls = 0;
      const tick = () => {
        const el = document.querySelector(`[data-tour="${selector}"]`);
        if (el) {
          // 切頁後頁面可能又被捲回頂端（或上方資料載入把它推下去）：目標不在畫面內就再捲一次，最多 4 次
          const pre = el.getBoundingClientRect();
          const outOfView = pre.bottom < 0 || pre.top > window.innerHeight;
          if (scrolls === 0 || (outOfView && scrolls < 4)) {
            el.scrollIntoView({ block: 'center', behavior: scrolls === 0 ? 'smooth' : 'auto' });
            scrolls += 1;
          }
          const r = el.getBoundingClientRect();
          // 目標在畫面外（例如手機版收起來的選單）就不畫框，也不顯示「還在載入」
          const visible = r.width > 0 && r.right > 0 && r.left < window.innerWidth;
          setRect(
            visible
              ? { top: r.top, left: r.left, width: r.width, height: r.height }
              : { offscreen: true },
          );
        } else if (tries > 25) {
          setRect(null);
        }
        tries += 1;
      };
      tick();
      const id = setInterval(tick, 250); // 頁面切換、資料載入、捲動時持續追蹤位置
      return () => clearInterval(id);
    }, [selector, active]);
    return rect;
  }

  function GuideTour({ open, start = 0, onClose, onGo }) {
    const [i, setI] = useState(start);
    const lastGo = useRef(null);
    useEffect(() => {
      if (open) setI(Math.min(start, TOUR_STEPS.length - 1));
    }, [open, start]);
    const step = TOUR_STEPS[i];
    // 每一步：切頁 → 通知看盤頁切換分頁
    useEffect(() => {
      if (!open) return;
      if (step.go && lastGo.current !== `${i}`) {
        onGo(step.go);
        lastGo.current = `${i}`;
      }
      if (step.watch) {
        window.TA._pendingWatch = step.watch;
        // 快速按「下一步」時要取消上一步還沒送出的切換，否則舊步驟會在 150ms 後把分頁切回去
        const t = setTimeout(
          () => window.dispatchEvent(new CustomEvent('watch-action', { detail: step.watch })),
          150,
        );
        return () => clearTimeout(t);
      }
      return undefined;
    }, [open, i]); // eslint-disable-line
    const found = useTargetRect(step?.target, open);
    const rect = found && !found.offscreen ? found : null;
    if (!open) return null;
    const last = i === TOUR_STEPS.length - 1;
    const finish = () => {
      writeLS(LS_TOUR, true);
      onClose();
    };
    const pad = 6;
    const lowerHalf = rect && rect.top + rect.height / 2 > window.innerHeight / 2;
    return (
      <>
        {rect ? (
          <div
            className="fixed z-[60] rounded-xl border-2 border-sky-400 pointer-events-none transition-all duration-200"
            style={{
              top: rect.top - pad,
              left: rect.left - pad,
              width: rect.width + pad * 2,
              height: Math.min(rect.height + pad * 2, window.innerHeight),
              boxShadow: '0 0 0 9999px rgba(2,6,23,0.55)',
            }}
          />
        ) : (
          <div className="fixed inset-0 z-[60] bg-slate-950/55 pointer-events-none" />
        )}
        <div
          className={`fixed z-[61] left-1/2 -translate-x-1/2 w-[min(560px,calc(100vw-32px))] ${
            lowerHalf ? 'top-4' : 'bottom-4'
          }`}
        >
          <div className="bg-slate-900 border border-sky-500/60 rounded-2xl p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>
                導覽 {i + 1} / {TOUR_STEPS.length}
                {step.target && !found && (
                  <span className="ml-2 text-amber-300">（這一區還在載入或目前沒有資料）</span>
                )}
              </span>
              <button type="button" onClick={finish} className="hover:text-white cursor-pointer">
                結束導覽 ✕
              </button>
            </div>
            <h3 className="text-lg font-bold text-white">{step.title}</h3>
            <p className="text-sm text-slate-300 leading-relaxed">{step.body}</p>
            <div className="flex gap-1">
              {TOUR_STEPS.map((s, k) => (
                <button
                  type="button"
                  key={s.title}
                  title={s.title}
                  aria-label={`跳到第 ${k + 1} 步：${s.title}`}
                  onClick={() => setI(k)}
                  className={`h-1.5 flex-1 rounded cursor-pointer ${k <= i ? 'bg-sky-400' : 'bg-slate-700'}`}
                />
              ))}
            </div>
            <div className="flex justify-between">
              <button
                type="button"
                disabled={i === 0}
                onClick={() => setI(i - 1)}
                className="px-4 py-2 rounded-lg bg-slate-800 text-slate-200 text-sm disabled:opacity-30 cursor-pointer"
              >
                ← 上一步
              </button>
              {last ? (
                <button
                  type="button"
                  onClick={finish}
                  className="px-4 py-2 rounded-lg bg-amber-500 text-slate-950 font-bold text-sm cursor-pointer"
                >
                  開始使用 →
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setI(i + 1)}
                  className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-sm cursor-pointer"
                >
                  下一步 →
                </button>
              )}
            </div>
          </div>
        </div>
      </>
    );
  }

  // ---------- 說明頁：功能怎麼串在一起 ----------
  const stepIndex = (target) => TOUR_STEPS.findIndex((s) => s.target === target);
  const FLOWS = [
    {
      title: '① 找標的 → 分析 → 回測',
      nodes: [
        ['watch', '看盤：自選股／ETF 精選', 'watch-filters'],
        ['mod1', '技術分析（送入技術分析）', 'mod1-query'],
        ['mod3', '策略回測（回測這檔）', 'mod1-backtest'],
      ],
      text: '在看盤頁選好標的 → 按「送入技術分析」看支撐壓力與買賣條件 → 按「回測這檔」用歷史資料驗證策略。想知道消息面，再到新聞判斷抓這檔的新聞。',
    },
    {
      title: '② 熱力圖找異動 → 查新聞',
      nodes: [
        ['watch', '看盤：股市熱力圖', 'heatmap'],
        ['mod2', '新聞判斷：自動抓這檔新聞', 'mod2-news'],
      ],
      text: '在熱力圖看到某檔大漲大跌 → 點方塊選它 → 按「查今天的新聞」，會直接切到新聞判斷、帶入代號並自動抓最新新聞與公告，馬上知道為什麼動。也可以按「送技術分析」看位階。',
    },
    {
      title: '③ 持股 技術分析 組合風控',
      nodes: [
        ['watch', '看盤：我的持股', 'watch-list'],
        ['mod1', '技術分析：持股卡', 'mod1-holding'],
        ['mod4', '組合風控：自動帶入', 'mod4-source'],
      ],
      text: '持股只要輸入一次：技術分析會顯示你這檔的成本、停損／目標時的賺賠；組合風控自動用這份持股算集中度、Beta 與歷史最大回撤。持股列的「分析」「賣出」可在各頁之間來回。',
    },
    {
      title: '④ 模擬交易 → 交易檢討 → 規則回到下單',
      nodes: [
        ['watch', '模擬下單「成交」', 'watch-order'],
        ['mod5', '交易檢討：我的交易紀錄', 'mod5-source'],
        ['watch', '下單前勾選我的規則', 'watch-order'],
      ],
      text: '買進成交 → 加入持股；賣出成交 → 寫入交易紀錄（持股列的「賣出」會自動帶入股數，碎股與非整張也能平倉）。交易檢討分析這些紀錄、找出壞習慣並產生 3 條規則，規則會出現在技術分析、組合風控，並成為下單前必須勾選的清單，形成閉環。',
    },
    {
      title: '⑤ AI（選配）貫穿各頁',
      nodes: [
        ['settings', '設定：雲端或本地模型', 'settings-local'],
        ['mod1', '各頁底部「AI 解讀」', 'ai-explain-mod1'],
      ],
      text: '在設定接好一次 AI，技術分析的決策、新聞情緒、交易規則與每頁的 AI 解讀都會使用；不接也能完整使用，畫面會標明是「規則引擎」還是「AI」。',
    },
  ];

  function FlowGuide({ onGo }) {
    return (
      <div
        data-tour="guide-flow"
        className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-white">功能怎麼串在一起（連動說明）</h3>
          <span className="text-[11px] text-slate-500">
            點方塊：去那一頁；點「導覽」：從那一步開始帶你看
          </span>
        </div>
        {FLOWS.map((f) => (
          <div
            key={f.title}
            className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2"
          >
            <div className="text-sm font-semibold text-sky-300">{f.title}</div>
            <div className="flex flex-wrap items-center gap-2">
              {f.nodes.map(([tab, label, target], k) => (
                <span key={label} className="flex items-center gap-2">
                  {k > 0 && <span className="text-slate-500">→</span>}
                  <span className="inline-flex rounded-lg border border-slate-700 overflow-hidden text-xs">
                    <button
                      type="button"
                      onClick={() => onGo(tab)}
                      className="px-3 py-1.5 bg-slate-900 text-slate-100 hover:bg-slate-800 cursor-pointer"
                    >
                      {label}
                    </button>
                    {stepIndex(target) >= 0 && (
                      <button
                        type="button"
                        onClick={() => window.TA.startTour?.(stepIndex(target))}
                        className="px-2 py-1.5 bg-sky-600/30 text-sky-200 hover:bg-sky-600/50 cursor-pointer"
                        title="從這一步開始導覽"
                      >
                        導覽
                      </button>
                    )}
                  </span>
                </span>
              ))}
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">{f.text}</p>
          </div>
        ))}
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { GuideTour, FlowGuide, TOUR_STEPS });
})();
