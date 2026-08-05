// client-entry.tsx
const activate = (): void => {
  console.log('[growi-plugin-calendar] activated!');
  fetchEvents();
};

async function fetchEvents() {
  try {
    const res = await fetch(
      '/_api/v3/pages/list?path=' + encodeURIComponent('/イベント/決定済みイベント保管場所'),
      { credentials: 'include' }
    );
    const listData = await res.json();
    const page = listData.pages?.[0];
    if (page == null) {
      console.warn('[growi-plugin-calendar] page not found');
      return;
    }

    const pageRes = await fetch(`/_api/v3/page?pageId=${page._id}`, { credentials: 'include' });
    const { page: pageDetail } = await pageRes.json();
    const body: string = pageDetail.revision.body;

    const events = parseEvents(body);
    console.log('[growi-plugin-calendar] parsed events:', events);
  } catch (err) {
    console.error('[growi-plugin-calendar] fetchEvents failed:', err);
  }
}

function parseEvents(body: string) {
  const now = new Date();
  let year = now.getFullYear();
  let lastMonth = 0;

  const lines = body.split('\n');
  const events: { date: string; title: string }[] = [];

  for (const line of lines) {
    const match = line.match(/^\s*(\d{1,2})月(\d{1,2})日[\s　]+(.+?)\s*$/);
    if (match == null) continue;

    const month = parseInt(match[1], 10);
    const day = match[2].padStart(2, '0');
    const title = match[3];

    if (month < lastMonth) {
      year += 1;
    }
    lastMonth = month;

    const mm = String(month).padStart(2, '0');
    events.push({ date: `${year}-${mm}-${day}`, title });
  }

  return events;
}

const deactivate = (): void => {
  console.log('[growi-plugin-calendar] deactivated!');
};

if ((window as any).pluginActivators == null) {
  (window as any).pluginActivators = {};
}
(window as any).pluginActivators['growi-plugin-calendar'] = { activate, deactivate };