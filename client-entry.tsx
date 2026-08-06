declare const growiFacade: any;

const activate = (): void => {
  console.log('[growi-plugin-calendar] activated!');
  hookMarkdownRenderer();
};

// ---- イベントデータ取得・パース ----

async function fetchAllEvents(): Promise<{ date: string; title: string }[]> {
  const res = await fetch(
    '/_api/v3/pages/list?path=' + encodeURIComponent('/イベント/決定済みイベント保管場所'),
    { credentials: 'include' }
  );
  const listData = await res.json();
  const page = listData.pages?.[0];
  if (page == null) return [];

  const pageRes = await fetch(`/_api/v3/page?pageId=${page._id}`, { credentials: 'include' });
  const { page: pageDetail } = await pageRes.json();
  return parseEvents(pageDetail.revision.body);
}

function parseEvents(body: string) {
  const now = new Date();
  let year = now.getFullYear();
  let lastMonth = 0;
  const events: { date: string; title: string }[] = [];
  for (const line of body.split('\n')) {
    const match = line.match(/^\s*(\d{1,2})月(\d{1,2})日[\s　]+(.+?)\s*$/);
    if (match == null) continue;
    const month = parseInt(match[1], 10);
    const day = match[2].padStart(2, '0');
    const title = match[3];
    if (month < lastMonth) year += 1;
    lastMonth = month;
    events.push({ date: `${year}-${String(month).padStart(2, '0')}-${day}`, title });
  }
  return events;
}

async function fetchEventsForMonth(yearMonth: string) {
  const all = await fetchAllEvents();
  return all.filter(e => e.date.startsWith(yearMonth));
}

function getCurrentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(yearMonth: string, diff: number) {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + diff, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---- カレンダーグリッド ----

function getCalendarGrid(yearMonth: string) {
  const [y, m] = yearMonth.split('-').map(Number);
  const firstDay = new Date(y, m - 1, 1);
  const lastDay = new Date(y, m, 0);
  const startWeekday = firstDay.getDay();

  const days: { date: string; day: number; inMonth: boolean }[] = [];

  for (let i = 0; i < startWeekday; i++) {
    const d = new Date(y, m - 1, 1 - (startWeekday - i));
    days.push({ date: formatDate(d), day: d.getDate(), inMonth: false });
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const date = new Date(y, m - 1, d);
    days.push({ date: formatDate(date), day: d, inMonth: true });
  }
  while (days.length % 7 !== 0) {
    const last = days[days.length - 1];
    const d = new Date(last.date);
    d.setDate(d.getDate() + 1);
    days.push({ date: formatDate(d), day: d.getDate(), inMonth: false });
  }

  const weeks: typeof days[] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}

function formatDate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

// ---- 自分のユーザー名取得 ----

let cachedUsername: string | null = null;

async function getCurrentUsername(): Promise<string | null> {
  if (cachedUsername != null) return cachedUsername;
  try {
    const res = await fetch('/_api/v3/personal-setting', { credentials: 'include' });
    const data = await res.json();
    console.log('[growi-plugin-calendar] personal-setting response:', data);
    cachedUsername = data.currentUser?.username ?? null;
    return cachedUsername;
  } catch (err) {
    console.error('[growi-plugin-calendar] getCurrentUsername failed:', err);
    return null;
  }
}

// ---- 出欠データの取得・保存 ----

async function fetchMyAvailability(yearMonth: string, username: string): Promise<Record<string, string>> {
  const path = `/schedule/responses/${yearMonth}/${username}`;
  const res = await fetch('/_api/v3/pages/list?path=' + encodeURIComponent(path), { credentials: 'include' });
  const listData = await res.json();
  const page = listData.pages?.[0];
  if (page == null) return {};

  const pageRes = await fetch(`/_api/v3/page?pageId=${page._id}`, { credentials: 'include' });
  const { page: pageDetail } = await pageRes.json();
  const match = pageDetail.revision.body.match(/<!--\s*availability\s*([\s\S]*?)-->/);
  if (match == null) return {};
  try {
    return JSON.parse(match[1]);
  } catch {
    return {};
  }
}

async function saveMyAvailability(yearMonth: string, username: string, data: Record<string, string>) {
  const path = `/schedule/responses/${yearMonth}/${username}`;
  const body = `\`\`\`growi-availability\n\`\`\`\n<!-- availability\n${JSON.stringify(data)}\n-->\n`;

  const listRes = await fetch('/_api/v3/pages/list?path=' + encodeURIComponent(path), { credentials: 'include' });
  const listData = await listRes.json();
  const existing = listData.pages?.[0];

  if (existing == null) {
  await fetch('/_api/v3/page', {  // pages → page に変更
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ path, body, grant: 1 }),
    });
  } else {
    const pageRes = await fetch(`/_api/v3/page?pageId=${existing._id}`, { credentials: 'include' });
    const { page: pageDetail } = await pageRes.json();
    await fetch('/_api/v3/page', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        pageId: existing._id,
        revisionId: pageDetail.revision._id,
        body,
      }),
    });
  }
}

