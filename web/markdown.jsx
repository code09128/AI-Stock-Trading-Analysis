// AI 回答的格式化顯示：標題、【段落】、粗體、條列、表格、引言、分隔線。
// 只產生 React 元素（文字一律當純文字），不插入原始 HTML，避免模型輸出被當成網頁程式執行。
(() => {
  // 行內：**粗體**、`代碼`、（推算）標記淡化
  function Inline({ text }) {
    const parts = [];
    const re = /\*\*([^*]+)\*\*|`([^`]+)`|（推算）/g;
    let last = 0;
    let m = re.exec(text);
    while (m) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      if (m[1] != null)
        parts.push(
          <b key={m.index} className="text-white font-semibold">
            {m[1]}
          </b>,
        );
      else if (m[2] != null)
        parts.push(
          <code key={m.index} className="px-1 rounded bg-slate-800 text-sky-200">
            {m[2]}
          </code>,
        );
      else
        parts.push(
          <span key={m.index} className="text-[10px] text-slate-500">
            （推算）
          </span>,
        );
      last = re.lastIndex;
      m = re.exec(text);
    }
    if (last < text.length) parts.push(text.slice(last));
    return <>{parts}</>;
  }

  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const cells = (l) =>
    l
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim());

  // 清除模型偶爾輸出的 LaTeX 語法（如 $\ge 0.7$ → ≥ 0.7），但保留 $100 ～ $120、US$100 等金額寫法
  const LATEX_SUBS = [
    [/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1 / $2)'],
    [/\\(?:text|mathrm|mathbf|textbf)\{([^{}]*)\}/g, '$1'],
    [/\\(?:ge|geq|geqslant)\b/g, '≥'],
    [/\\(?:le|leq|leqslant)\b/g, '≤'],
    [/\\(?:ne|neq)\b/g, '≠'],
    [/\\(?:approx|sim)\b/g, '≈'],
    [/\\times\b/g, '×'],
    [/\\cdot\b/g, '·'],
    [/\\div\b/g, '÷'],
    [/\\pm\b/g, '±'],
    [/\\(?:to|rightarrow|longrightarrow|Rightarrow)\b/g, '→'],
    [/\\(?:leftarrow|Leftarrow)\b/g, '←'],
    [/\\uparrow\b/g, '↑'],
    [/\\downarrow\b/g, '↓'],
    [/\\infty\b/g, '∞'],
    [/\\beta\b/g, 'Beta'],
    [/\\alpha\b/g, 'Alpha'],
    [/\\%/g, '%'],
    [/\\(?:left|right|quad|qquad|,|;|!)/g, ''],
  ];

  function cleanMath(raw) {
    let s = String(raw || '');
    for (const [re, rep] of LATEX_SUBS) s = s.replace(re, rep);
    s = s.replace(/\$\$([^$]+)\$\$/g, '$1');
    return s.replace(/(?<![A-Za-z])\$([^$\n]+?)\$(?!\d)/g, '$1');
  }

  function parse(text) {
    const lines = cleanMath(text)
      .replace(/\r/g, '')
      .split('\n');
    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) {
        i += 1;
      } else if (isRow(l) && i + 1 < lines.length && isSep(lines[i + 1])) {
        const head = cells(l);
        const rows = [];
        i += 2;
        while (i < lines.length && isRow(lines[i])) {
          rows.push(cells(lines[i]));
          i += 1;
        }
        blocks.push({ t: 'table', head, rows });
      } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) {
        blocks.push({ t: 'hr' });
        i += 1;
      } else if (/^\s*#{1,6}\s/.test(l)) {
        blocks.push({ t: 'h', text: l.replace(/^\s*#{1,6}\s+/, '').replace(/\*\*/g, '') });
        i += 1;
      } else if (/^\s*【[^】]+】/.test(l)) {
        const m = l.match(/^\s*【([^】]+)】\s*(.*)$/);
        blocks.push({ t: 'section', title: m[1], text: m[2] });
        i += 1;
      } else if (/^\s*>/.test(l)) {
        const q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          q.push(lines[i].replace(/^\s*>\s?/, ''));
          i += 1;
        }
        blocks.push({ t: 'quote', text: q.join(' ') });
      } else if (/^\s*([-*•]|\d+[.、)])\s+/.test(l)) {
        const items = [];
        const ordered = /^\s*\d/.test(l);
        while (i < lines.length && /^\s*([-*•]|\d+[.、)])\s+/.test(lines[i])) {
          const depth = Math.min(2, Math.floor((lines[i].match(/^\s*/)[0].length || 0) / 2));
          items.push({ depth, text: lines[i].replace(/^\s*([-*•]|\d+[.、)])\s+/, '') });
          i += 1;
        }
        blocks.push({ t: 'list', ordered, items });
      } else {
        const p = [];
        while (
          i < lines.length &&
          lines[i].trim() &&
          !/^\s*(#{1,6}\s|【|>|[-*•]\s|\d+[.、)]\s|\||-{3,})/.test(lines[i])
        ) {
          p.push(lines[i].trim());
          i += 1;
        }
        if (!p.length) {
          p.push(lines[i].trim());
          i += 1;
        }
        blocks.push({ t: 'p', text: p.join('\n') });
      }
    }
    return blocks;
  }

  function Markdown({ text }) {
    const blocks = parse(text);
    return (
      <div className="space-y-2 text-xs leading-relaxed text-slate-200">
        {blocks.map((b, k) => {
          const key = `${b.t}-${k}`;
          if (b.t === 'section')
            return (
              <div key={key} className="pt-1">
                <div className="inline-block text-[11px] font-semibold text-sky-200 bg-sky-500/10 border border-sky-500/30 rounded px-2 py-0.5">
                  {b.title}
                </div>
                {b.text && (
                  <div className="mt-1">
                    <Inline text={b.text} />
                  </div>
                )}
              </div>
            );
          if (b.t === 'h')
            return (
              <div key={key} className="text-sm font-semibold text-white pt-1">
                <Inline text={b.text} />
              </div>
            );
          if (b.t === 'hr') return <hr key={key} className="border-slate-800" />;
          if (b.t === 'quote')
            return (
              <div key={key} className="border-l-2 border-amber-500/60 pl-3 text-amber-100/90">
                <Inline text={b.text} />
              </div>
            );
          if (b.t === 'list') {
            const Tag = b.ordered ? 'ol' : 'ul';
            return (
              <Tag
                key={key}
                className={`space-y-1 ${b.ordered ? 'list-decimal' : 'list-disc'} pl-5`}
              >
                {b.items.map((it, n) => (
                  <li key={`${n}-${it.text.slice(0, 12)}`} style={{ marginLeft: it.depth * 12 }}>
                    <Inline text={it.text} />
                  </li>
                ))}
              </Tag>
            );
          }
          if (b.t === 'table')
            return (
              <div key={key} className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-900">
                    <tr>
                      {b.head.map((h, n) => (
                        <th
                          key={`${n}-${h}`}
                          className="text-left font-semibold text-slate-300 px-2 py-1.5 border-b border-slate-800"
                        >
                          <Inline text={h} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, n) => (
                      <tr key={`${n}-${r[0]}`} className="border-t border-slate-800/70 align-top">
                        {r.map((c, m) => (
                          <td key={`${m}-${c.slice(0, 8)}`} className="px-2 py-1.5 text-slate-200">
                            <Inline text={c.replace(/<br\s*\/?>/gi, '\n')} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          return (
            <p key={key} className="whitespace-pre-line">
              <Inline text={b.text} />
            </p>
          );
        })}
      </div>
    );
  }

  window.TA = Object.assign(window.TA || {}, { Markdown });
})();
