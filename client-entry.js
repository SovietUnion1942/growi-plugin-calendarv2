"use strict";
const activate = () => {
    console.log('[growi-plugin-calendar] activated!');
    hookMarkdownRenderer();
};
// ---- イベントデータ取得・パース(変更なし) ----
async function fetchAllEvents() {
    const res = await fetch('/_api/v3/pages/list?path=' + encodeURIComponent('/イベント/決定済みイベント保管場所'), { credentials: 'include' });
    const listData = await res.json();
    const page = listData.pages?.[0];
    if (page == null)
        return [];
    const pageRes = await fetch(`/_api/v3/page?pageId=${page._id}`, { credentials: 'include' });
    const { page: pageDetail } = await pageRes.json();
    return parseEvents(pageDetail.revision.body);
}
function parseEvents(body) {
    const now = new Date();
    let year = now.getFullYear();
    let lastMonth = 0;
    const events = [];
    for (const line of body.split('\n')) {
        const match = line.match(/^\s*(\d{1,2})月(\d{1,2})日[\s　]+(.+?)\s*$/);
        if (match == null)
            continue;
        const month = parseInt(match[1], 10);
        const day = match[2].padStart(2, '0');
        const title = match[3];
        if (month < lastMonth)
            year += 1;
        lastMonth = month;
        events.push({ date: `${year}-${String(month).padStart(2, '0')}-${day}`, title });
    }
    return events;
}
async function fetchEventsForMonth(yearMonth) {
    const all = await fetchAllEvents();
    return all.filter(e => e.date.startsWith(yearMonth));
}
function getCurrentYearMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
function shiftMonth(yearMonth, diff) {
    const [y, m] = yearMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + diff, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
// ---- カレンダー表示コンポーネント(ここが変更点) ----
// 指定した年月の週×曜日グリッドを作る
function getCalendarGrid(yearMonth) {
    const [y, m] = yearMonth.split('-').map(Number);
    const firstDay = new Date(y, m - 1, 1);
    const lastDay = new Date(y, m, 0);
    const startWeekday = firstDay.getDay(); // 0=日曜
    const days = [];
    // 前月の埋め草
    for (let i = 0; i < startWeekday; i++) {
        const d = new Date(y, m - 1, 1 - (startWeekday - i));
        days.push({ date: formatDate(d), day: d.getDate(), inMonth: false });
    }
    // 当月
    for (let d = 1; d <= lastDay.getDate(); d++) {
        const date = new Date(y, m - 1, d);
        days.push({ date: formatDate(date), day: d, inMonth: true });
    }
    // 翌月の埋め草(7の倍数になるまで)
    while (days.length % 7 !== 0) {
        const last = days[days.length - 1];
        const d = new Date(last.date);
        d.setDate(d.getDate() + 1);
        days.push({ date: formatDate(d), day: d.getDate(), inMonth: false });
    }
    // 週ごとに分割
    const weeks = [];
    for (let i = 0; i < days.length; i += 7) {
        weeks.push(days.slice(i, i + 7));
    }
    return weeks;
}
function formatDate(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
function CalendarSummary() {
    const { react } = growiFacade;
    const { useState, useEffect } = react;
    const [yearMonth, setYearMonth] = useState(getCurrentYearMonth());
    const [events, setEvents] = useState([]);
    useEffect(() => {
        fetchEventsForMonth(yearMonth).then(setEvents);
    }, [yearMonth]);
    const [year, month] = yearMonth.split('-');
    const weeks = getCalendarGrid(yearMonth);
    // 日付ごとにイベントをまとめておく
    const eventsByDate = {};
    events.forEach((e) => {
        var _a;
        eventsByDate[_a = e.date] ?? (eventsByDate[_a] = []);
        eventsByDate[e.date].push(e.title);
    });
    const cellStyle = {
        border: '1px solid #ddd',
        verticalAlign: 'top',
        padding: '4px',
        width: '14.28%',
        height: '70px',
    };
    return react.createElement('div', { style: { border: '1px solid #ccc', padding: '1em', borderRadius: '8px' } }, react.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5em', marginBottom: '0.5em' } }, react.createElement('button', { onClick: () => setYearMonth(shiftMonth(yearMonth, -1)) }, '<'), react.createElement('button', { onClick: () => setYearMonth(shiftMonth(yearMonth, +1)) }, '>'), react.createElement('strong', {}, `${year}年${parseInt(month)}月`)), react.createElement('table', { style: { width: '100%', borderCollapse: 'collapse' } }, react.createElement('thead', {}, react.createElement('tr', {}, WEEKDAY_LABELS.map((label) => react.createElement('th', { key: label, style: { padding: '4px', width: '14.28%' } }, label)))), react.createElement('tbody', {}, weeks.map((week, wi) => react.createElement('tr', { key: wi }, week.map(cell => react.createElement('td', { key: cell.date, style: cellStyle }, react.createElement('div', { style: { opacity: cell.inMonth ? 1 : 0.3, fontWeight: 'bold' } }, cell.day), (eventsByDate[cell.date] ?? []).map((title, i) => react.createElement('div', { key: i, style: { fontSize: '0.75em', background: '#e0f0ff', borderRadius: '4px', padding: '2px 4px', marginTop: '2px' } }, title)))))))));
}
// ---- Markdownレンダラーへのフック ----
function hookMarkdownRenderer() {
    if (growiFacade?.markdownRenderer == null) {
        console.warn('[growi-plugin-calendar] growiFacade.markdownRenderer not found');
        return;
    }
    const { optionsGenerators } = growiFacade.markdownRenderer;
    const original = optionsGenerators.customGenerateViewOptions ?? optionsGenerators.generateViewOptions;
    optionsGenerators.customGenerateViewOptions = (...args) => {
        const options = original(...args);
        const OriginalCode = options.components.code;
        options.components.code = (props) => {
            if (props.className != null && props.className.includes('growi-calendar')) {
                return growiFacade.react.createElement(CalendarSummary);
            }
            return OriginalCode ? growiFacade.react.createElement(OriginalCode, props) : props.children;
        };
        return options;
    };
}
const deactivate = () => {
    console.log('[growi-plugin-calendar] deactivated!');
};
if (window.pluginActivators == null) {
    window.pluginActivators = {};
}
window.pluginActivators['growi-plugin-calendar'] = { activate, deactivate };
