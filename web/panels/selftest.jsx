(() => {
  // 12 項系統自檢中心
  function SelfTestPanel({ ctx }) {
    const { runVisualTestSuite, testSuiteReport, testSuiteRunning } = ctx;
    return (
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-lg font-bold text-white">核心規則自動檢查</h2>
            <p className="text-xs text-slate-400">
              自動檢查台美股交易規則、指標計算是否正確，以及 AI 數字核對功能是否正常
            </p>
          </div>
          <button
            type="button"
            onClick={runVisualTestSuite}
            disabled={testSuiteRunning}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
          >
            {testSuiteRunning ? '測試執行中...' : '重新執行 12 項系統自檢'}
          </button>
        </div>

        {testSuiteReport && (
          <div className="space-y-3">
            <div className="grid grid-cols-4 gap-3 text-center font-mono">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <div className="text-xs text-slate-400">總測試數</div>
                <div className="text-xl font-bold text-white">{testSuiteReport.total}</div>
              </div>
              <div className="bg-emerald-950/30 p-3 rounded-xl border border-emerald-500/30">
                <div className="text-xs text-emerald-300">通過 (PASS)</div>
                <div className="text-xl font-bold text-emerald-400">{testSuiteReport.passed}</div>
              </div>
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <div className="text-xs text-slate-400">失敗 (FAIL)</div>
                <div className="text-xl font-bold text-emerald-400">{testSuiteReport.failed}</div>
              </div>
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <div className="text-xs text-slate-400">總耗時</div>
                <div className="text-xl font-bold text-sky-400">
                  {testSuiteReport.total_duration_ms} ms
                </div>
              </div>
            </div>

            <div className="space-y-2">
              {(testSuiteReport.results || []).map((tc) => (
                <div
                  key={tc.id}
                  className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white">
                      ✅ [{tc.module}] {tc.name}
                    </span>
                    <span className="font-mono text-slate-400">{tc.duration_ms} ms</span>
                  </div>
                  <div className="text-slate-400">意圖：{tc.intent}</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 font-mono text-[11px] pt-1">
                    <div className="bg-slate-900 p-2 rounded text-slate-300">
                      預期: {tc.expected}
                    </div>
                    <div className="bg-emerald-950/30 p-2 rounded text-emerald-300">
                      實測: {tc.actual}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { SelfTestPanel });
})();