// ---- 出欠入力コンポーネント ----

function AvailabilityEditor() {
  const { react } = growiFacade;
  const { useState, useEffect } = react;

  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth());
  const [username, setUsername] = useState(null as string | null);
  const [availability, setAvailability] = useState({} as Record<string, string>);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getCurrentUsername().then((name: string | null) => setUsername(name));
  }, []);

  useEffect(() => {
    if (username == null) return;
    fetchMyAvailability(yearMonth, username).then(setAvailability);
  }, [yearMonth, username]);

  const [year, month] = yearMonth.split('-');
  const weeks = getCalendarGrid(yearMonth);

  async function toggle(date: string) {
    if (username == null) return;
    const current = availability[date];
    const nextValue =
      current === undefined ? 'yes' :
      current === 'yes' ? 'maybe' :
      current === 'maybe' ? 'no' :
      undefined;

    const next = { ...availability };
    if (nextValue === undefined) {
      delete next[date];
    } else {
      next[date] = nextValue;
    }

    setAvailability(next);
    setSaving(true);
    await saveMyAvailability(yearMonth, username, next);
    setSaving(false);
  }

  if (username == null) {
    return react.createElement('p', {}, 'ユーザー情報を取得中...');
  }

  const cellStyle = {
  border: '1px solid #ddd',
  verticalAlign: 'top',
  padding: '4px',
  width: '14.28%',
  height: '75px',
  boxSizing: 'border-box',
  cursor: 'pointer',
  overflow: 'hidden',
};

  return react.createElement('div', { style: { border: '1px solid #ccc', padding: '1em', borderRadius: '8px', overflowX: 'auto' } },
    react.createElement('div', { style: { minWidth: '480px' } },
      react.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5em', marginBottom: '0.5em' } },
        react.createElement('button', { onClick: () => setYearMonth(shiftMonth(yearMonth, -1)) }, '<'),
        react.createElement('button', { onClick: () => setYearMonth(shiftMonth(yearMonth, +1)) }, '>'),
        react.createElement('strong', {}, `${year}年${parseInt(month)}月 の出欠(${username})`),
        saving ? react.createElement('span', { style: { fontSize: '0.8em', color: '#888' } }, '保存中...') : null
      ),
      react.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' } },
        react.createElement('thead', {},
          react.createElement('tr', {}, WEEKDAY_LABELS.map((label: string) =>
            react.createElement('th', { key: label, style: { padding: '4px' } }, label)
          ))
        ),
        react.createElement('tbody', {},
          weeks.map((week: { date: string; day: number; inMonth: boolean }[], wi: number) =>
            react.createElement('tr', { key: wi },
              week.map(cell => {
                const state = availability[cell.date];
                const bg =
                  state === 'yes' ? '#c8f7c5' :
                  state === 'maybe' ? '#fff3b0' :
                  state === 'no' ? '#f7c5c5' :
                  'transparent';
                const label =
                  state === 'yes' ? '○' :
                  state === 'maybe' ? '△' :
                  state === 'no' ? '×' :
                  null;

                return react.createElement('td', {
                  key: cell.date,
                  style: { ...cellStyle, background: cell.inMonth ? bg : '#f5f5f5', opacity: cell.inMonth ? 1 : 0.4 },
                  onClick: () => cell.inMonth && toggle(cell.date),
                },
                  react.createElement('div', { style: { fontWeight: 'bold' } }, cell.day),
                  label != null ? react.createElement('div', {}, label) : null
                );
              })
            )
          )
        )
      )
    )
  );
}

// ---- カレンダー表示コンポーネント(イベント一覧) ----

