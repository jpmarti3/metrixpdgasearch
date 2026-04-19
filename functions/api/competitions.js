const HELSINKI = { lat: 60.1699, lon: 24.9384 };
const NOW = new Date();
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const SEARCH_QUERIES = [
  'site:discgolfmetrix.com "C - PDGA" "Uusimaa"',
  'site:discgolfmetrix.com "C - PDGA" "Helsinki"',
  'site:discgolfmetrix.com "C - PDGA" "Espoo"',
  'site:discgolfmetrix.com "C - PDGA" "Vantaa"',
  'site:discgolfmetrix.com "C - PDGA" "Sipoo"',
  'site:discgolfmetrix.com "C - PDGA" "Järvenpää"',
  'site:discgolfmetrix.com "C - PDGA" "Kerava"',
  'site:discgolfmetrix.com "C - PDGA" "Tuusula"',
  'site:discgolfmetrix.com "C - PDGA" "Nurmijärvi"',
  'site:discgolfmetrix.com "C - PDGA" "Porvoo"',
  'site:discgolfmetrix.com "C - PDGA" "Kirkkonummi"',
  'site:discgolfmetrix.com "PDGA C-tier" "discgolfmetrix.com/"',
  'site:discgolfmetrix.com "PDGA" "Uusimaa" "discgolfmetrix.com/"'
];

