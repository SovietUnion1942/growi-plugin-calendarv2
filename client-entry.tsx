import React, { useState, useEffect } from 'react';

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

// ---- 年月操作ユーティリティ ----

function getCurrentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(yearMonth: string, diff: number) {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + diff, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---- カレンダー表示コンポーネント ----

function CalendarSummary() {
  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth());
  const [events, setEvents] = useState<{ date: string; title: string }[]>([]);

  useEffect(() => {
    fetchEventsForMonth(yearMonth).then(setEvents);
  }, [yearMonth]);

  const [year, month] = yearMonth.split('-');

  return React.createElement('div', { style: { border: '1px solid #ccc', padding: '1em', borderRadius: '8px' } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5em', marginBottom: '0.5em' } },
      React.createElement('button', { onClick: () => setYearMonth(shiftMonth(yearMonth, -1)) }, '<'),
      React.createElement('button', { onClick: () => setYearMonth(shiftMonth(yearMonth, +1)) }, '>'),
      React.createElement('strong', {}, `${year}年${parseInt(month)}月`)
    ),
    events.length === 0
      ? React.createElement('p', {}, 'この月のイベントはありません')
      : React.createElement('ul', {},
          events.map(e => React.createElement('li', { key: e.date }, `${e.date}: ${e.title}`))
        )
  );
}

// ---- Markdownレンダラーへのフック ----

function hookMarkdownRenderer() {
  if ((window as any).growiFacade?.markdownRenderer == null) {
    console.warn('[growi-plugin-calendar] growiFacade.markdownRenderer not found');
    return;
  }

  const { optionsGenerators } = (window as any).growiFacade.markdownRenderer;
  const original = optionsGenerators.customGenerateViewOptions ?? optionsGenerators.generateViewOptions;

  optionsGenerators.customGenerateViewOptions = (...args: any[]) => {
    const options = original(...args);
    const OriginalCode = options.components.code;

    options.components.code = (props: any) => {
      console.log('[growi-plugin-calendar] code className:', JSON.stringify(props.className));
      if (props.className != null && props.className.includes('growi-calendar')) {
        return React.createElement(CalendarSummary);
      }
      return OriginalCode ? React.createElement(OriginalCode, props) : props.children;
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