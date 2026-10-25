// 匯出報告（右上角「匯出報告」）：把各頁目前的結果整理成 JSON 與 Markdown
(() => {
  // 參數：App 內各頁的結果；回傳 { json, markdown }
  function buildExportReport({ health, m1Data, m2Data, m3Data, m4Data, m5Data, m5Source }) {
    const mine = window.TA.loadPortfolio();
    const bt = m3Data?.backtest_result;
    const report = {
      exportedAt: new Date().toISOString(),
      note: '本報告由程式計算產生；AI 內容與規則訊號僅供參考，不構成投資建議。',
      fx: health && {
        usd_twd: health.fx_usd_twd,
        source: health.fx_source,
        warning: health.fx_warning,
      },
      technical: m1Data && {
        snapshot: m1Data.snapshot,
        decision: m1Data.llm_result?.decision_payload,
        engine: m1Data.llm_result?.execution_mode,
        audit: m1Data.llm_result?.anti_hallucination_audit,
        chips: window.TA.lastChips?.symbol === m1Data.snapshot?.symbol ? window.TA.lastChips : null,
      },
      news: m2Data || null,
      backtest: bt && {
        symbol: m3Data.symbol,
        currency: m3Data.currency,
        period: m3Data.period,
        params: m3Data.strategy_params,
        warnings: m3Data.strategy_warnings,
        regime_breakdown: m3Data.regime_breakdown,
        walk_forward: m3Data.walk_forward,
        next_step_ideas: m3Data.next_step_ideas,
        result: { ...bt, trades: undefined, trades_detail: undefined, daily_equity: undefined },
        strategy: m3Data.strategy,
        risk_settings: m3Data.risk_settings,
        trade_count: (bt.trades_detail || bt.trades || []).length,
      },
      portfolio_risk: m4Data && {
        usd_twd_rate: m4Data.usd_twd_rate,
        fx_rates: m4Data.fx_rates,
        fx_source: m4Data.fx_source,
        valuation: m4Data.portfolio_valuation,
        lookthrough_exposure_pct: m4Data.lookthrough_exposure_pct,
        lookthrough_sources: m4Data.lookthrough_sources,
        beta: {
          used: m4Data.portfolio_beta_used,
          source: m4Data.portfolio_beta_source,
          detail: m4Data.beta_detail,
        },
        crash_20pct_stress_test: m4Data.crash_20pct_stress_test,
        historical_replay: m4Data.historical_replay,
        rebalance: m4Data.rebalance_verification,
      },
      journal_coach: m5Data && {
        source: m5Source === 'mine' ? '我的交易紀錄' : '內建範例',
        statistics: m5Data.statistics,
        biases: m5Data.detected_biases,
        rules: m5Data.personalized_3_rules,
      },
      my_holdings: mine.holdings,
      my_journal: mine.journal,
    };
    const json = JSON.stringify(report, null, 2);
    const d = report.technical?.decision;
    const snap = report.technical?.snapshot;
    const pr = report.portfolio_risk;
    const lines = [
      `# 股票分析報告（${new Date().toLocaleString('zh-TW', { hour12: false })}）`,
      '',
      `> ${report.note}`,
      '',
      report.fx
        ? `- 美元匯率：${report.fx.usd_twd}（${report.fx.source}）${report.fx.warning ? `⚠️ ${report.fx.warning}` : ''}`
        : '',
      '',
      '## 技術分析',
      snap
        ? [
            `- 標的：${snap.symbol}　最新價：${snap.latest_close}（${snap.latest_date}，${snap.data_source}）`,
            `- 趨勢評分：${snap.trend_score?.total ?? '--'}/100（${snap.trend_score?.signal_label ?? '--'}）`,
            `- 決策：${d?.action}　${d?.action === 'SELL' ? '賣出／失效／下檔' : '進場／停損／目標'}：${d?.entry_price} / ${d?.stop_loss_price} / ${d?.take_profit_target}`,
            `- 支撐：${(snap.support_levels || []).join('、')}　壓力：${(snap.resistance_levels || []).join('、')}`,
            `- 失效條件：${d?.invalidation_criteria ?? '--'}`,
            report.technical.chips?.notes?.length
              ? `- 籌碼觀察：${report.technical.chips.notes.join('；')}`
              : '',
          ]
            .filter(Boolean)
            .join('\n')
        : '（尚未分析）',
      '',
      '## 策略回測',
      report.backtest
        ? `- ${report.backtest.symbol}（${report.backtest.strategy?.label || '雙均線交叉'}，${report.backtest.period}，本金幣別 ${report.backtest.currency}）：總報酬 ${report.backtest.result.total_return_pct}%、勝率 ${report.backtest.result.win_rate}、最大回落 ${report.backtest.result.max_drawdown}、交易 ${report.backtest.trade_count} 筆`
        : '（尚未回測）',
      '',
      '## 組合風控',
      pr
        ? [
            `- 總市值：NT$ ${Math.round(pr.valuation?.total_value_twd || 0).toLocaleString()}`,
            `- 組合 Beta：${pr.beta.used}（${pr.beta.source}）`,
            `- 大盤 -20% 預估：${pr.crash_20pct_stress_test?.expected_portfolio_drawdown_pct}%`,
            `- 穿透曝險：${Object.entries(pr.lookthrough_exposure_pct || {})
              .sort((a, b) => b[1] - a[1])
              .slice(0, 8)
              .map(([k, v]) => `${k} ${v}%`)
              .join('、')}`,
          ].join('\n')
        : '（尚未計算）',
      '',
      '## 交易檢討',
      report.journal_coach
        ? (report.journal_coach.rules || [])
            .map(
              (r, i) =>
                `${i + 1}. ${r.rule_name || r.name || ''}：${r.condition || ''} → ${r.action || ''}`,
            )
            .join('\n') || '（沒有規則）'
        : '（尚未診斷）',
    ];
    return { json, markdown: lines.filter((x) => x !== null).join('\n') };
  }

  const downloadText = (text, filename, type) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const stamp = () => {
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}`;
  };

  window.TA = Object.assign(window.TA || {}, { buildExportReport, downloadText, stamp });
})();