const FALLBACK_COORDS = new Map([
  ['helsinki', [60.1699, 24.9384]],
  ['espoo', [60.2055, 24.6559]],
  ['vantaa', [60.2941, 25.04099]],
  ['sipoo', [60.3775, 25.2691]],
  ['kerava', [60.4034, 25.105]],
  ['jarvenpaa', [60.4737, 25.0899]],
  ['järvenpää', [60.4737, 25.0899]],
  ['tuusula', [60.4037, 25.0264]],
  ['porvoo', [60.3923, 25.6651]],
  ['kirkkonummi', [60.1237, 24.4385]],
  ['nurmijarvi', [60.4647, 24.8073]],
  ['nurmijärvi', [60.4647, 24.8073]],
  ['vihti', [60.41699, 24.31965]],
  ['hyvinkaa', [60.6333, 24.8667]],
  ['hyvinkää', [60.6333, 24.8667]],
  ['lohja', [60.2486, 24.0653]],
  ['riihimaki', [60.7377, 24.7773]],
  ['riihimäki', [60.7377, 24.7773]],
  ['mantsala', [60.6333, 25.3167]],
  ['mäntsälä', [60.6333, 25.3167]],
  ['raasepori', [59.9731, 23.4339]],
  ['eura', [61.1333, 22.1333]]
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

async function fetchText(url, opts = {}) {
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'accept-language': 'en-US,en;q=0.9',
      ...(opts.headers || {})
    }
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return await res.text();
}

function stripHtml(rawHtml) {
  return rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBingRss(xml) {
  const items = [];
  const regex = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<description>([\s\S]*?)<\/description>[\s\S]*?<\/item>/gi;
  let m;
  while ((m = regex.exec(xml)) !== null) {
    items.push({ title: m[1], link: m[2], description: m[3] });
  }
  return items;
}

function normalizeMetrixUrl(url) {
  const clean = String(url).replace(/&amp;/g, '&');
  let m = clean.match(/discgolfmetrix\.com\/(?:\?ID=)?(\d+)/i);
  if (m) return `https://discgolfmetrix.com/${m[1]}`;
  m = clean.match(/[?&]ID=(\d+)/i);
  if (m) return `https://discgolfmetrix.com/${m[1]}`;
  return null;
}

function extractEventUrlsFromText(text) {
  const urls = new Set();
  const patterns = [
    /discgolfmetrix\.com\/(?:\?ID=)?(\d+)/gi,
    /[?&]ID=(\d+)/gi
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      urls.add(`https://discgolfmetrix.com/${m[1]}`);
    }
  }
  return urls;
}

function parseDate(value) {
  const m = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}) (\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const year = 2000 + Number(m[3]);
  const dt = new Date(Date.UTC(year, Number(m[1]) - 1, Number(m[2]), Number(m[4]), Number(m[5])));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (deg) => deg * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

async function discoverCandidates(logs) {
  const urls = new Set();
  for (const query of SEARCH_QUERIES) {
    logs.push(`Searching: ${query}`);
    try {
      const xml = await fetchText(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`);
      const items = parseBingRss(xml);
      const before = urls.size;
      for (const item of items) {
        const direct = normalizeMetrixUrl(item.link);
        if (direct) urls.add(direct);
        for (const url of extractEventUrlsFromText(`${item.title} ${item.description}`)) {
          urls.add(url);
        }
      }
      logs.push(`  -> ${urls.size - before} new Metrix links`);
    } catch (err) {
      logs.push(`Search failed: ${String(err.message || err)}`);
    }
  }
  return Array.from(urls).sort();
}

function maybeTitle(text) {
  const patterns = [
    /Main Find competition Register here Unfollow (.*?) (\d{1,2}\/\d{1,2}\/\d{2} \d{1,2}:\d{2})\|/i,
    /Register here Unfollow (.*?) (\d{1,2}\/\d{1,2}\/\d{2} \d{1,2}:\d{2})\|/i,
    /(.*?) (\d{1,2}\/\d{1,2}\/\d{2} \d{1,2}:\d{2})\|/i
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && !/metrix/i.test(m[1])) return m[1].trim();
  }
  return 'Unknown title';
}

function parseEventFromText(url, text) {
  let m = text.match(/(\d{1,2}\/\d{1,2}\/\d{2} \d{1,2}:\d{2})\|([^|]+)\|([^\n]+?) PDGA:/i);
  if (!m) m = text.match(/(\d{1,2}\/\d{1,2}\/\d{2} \d{1,2}:\d{2})\|([^|]+)\|([^\n]+?) Comment:/i);
  if (!m) {
    throw new Error('Could not parse date/place line');
  }

  const date = m[1].trim();
  const course = m[2].trim();
  const place = m[3].trim();
  const dt = parseDate(date);

  const comment = (text.match(/Comment: (.*?) (?:Info Registration News Conditions|Registration News Conditions|Conditions)/i)?.[1] || '').trim();
  const regDue = text.match(/Registration end: (\d{1,2}\/\d{1,2}\/\d{2} \d{1,2}:\d{2})/i)?.[1] || '';
  const maxRegistrants = Number(text.match(/Maximum number of players: (\d+)/i)?.[1] || '') || null;
  const registered = Number(text.match(/The number of registered players: (\d+)/i)?.[1] || '') || null;

  const classMatches = text.match(/\b(?:MA\d{1,2}|FA\d{1,2}|MP\d{1,2}|FP\d{1,2}|MJ\d{1,2}|FJ\d{1,2})\b/g) || [];
  const classes = Array.from(new Set(classMatches));
  const lower = ` ${text.toLowerCase()} `;
  const isCTier = lower.includes(' c - pdga ') || lower.includes(' pdga c-tier ') || lower.includes(' pdga c tier ');

  return {
    url,
    title: maybeTitle(text),
    date,
    event_datetime_iso: dt ? dt.toISOString() : null,
    course,
    place,
    description: comment,
    classes,
    max_registrants: maxRegistrants,
    registered,
    registration_due: regDue,
    is_c_tier: isCTier
  };
}

async function fetchAndParseEvent(url, logs) {
  const page = await fetchText(url);
  const text = stripHtml(page);
  return parseEventFromText(url, text);
}

async function geocodePlace(place, logs) {
  const lower = place.toLowerCase();
  for (const [name, coords] of FALLBACK_COORDS.entries()) {
    if (lower.includes(name)) {
      return { lat: coords[0], lon: coords[1], source: `fallback:${name}` };
    }
  }

  try {
    const q = encodeURIComponent(place);
    const body = await fetchText(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${q}`);
    const data = JSON.parse(body);
    if (Array.isArray(data) && data.length) {
      return { lat: Number(data[0].lat), lon: Number(data[0].lon), source: 'nominatim' };
    }
  } catch (err) {
    logs.push(`Geocode failed for ${place}: ${String(err.message || err)}`);
  }
  return null;
}

function withinNext30Days(iso) {
  if (!iso) return false;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return false;
  return ms >= NOW.getTime() && ms <= NOW.getTime() + THIRTY_DAYS_MS;
}

async function runSearch() {
  const logs = [];
  const candidates = await discoverCandidates(logs);
  logs.push(`Total candidate event pages: ${candidates.length}`);

  const parsed = [];
  for (const url of candidates) {
    try {
      logs.push(`Fetching event: ${url}`);
      parsed.push(await fetchAndParseEvent(url, logs));
    } catch (err) {
      logs.push(`Failed to parse ${url}: ${String(err.message || err)}`);
    }
  }

  const events = [];
  for (const ev of parsed) {
    if (!withinNext30Days(ev.event_datetime_iso)) continue;
    if (!ev.is_c_tier) continue;

    const coords = await geocodePlace(ev.place, logs);
    if (!coords) {
      logs.push(`Could not geocode: ${ev.place}`);
      continue;
    }

    const distance = haversineKm(HELSINKI, coords);
    if (distance > 100) continue;

    events.push({
      ...ev,
      distance_km: Math.round(distance * 10) / 10,
      geocode_source: coords.source
    });
  }

  events.sort((a, b) => String(a.event_datetime_iso).localeCompare(String(b.event_datetime_iso)));
  logs.push(`Final matches: ${events.length}`);

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    candidate_count: candidates.length,
    checked_count: parsed.length,
    events,
    logs
  };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);

  if (url.pathname === '/api/health') {
    return json({ ok: true, runtime: 'cloudflare-pages-function', now: new Date().toISOString() });
  }

  try {
    const data = await runSearch();
    return json(data, 200);
  } catch (err) {
    return json({ ok: false, error: String(err.message || err), stack: String(err.stack || '') }, 500);
  }
}