function CalendarSummary() {
  const { react } = growiFacade;
  const { useState, useEffect } = react;

  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth());
  const [events, setEvents] = useState([] as { date: string; title: string }[]);
  const [aggregate, setAggregate] = useState({
    perDate: {} as Record<string, { yes: string[]; maybe: string[]; no: string[] }>,
    totalResponders: 0,
  });
  const [selectedDate, setSelectedDate] = useState(null as string | null);

  useEffect(() => {
    fetchEventsForMonth(yearMonth).then(setEvents);
    fetchAvailabilityAggregate(yearMonth).then(setAggregate);
    setSelectedDate(null);
  }, [yearMonth]);

  const [year, month] = yearMonth.split('-');
  const weeks = getCalendarGrid(yearMonth);

  const eventsByDate: Record<string, string[]> = {};
  events.forEach((e: { date: string; title: string }) => {
    eventsByDate[e.date] ??= [];
    eventsByDate[e.date].push(e.title);
  });

  // 日付ごとのスコアを計算(○:+1, △:+0.5, ×:-1)
  function scoreOf(date: string) {
    const d = aggregate.perDate[date];
    if (d == null) return 0;
    return d.yes.length * 1 + d.maybe.length * 0.5 + d.no.length * -1;
  }

  const scores = Object.keys(aggregate.perDate).map(scoreOf);
  const maxAbsScore = scores.length > 0 ? Math.max(...scores.map(s => Math.abs(s)), 1) : 1;
  const maxScore = scores.length > 0 ? Math.max(...scores) : 0;

  const cellStyle = {
   border: '1px solid #ddd',
   verticalAlign: 'top',
   padding: '4px',
   width: '14.28%',
   minHeight: '75px',
   height: 'auto',
   boxSizing: 'border-box',
   cursor: 'pointer',
  };

  const selectedAgg = selectedDate != null ? aggregate.perDate[selectedDate] : null;

  return react.createElement('div', { style: { border: '1px solid #ccc', padding: '1em', borderRadius: '8px', overflowX: 'auto' } },
    react.createElement('div', { style: { minWidth: '480px' } },
      react.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5em', marginBottom: '0.5em' } },
        react.createElement('button', { onClick: () => setYearMonth(shiftMonth(yearMonth, -1)) }, '<'),
        react.createElement('button', { onClick: () => setYearMonth(shiftMonth(yearMonth, +1)) }, '>'),
        react.createElement('strong', {}, `${year}年${parseInt(month)}月`),
        react.createElement('span', { style: { fontSize: '0.8em', color: '#888' } }, `(回答者数: ${aggregate.totalResponders}人)`)
      ),
      react.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' } },
        react.createElement('thead', {},
          react.createElement('tr', {},
            WEEKDAY_LABELS.map((label: string) =>
              react.createElement('th', { key: label, style: { padding: '4px', width: '14.28%' } }, label)
            )
          )
        ),
        react.createElement('tbody', {},
          weeks.map((week: { date: string; day: number; inMonth: boolean }[], wi: number) =>
            react.createElement('tr', { key: wi },
              week.map(cell => {
                const score = scoreOf(cell.date);
                const hasData = aggregate.perDate[cell.date] != null;
                const bg = hasData ? scoreToColor(score, maxAbsScore) : 'transparent';
                const isMax = cell.inMonth && maxScore > 0 && score === maxScore;
                const isSelected = cell.date === selectedDate;
                const hasEvent = (eventsByDate[cell.date] ?? []).length > 0;

               // 優先度: イベントあり > 選択中 > 最多参加日
                 const outline = hasEvent
                   ? '3px solid #e65100'
                   : isSelected
                     ? '2px solid #1976d2'
                     : isMax
                       ? '2px solid #2e7d32'
                       : 'none';

                return react.createElement('td', {
                  key: cell.date,
                  style: {
                    ...cellStyle,
                    background: cell.inMonth ? bg : '#f5f5f5',
                    opacity: cell.inMonth ? 1 : 0.4,
                    outline,
                    outlineOffset: '-2px',
                  },
                  onClick: () => cell.inMonth && setSelectedDate(cell.date),
                },
                  react.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '2px' } },
  hasEvent ? react.createElement('span', { style: { fontSize: '0.7em' } }, '📌') : null,
  react.createElement('span', { style: { fontWeight: 'bold' } }, cell.day)
),
react.createElement('div', { style: { maxHeight: '52px', overflowY: 'auto' } },
  (eventsByDate[cell.date] ?? []).map((title: string, i: number) =>
    react.createElement('div', {
      key: i,
      style: {
        fontSize: '0.65em',
        background: '#fff3e0',
        color: '#e65100',
        fontWeight: 'bold',
        border: '1px solid #ffcc80',
        borderRadius: '4px',
        padding: '1px 3px',
        marginTop: '2px',
        whiteSpace: 'normal',
        wordBreak: 'break-word',
        overflowWrap: 'break-word',
      },
    }, title)
  )
)
                );
              })
            )
          )
        )
      ),
      // ---- 選択した日の詳細パネル ----
      selectedDate != null ? react.createElement('div', { style: { marginTop: '0.8em', padding: '0.8em', background: '#fafafa', border: '1px solid #ddd', borderRadius: '8px' } },
        react.createElement('strong', {}, `${selectedDate} の出欠状況`),
        selectedAgg == null || (selectedAgg.yes.length === 0 && selectedAgg.maybe.length === 0 && selectedAgg.no.length === 0)
          ? react.createElement('p', { style: { color: '#888', fontSize: '0.9em' } }, 'まだ誰も回答していません')
          : react.createElement('div', { style: { marginTop: '0.5em', fontSize: '0.9em' } },
              selectedAgg.yes.length > 0 ? react.createElement('div', { style: { color: '#2e7d32' } }, `○ 参加可能: ${selectedAgg.yes.join('、')}`) : null,
              selectedAgg.maybe.length > 0 ? react.createElement('div', { style: { color: '#a68b00' } }, `△ 未定: ${selectedAgg.maybe.join('、')}`) : null,
              selectedAgg.no.length > 0 ? react.createElement('div', { style: { color: '#c62828' } }, `× 不可: ${selectedAgg.no.join('、')}`) : null
            )
      ) : react.createElement('p', { style: { marginTop: '0.8em', fontSize: '0.85em', color: '#888' } }, '日付をタップすると、その日の詳しい出欠状況が見られます')
    )
  );
}

