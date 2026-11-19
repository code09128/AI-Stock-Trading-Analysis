// 看盤頁左側「探索」：台股／美股的熱門升幅、熱門跌幅、成交熱門與主題榜（產業鏈）。ETF 精選仍由 watch.tsx 顯示。
// 資料：/api/rankings（後端只用已有快取或一次批次請求，見 src/market/rankings.py）。
// 榜單裡的價格來自榜單本身，不加進看盤頁每 5 秒的報價輪詢；只有點選的那一檔會跟一般報價一起更新。
import { fmt } from '../ui';
import { Row } from './watch_parts';

const { useState, useEffect } = React;

const REFRESH_MS = 60000;
const KIND_OPTS = [
  ['gain', '熱門升幅'],
  ['lose', '熱門跌幅'],
  ['turn', '成交熱門'],
  ['etf', 'ETF'],
  ['theme', '主題'],
] as const;

type Ranking = { rows: any[]; title?: string; note?: string; source?: string; themes: { id: string; name: string }[]; timestamp?: string; error?: string };

// 開著探索分頁時才抓；切走就停。伺服器有快取，同一份榜單多個分頁一起開也只會對外抓一次
function useRanking(market: string, kind: string, theme: string, enabled: boolean) {
  const [state, setState] = useState<{ data: Ranking | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: false });
  useEffect(() => {
    // 換了市場／榜單／主題：先清掉舊的，避免主題清單還沒回來時畫面留著上一份榜單（還會套錯幣別單位）
    if (kind === 'etf' || (kind === 'theme' && !theme)) {
      setState({ data: null, error: null, loading: kind === 'theme' });
      return undefined;
    }
    if (!enabled) return undefined;
    let stop = false;
    let timer: any = null;
    const load = async (refresh = false) => {
      if (refresh && document.hidden) {
        // 定時更新時視窗在背景：這輪不抓，等下一輪（第一次載入一定要抓，不然切過來會一直空白）
        timer = setTimeout(() => load(true), REFRESH_MS);
        return;
      }
      setState((s) => ({ ...s, loading: true }));
      try {
        const r = await fetch('/api/rankings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ market, kind, theme }),
        });
        const d = await r.json();
        if (stop) return;
        if (!r.ok || d.error) setState({ data: null, error: d.error || `HTTP ${r.status}`, loading: false });
        else setState({ data: d, error: null, loading: false });
      } catch (e: any) {
        if (!stop) setState((s) => ({ ...s, error: `連線失敗：${e?.message || e}`, loading: false }));
      }
      if (!stop) timer = setTimeout(() => load(true), REFRESH_MS);
    };
    setState({ data: null, error: null, loading: true });
    load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [market, kind, theme, enabled]);
  return state;
}

// 主題清單：theme 留空時後端只回清單、不抓報價
function useThemes(market: string, enabled: boolean) {
  const [themes, setThemes] = useState<Record<string, { id: string; name: string }[]>>({});
  useEffect(() => {
    if (!enabled || themes[market]) return;
    fetch('/api/rankings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market, kind: 'theme', theme: '' }),
    })
      .then((r) => r.json())
      .then((d) => d.themes && setThemes((t) => ({ ...t, [market]: d.themes })))
      .catch(() => {});
  }, [market, enabled, themes]);
  return themes[market] || [];
}

function ExploreBar({ market, setMarket, kind, setKind, theme, setTheme, themes, timestamp }: any) {
  return (
    <div className="space-y-2 shrink-0 order-1">
      <div className="flex items-center gap-2">
        {[
          ['TW', '台股'],
          ['US', '美股'],
        ].map(([k, label]) => (
          <button
            type="button"
            key={k}
            aria-pressed={market === k}
            onClick={() => setMarket(k)}
            className={`ta-key px-3.5 py-1.5 rounded-full text-xs cursor-pointer ${market === k ? 'ta-key-on text-white' : 'text-slate-400 hover:text-white'}`}
          >
            {label}
          </button>
        ))}
        {timestamp && <span className="ml-auto text-[11px] text-slate-500">{timestamp} 更新</span>}
      </div>
      <fieldset className="flex flex-wrap items-center gap-2 border-0 p-0 m-0 min-w-0">
        <legend className="sr-only">榜單</legend>
        {KIND_OPTS.filter(([k]) => k !== 'etf' || market === 'TW').map(([k, label]) => (
          <button
            type="button"
            key={k}
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={`ta-key px-3 py-1.5 rounded-full text-xs cursor-pointer ${kind === k ? 'ta-key-on text-white' : 'text-slate-400 hover:text-white'}`}
          >
            {label}
          </button>
        ))}
        {kind === 'theme' && (
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            aria-label="選擇主題（產業鏈）"
            className="ta-key ta-key-on rounded-full text-xs px-3 py-1.5 cursor-pointer text-white max-w-[160px]"
          >
            {!themes.length && <option value="">載入中…</option>}
            {themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
      </fieldset>
    </div>
  );
}

const ratingTone = (label: string) =>
  label.includes('買進') ? 'text-violet-200 border-violet-400/40' : label === '持有' ? 'text-slate-300 border-slate-500/50' : 'text-amber-200 border-amber-400/40';

function ExploreRows({ state, market, kind, selected, onSelect, star }: any) {
  const { data, error, loading } = state;
  if (error) return <div className="text-xs text-rose-300 px-1 py-4">榜單取得失敗：{error}</div>;
  if (!data) return <div className="text-xs text-slate-500 px-1 py-4">{loading ? '載入榜單中…' : '選一個榜單'}</div>;
  return (
    <>
      {data.note && (
        <p className="text-[11px] text-slate-500 leading-relaxed px-0.5" title={data.source || ''}>
          {data.note}
        </p>
      )}
      {data.rows.length === 0 && <div className="text-xs text-slate-500 px-1 py-4">目前沒有資料（可能休市或來源暫時沒有回應）。</div>}
      {data.rows.map((r: any, i: number) => {
        const turnover = r.turnover ? `成交 ${fmt(r.turnover / (market === 'US' ? 1e6 : 1e8), 1)} ${market === 'US' ? '百萬美元' : '億'}` : '';
        return (
          <Row
            key={r.symbol}
            sym={r.symbol}
            rank={i + 1}
            nameOverride={r.name}
            quote={r.price != null ? { price: r.price, change: r.change ?? r.change_pct, change_pct: r.change_pct } : null}
            active={selected === r.symbol}
            onClick={() => onSelect(r.symbol)}
            sub={
              <span className="flex items-center gap-1.5 min-w-0">
                {r.rating && (
                  <span
                    className={`text-[10.5px] px-1.5 rounded border shrink-0 ${ratingTone(r.rating.label)}`}
                    title={`分析師平均評等 ${r.rating.score}（1＝強力買進、5＝強力賣出）`}
                  >
                    {r.rating.label}
                  </span>
                )}
                <span className="truncate">{kind === 'turn' || !r.sub ? turnover : `${r.sub}${turnover ? `・${turnover}` : ''}`}</span>
              </span>
            }
            action={star(r.symbol, r.name)}
          />
        );
      })}
    </>
  );
}

export { ExploreBar, ExploreRows, useRanking, useThemes };
