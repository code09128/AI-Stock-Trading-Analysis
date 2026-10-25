// 說明頁：基本交易策略（攻略）與風控紀律。教學用途，不是買賣建議。
(() => {
  const STRATEGIES = [
    {
      icon: '',
      name: '趨勢跟隨（順勢）',
      level: '入門',
      idea: '「趨勢是你的朋友」：在上升趨勢中找機會買進，趨勢轉弱就離開，不去猜頭猜底。',
      when: '股價在 MA20、MA60 之上，且 MA20 向上（系統「技術總覽」顯示「多頭」）。',
      entry: '拉回不破 MA20 後再轉強時買進；或收盤站上前一波高點。',
      exit: '收盤跌破 MA20（或 MA60，視你的週期）出場；先設好停損價再進場。',
      risk: '盤整盤會被來回洗（假突破、假跌破）。趨勢策略勝率不高，靠「賺大賠小」取勝。',
      tool: '技術分析、看盤頁「技術總覽」的趨勢欄、策略回測的「雙均線交叉」「均線多頭排列」。',
    },
    {
      icon: '',
      name: '突破買進',
      level: '入門',
      idea: '股價長時間在區間內整理，向上突破壓力代表賣壓被消化，常伴隨新一波行情。',
      when: '股價靠近系統算出的「壓力位」，且量能逐步放大。',
      entry: '收盤站上壓力位且成交量大於近 20 日均量（量比 > 1.5 較有說服力）。',
      exit: '收盤跌回壓力位下方（突破失敗）立即出場；獲利後可用 MA5 或前日低點當移動停利。',
      risk: '盤中假突破很常見，所以重點看「收盤」與「量」；美股財報前後的跳空要特別小心。',
      tool: '技術分析 的壓力位與量能比、新聞判斷 判斷消息是否已反映；策略回測的「量價突破」「跳空缺口」可驗證。',
    },
    {
      icon: '↩️',
      name: '拉回買進（逢低承接）',
      level: '中階',
      idea: '強勢股上漲後回檔，在支撐附近買進，進場成本比追高好、停損點也比較近。',
      when: '大趨勢向上，短線 RSI 回到 40~50 附近，股價接近 MA20 或前一個支撐位。',
      entry: '出現下影線或止跌紅 K 時分批買進，停損設在支撐位下方。',
      exit: '收盤跌破支撐就認錯；反彈到前高附近分批獲利。',
      risk: '「接刀」：把下跌趨勢誤當回檔。確認 MA60 仍向上、且支撐有被測試過再做。',
      tool: '看盤頁分時圖與區間條、技術總覽的「距 MA20」與 RSI；策略回測的「乖離率回歸」「KD 低檔黃金交叉」可驗證。',
    },
    {
      icon: '',
      name: '區間操作（高出低進）',
      level: '中階',
      idea: '股價在明確的支撐與壓力之間來回，接近下緣買、接近上緣賣。',
      when: '均線走平、價格反覆在同一區間內（技術總覽顯示「盤整」，且 52 週位置居中）。',
      entry: '靠近區間下緣出現止跌訊號時買進，停損設在區間下方。',
      exit: '到區間上緣獲利了結；若放量突破或跌破區間，立刻停止區間思維。',
      risk: '區間被突破時損失擴大。務必事先設好「區間失效價」。',
      tool: '技術分析 的支撐／壓力位、今日與 52 週區間條。',
    },
    {
      icon: '',
      name: '停損、停利與部位大小（最重要）',
      level: '必學',
      idea: '長期能不能活下來，取決於「每次最多虧多少」，而不是預測多準。',
      when: '每一筆交易下單前都要先算。',
      entry: '先決定停損價，再用公式反推股數：可承受虧損金額 ÷（進場價 − 停損價）＝ 股數。',
      exit: '單筆風險建議 ≤ 本金的 1~2%；風險報酬比（預期獲利 ÷ 預期虧損）至少 2：1 才值得做。',
      risk: '不設停損、虧損加碼攤平、賺小賠大（處置效應）是散戶最常見的虧損來源。',
      tool: '看盤頁模擬下單暫存匣（試算金額）、交易檢討找出你的壞習慣。',
    },
    {
      icon: '',
      name: '分批進出與定期定額',
      level: '入門',
      idea: '不預測最低點或最高點，把資金拆成多份，降低單次判斷錯誤的衝擊。',
      when: '看好長期（ETF、大型權值股）但不確定短期走勢，或資金是分月投入的。',
      entry: '固定每月（或每週）買固定金額；或把預計資金拆成 3 份，在不同價位分批買。',
      exit: '依年度目標或再平衡規則賣出，不因短期波動頻繁操作。',
      risk: '長期下跌的標的越買越多只是「攤平」。定期定額只適合你本來就願意長期持有的標的。',
      tool: '看盤頁「ETF 精選」看殖利率與規模、組合風控 再平衡與集中度檢查。',
    },
    {
      icon: '',
      name: '資產配置與再平衡',
      level: '中階',
      idea: '不把雞蛋放同一個籃子：分散到不同產業、市場與現金，並定期把比重調回目標。',
      when: '單一標的或產業（例如全是 AI 供應鏈）占比過高時。',
      entry: '設定目標比重（含現金），偏離超過約 5% 就調整；ETF 要用「穿透曝險」看真實集中度。',
      exit: '大盤大跌前不一定要全部賣出，可降低 Beta 或用反向 ETF／微台指避險。',
      risk: '表面分散但底層相同（持有 0050 又買台積電）其實高度集中。',
      tool: '組合風控：穿透式曝險、Beta、歷史回落重演、再平衡表。',
    },
  ];

  const RULES = [
    '先寫下交易理由、進場價、停損價、目標價，再下單。沒有停損價就不要進場。',
    '單筆最大虧損不超過本金 1~2%；連續虧損 2 筆就暫停，隔天減量。',
    '不在情緒激動時下單（大賺後得意、大賠後想翻本）。',
    '消息出來先看股價「事前已漲多少」（Priced-in），不要看到利多就追。',
    '回測好看不等於有效：交易筆數太少（< 30 筆）結果沒有統計意義，且要扣掉手續費與稅。',
    '定期用交易檢討 檢討最近 20 筆交易，把最常犯的錯變成明確規則。',
  ];

  function StrategyGuide() {
    return (
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div>
          <h3 className="font-bold text-white">基本交易策略（攻略）</h3>
          <p className="text-[11px] text-slate-500 mt-1">
            以下是常見、公開的教學框架，用來理解系統各功能怎麼搭配；沒有任何策略保證獲利，也不是投資建議。點開每一張卡片看細節。
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {STRATEGIES.map((s) => (
            <details
              key={s.name}
              className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs"
            >
              <summary className="cursor-pointer flex items-center gap-2 text-sm font-semibold text-sky-300">
                <span>{s.icon}</span>
                <span>{s.name}</span>
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-amber-300">
                  {s.level}
                </span>
              </summary>
              <div className="mt-2 space-y-1.5 text-slate-300 leading-relaxed">
                <p>{s.idea}</p>
                {[
                  ['適用情境', s.when],
                  ['進場', s.entry],
                  ['出場／停損', s.exit],
                  ['主要風險', s.risk],
                  ['對應系統功能', s.tool],
                ].map(([k, v]) => (
                  <p key={k}>
                    <b className="text-white">{k}：</b>
                    {v}
                  </p>
                ))}
              </div>
            </details>
          ))}
        </div>
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="text-sm font-bold text-amber-300 mb-2">✅ 每次交易的紀律清單</div>
          <ol className="list-decimal pl-5 space-y-1 text-xs text-slate-300 leading-relaxed">
            {RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ol>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-300 leading-relaxed">
          <div className="text-sm font-bold text-white mb-1">停損與股數怎麼算（範例）</div>
          本金 100 萬、單筆最多承受 1%＝1 萬元虧損。想在 100 元買進、停損 95 元，每股風險 5 元，
          最多買 10,000 ÷ 5 ＝ 2,000 股（2 張）。目標價 110 元則預期獲利 10 元，風險報酬比 ＝ 10 ÷ 5
          ＝ 2：1。 （範例數字僅示範算法。）
        </div>
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { StrategyGuide });
})();