async function fetchAvailabilityAggregate(yearMonth: string) {
  const res = await fetch(
    '/_api/v3/pages/list?path=' + encodeURIComponent(`/schedule/responses/${yearMonth}`),
    { credentials: 'include' }
  );
  const listData = await res.json();
  const pages = listData.pages ?? [];

  const perDate: Record<string, { yes: string[]; maybe: string[]; no: string[] }> = {};

  for (const p of pages) {
    const username = p.path.split('/').pop();
    const pageRes = await fetch(`/_api/v3/page?pageId=${p._id}`, { credentials: 'include' });
    const { page: pageDetail } = await pageRes.json();
    const match = pageDetail.revision.body.match(/<!--\s*availability\s*([\s\S]*?)-->/);
    if (match == null) continue;

    let data: Record<string, string> = {};
    try {
      data = JSON.parse(match[1]);
    } catch {
      continue;
    }

    for (const [date, state] of Object.entries(data)) {
      perDate[date] ??= { yes: [], maybe: [], no: [] };
      if (state === 'yes') perDate[date].yes.push(username);
      else if (state === 'maybe') perDate[date].maybe.push(username);
      else if (state === 'no') perDate[date].no.push(username);
    }
  }

  return { perDate, totalResponders: pages.length };
}

// スコアを緑(プラス最大)→黄色(0)→赤(マイナス最大)のグラデーションに変換
function scoreToColor(score: number, maxAbsScore: number): string {
  if (maxAbsScore === 0) return 'transparent';
  const t = Math.max(-1, Math.min(1, score / maxAbsScore)); // -1〜1に正規化
  const hue = 60 + 60 * t; // t=1→120(緑), t=0→60(黄), t=-1→0(赤)
  const lightness = 82 - Math.abs(t) * 14; // 0に近いほど淡く、両端に近いほど少し濃く
  return `hsl(${hue}, 65%, ${lightness}%)`;
}

// ---- Markdownレンダラーへのフック ----

function hookMarkdownRenderer() {
  if (growiFacade?.markdownRenderer == null) {
    console.warn('[growi-plugin-calendar] growiFacade.markdownRenderer not found');
    return;
  }

  const { optionsGenerators } = growiFacade.markdownRenderer;
  const original = optionsGenerators.customGenerateViewOptions ?? optionsGenerators.generateViewOptions;

  optionsGenerators.customGenerateViewOptions = (...args: any[]) => {
    const options = original(...args);
    const OriginalCode = options.components.code;

    options.components.code = (props: any) => {
      if (props.className != null && props.className.includes('growi-calendar')) {
        return growiFacade.react.createElement(CalendarSummary);
      }
      if (props.className != null && props.className.includes('growi-availability')) {
        return growiFacade.react.createElement(AvailabilityEditor);
      }
      return OriginalCode ? growiFacade.react.createElement(OriginalCode, props) : props.children;
    };

    return options;
  };
}

const deactivate = (): void => {
  console.log('[growi-plugin-calendar] deactivated!');
};

if ((window as any).pluginActivators == null) {
  (window as any).pluginActivators = {};
}
(window as any).pluginActivators['growi-plugin-calendar'] = { activate, deactivate };