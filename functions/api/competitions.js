function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function formatDateForParam(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildSearchUrl() {
  const start = new Date();
  const end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    u: 'competitions_all',
    view: '',
    competition_name: '',
    period: 'next30',
    date1: formatDateForParam(start),
    date2: formatDateForParam(end),
    my_country: '',
    registration_open: '',
    registration_date1: '',
    registration_date2: '',
    country_code: 'FI',
    my_club: '',
    club_type: '',
    club_id: '',
    association_id: '0',
    close_to_me: '',
    area: 'Uusimaa',
    city: '',
    course_id: '',
    type: 'C',
    division: '',
    my: '',
    sort_name: '',
    sort_order: '',
    my_all: ''
  });
  return `https://discgolfmetrix.com/?${params.toString()}`;
}

async function fetchText(url) {
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; metrix-uusimaa-search/1.0; +https://pages.dev)',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9,fi;q=0.8',
      'cache-control': 'no-cache'
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(rawHtml) {
  return decodeEntities(
    rawHtml
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' | ')
      .replace(/<[^>]+>/g, ' ')
  )
  .replace(/\r/g, '')
  .replace(/[ \t]+/g, ' ')
  .replace(/ *\n+ */g, '\n')
  .replace(/\|\s*\|/g, '|')
  .trim();
}

function normalizeEventUrl(input) {
  const text = String(input || '').replace(/&amp;/g, '&');
  let m = text.match(/https?:\/\/discgolfmetrix\.com\/(?:\?ID=)?(\d+)/i);
  if (m) return `https://discgolfmetrix.com/${m[1]}`;
  m = text.match(/href=["']([^"']*(?:\?ID=\d+|\/\d+)[^"']*)["']/i);
  if (m) return normalizeEventUrl(m[1]);
  m = text.match(/[?&]ID=(\d+)/i);
  if (m) return `https://discgolfmetrix.com/${m[1]}`;
  m = text.match(/\/(\d{4,})\b/);
  if (m) return `https://discgolfmetrix.com/${m[1]}`;
  return null;
}

function extractEventUrlsFromHtml(html) {
  const urls = [];
  const seen = new Set();
  const re = /href=["']([^"']*(?:\?ID=\d+|\/\d+)[^"']*)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = normalizeEventUrl(m[1]);
    if (url && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

function looksLikeCompetitionName(text) {
  if (!text) return false;
  const bad = /^(Name|Date|Type|Location|Players|Divisions|Comment|Registration|Find competition|Start practice|Create competition|Login|Sign up|Dashboard settings)$/i;
  return !bad.test(text.trim()) && /[A-Za-zÅÄÖåäö0-9]/.test(text);
}

function parseRowsFromText(text, urls) {
  const lines = text.split('\n').map((x) => x.trim()).filter(Boolean);
  const rows = [];
  let pendingRegistration = null;
  let waitingForDueLine = false;
  let urlIndex = 0;

  for (const line of lines) {
    if (/until/i.test(line) && /\d{1,2}\/\d{1,2}\/\d{2}/.test(line)) {
      const dates = line.match(/\d{1,2}\/\d{1,2}\/\d{2}(?:\s+\d{1,2}:\d{2})?/g) || [];
      if (dates.length >= 2) {
        pendingRegistration = dates[dates.length - 1];
        waitingForDueLine = false;
      } else {
        waitingForDueLine = true;
      }
      continue;
    }
    if (waitingForDueLine && /^\d{1,2}\/\d{1,2}\/\d{2}(?:\s+\d{1,2}:\d{2})?$/.test(line)) {
      pendingRegistration = line;
      waitingForDueLine = false;
      continue;
    }

    const parts = line.split('|').map((x) => x.trim()).filter(Boolean);
    if (parts.length < 7) continue;
    if (!looksLikeCompetitionName(parts[0])) continue;
    if (!/\d{1,2}\/\d{1,2}\/\d{2}/.test(parts[1])) continue;
    if (!/\bC\b/i.test(parts[2]) && !/PDGA/i.test(parts[2])) continue;

    const row = {
      title: parts[0],
      date: parts[1],
      type: parts[2],
      place: parts[3],
      registered: Number(parts[4]) || 0,
      classes: parts[5] ? parts[5].split(/\s{2,}|,(?!\d)/).map((x) => x.trim()).filter(Boolean) : [],
      description: parts[6] || '',
      registration_due: pendingRegistration || '',
      source_url: urls[urlIndex] || null
    };
    rows.push(row);
    urlIndex += 1;
    pendingRegistration = null;
  }

  return rows;
}

function parseDetailText(baseUrl, text) {
  const maxRegistrants = Number((text.match(/Maximum number of players:?\s*(\d+)/i) || [])[1] || '') || null;
  const registered = Number((text.match(/The number of registered players:?\s*(\d+)/i) || [])[1] || '') || null;
  const regDue = (text.match(/Registration end:?\s*(\d{1,2}\/\d{1,2}\/\d{2}(?:\s+\d{1,2}:\d{2})?)/i) || [])[1] || '';
  const classMatches = text.match(/(?:Pro Open Women|Pro Open|Mixed Amateur \d|Womens Amateur \d|Mixed Amateur \d\+|Womens Amateur \d\+|Mixed Amateur 40\+|Womens Amateur 40\+|Mixed Amateur 50\+|Womens Amateur 50\+|Junior ≤ \d+|Junior Girls ≤ \d+|Gold(?:\s+[A-Z]{3}\s*<?\d+)?|White(?:\s+[A-Z]{3}\s*<?\d+)?|Red(?:\s+[A-Z]{3}\s*<?\d+)?|Green(?:\s+[A-Z]{3}\s*<?\d+)?|Purple(?:\s+[A-Z]{3}\s*<?\d+)?)/g) || [];
  const classes = Array.from(new Set(classMatches.map((x) => x.trim()).filter(Boolean)));
  return { url: baseUrl, max_registrants: maxRegistrants, registered, registration_due: regDue, classes };
}

export async function onRequestGet() {
  const logs = [];
  try {
    const searchUrl = buildSearchUrl();
    logs.push(`Search URL: ${searchUrl}`);
    const html = await fetchText(searchUrl);
    logs.push(`Fetched search page: ${html.length} chars`);

    const urls = extractEventUrlsFromHtml(html);
    logs.push(`Event links found in HTML: ${urls.length}`);

    const text = stripHtml(html);
    const rows = parseRowsFromText(text, urls);
    logs.push(`Competition rows parsed: ${rows.length}`);

    const events = [];
    for (const row of rows) {
      const event = { ...row, url: row.source_url, max_registrants: null };
      if (row.source_url) {
        try {
          const detailHtml = await fetchText(row.source_url);
          const detailText = stripHtml(detailHtml);
          const detail = parseDetailText(row.source_url, detailText);
          if (detail.max_registrants != null) event.max_registrants = detail.max_registrants;
          if (detail.registered != null) event.registered = detail.registered;
          if (detail.registration_due) event.registration_due = detail.registration_due;
          if (detail.classes.length) event.classes = detail.classes;
          logs.push(`Detail ok: ${row.title}`);
        } catch (err) {
          logs.push(`Detail failed for ${row.title}: ${String(err.message || err)}`);
        }
      }
      events.push(event);
    }

    return json({
      ok: true,
      generated_at: new Date().toISOString(),
      row_count: rows.length,
      checked_count: events.filter((x) => x.source_url).length,
      events,
      logs
    });
  } catch (err) {
    logs.push(`Fatal: ${String(err.message || err)}`);
    return json({ ok: false, error: String(err.message || err), logs }, 500);
  }
}
