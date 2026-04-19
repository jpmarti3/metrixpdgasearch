const BASE_URL = "https://discgolfmetrix.com";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

export async function onRequestPost(context) {
  try {
    const payload = await context.request.json();
    const result = await searchAndScrape(payload);
    return jsonResponse(result);
  } catch (error) {
    return jsonResponse({ error: error.message || "Unexpected error" }, 500);
  }
}

export async function onRequestGet() {
  return jsonResponse({ ok: true, runtime: "Cloudflare Pages Functions" });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function cleanText(value) {
  if (!value) return "";
  return decodeHtmlEntities(
    String(value)
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/li>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&rarr;/g, "→")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8595;/g, "↓")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&uuml;/g, "ü")
    .replace(/&ouml;/g, "ö")
    .replace(/&auml;/g, "ä");
}

function parseNumber(value) {
  if (value == null) return null;
  const digits = String(value).replace(/[^\d-]/g, "");
  return digits ? Number(digits) : null;
}

function boolFromYesNo(value) {
  const normalized = cleanText(value).toLowerCase();
  if (normalized === "yes") return true;
  if (normalized === "no") return false;
  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchText(url, referer = `${BASE_URL}/`) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": referer,
      "Cache-Control": "no-cache",
      "Pragma": "no-cache"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return await response.text();
}

function buildSearchApiUrl(params) {
  const url = new URL(`${BASE_URL}/competitions_server.php`);
  const defaults = {
    name: "",
    date1: "",
    date2: "",
    registration_date1: "",
    registration_date2: "",
    country_code: "",
    area: "",
    type: "",
    from: "1",
    to: "20",
    page: "all"
  };

  const merged = { ...defaults, ...params };
  for (const [key, value] of Object.entries(merged)) {
    if (value == null) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function buildSearchPageUrl(params) {
  const url = new URL(`${BASE_URL}/`);
  const defaults = {
    u: "competitions_all",
    view: "",
    competition_name: params.name || "",
    period: "next30",
    date1: params.date1 || "",
    date2: params.date2 || "",
    my_country: "",
    registration_open: "",
    registration_date1: params.registration_date1 || "",
    registration_date2: params.registration_date2 || "",
    country_code: params.country_code || "",
    my_club: "",
    club_type: "",
    club_id: "",
    association_id: "0",
    close_to_me: "",
    area: params.area || "",
    city: "",
    course_id: "",
    type: params.type || "",
    division: "",
    my: "",
    sort_name: "",
    sort_order: "",
    my_all: ""
  };

  for (const [key, value] of Object.entries(defaults)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function toAbsoluteUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return `${BASE_URL}${url}`;
  return `${BASE_URL}/${url}`;
}

function getAllMatches(text, regex) {
  const matches = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    matches.push(match);
  }
  return matches;
}

function extractListItems(html) {
  return getAllMatches(html, /<li\b[^>]*>([\s\S]*?)<\/li>/gi).map(m => cleanText(m[1]));
}

function extractCompetitionListHtml(html) {
  const match = html.match(/<div id=["']competition_list2["'][^>]*>([\s\S]*?)<ul class=["']pagination/i);
  if (match) return match[1];
  return html;
}

function parseSearchResults(html) {
  const searchArea = extractCompetitionListHtml(html);
  const anchorRegex = /<a\b(?=[^>]*href=["']\/(\d+)(?:[^"']*)?["'])(?=[^>]*class=["'][^"']*gridlist[^"']*["'])[^>]*>([\s\S]*?)<\/a>/gi;
  const anchorMatches = getAllMatches(searchArea, anchorRegex);

  const events = anchorMatches.map(match => {
    const eventId = match[1];
    const block = match[2];
    const titleMatch = block.match(/<h2>([\s\S]*?)<\/h2>/i);
    const typeMatch = block.match(/<span class=["']competition-type[^"']*["']>([\s\S]*?)<\/span>/i);
    const items = extractListItems(block);

    return {
      eventId,
      eventUrl: `${BASE_URL}/${eventId}`,
      registrationUrl: `${BASE_URL}/${eventId}&view=registration`,
      title: cleanText(titleMatch?.[1] || eventId),
      eventType: cleanText(typeMatch?.[1] || ""),
      dateTimeText: items[0] || null,
      courseText: items[1] || null,
      locationText: items[2] || null,
      playersShown: parseNumber(items[3]),
      registrationOpenUntilText: items[4] || null,
      commentText: items[5] || null
    };
  });

  const currentPageMatch = html.match(/<li class=["']current["']>([\s\S]*?)<\/li>/i);
  const hasNext = !/<li class=["']pagination-next disabled["']>/i.test(html);

  return {
    events,
    pagination: {
      currentPage: cleanText(currentPageMatch?.[1] || "1"),
      hasNext
    }
  };
}

function parseEventHeader(html, eventId) {
  const titleMatch = html.match(/<header class="main-header">[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const pMatch = html.match(/<header class="main-header">[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
  const pdgaMatch = html.match(/<a href="(https:\/\/www\.pdga\.com\/tour\/event\/[^\"]+)"/i);
  const commentMatch = html.match(/<span class="text-dark-gray">Comment:\s*<\/span>([\s\S]*?)<\/li>/i);

  const paragraphText = cleanText(pMatch?.[1] || "");
  const courseLinkMatch = html.match(/<p class="text-uppercase font-bold">[\s\S]*?<a href="[^"]+">([\s\S]*?)<\/a>/i);
  const courseLinkText = cleanText(courseLinkMatch?.[1] || "");

  let courseName = null;
  let layoutName = null;
  if (courseLinkText.includes("→")) {
    const parts = courseLinkText.split("→").map(s => s.trim());
    courseName = parts[0] || null;
    layoutName = parts[1] || null;
  } else if (courseLinkText.includes("->")) {
    const parts = courseLinkText.split("->").map(s => s.trim());
    courseName = parts[0] || null;
    layoutName = parts[1] || null;
  } else {
    courseName = courseLinkText || null;
  }

  let country = null;
  let region = null;
  let city = null;
  const headerBits = paragraphText.split("|").map(s => s.trim()).filter(Boolean);
  const locationPart = headerBits[headerBits.length - 1] || "";
  const locPieces = locationPart.split(",").map(s => s.trim()).filter(Boolean);
  if (locPieces.length >= 3) {
    country = locPieces[0] || null;
    region = locPieces[1] || null;
    city = locPieces[2] || null;
  }

  return {
    eventId,
    title: cleanText(titleMatch?.[1] || ""),
    headerText: paragraphText,
    courseName,
    layoutName,
    pdgaEventUrl: pdgaMatch?.[1] || null,
    comment: cleanText(commentMatch?.[1] || ""),
    country,
    region,
    city
  };
}

function parseConditionsTable(html) {
  const tables = getAllMatches(html, /<table class="data data-hover">([\s\S]*?)<\/table>/gi).map(m => m[1]);
  if (!tables.length) return [];
  const table = tables[0];

  const rows = getAllMatches(table, /<tr>([\s\S]*?)<\/tr>/gi);
  const result = [];

  for (const row of rows) {
    const tds = getAllMatches(row[1], /<td[^>]*>([\s\S]*?)<\/td>/gi).map(m => cleanText(m[1]));
    if (tds.length >= 2) {
      const divisionText = tds[0];
      let divisionCode = null;
      let divisionName = divisionText;
      const codeMatch = divisionText.match(/^([A-Z0-9+]+)\s+(.*)$/);
      if (codeMatch) {
        divisionCode = codeMatch[1];
        divisionName = codeMatch[2];
      } else if (divisionText.toLowerCase() === "general") {
        divisionCode = "GENERAL";
      }

      result.push({
        divisionCode,
        divisionName,
        conditionsText: tds[1]
      });
    }
  }

  return result;
}

function parseRegistrationSettings(html) {
  const result = {};
  const metaSectionMatch = html.match(/<h2>Conditions<\/h2>[\s\S]*?<ul class="main-header-meta">([\s\S]*?)<\/ul>/i);
  const items = extractListItems(metaSectionMatch?.[1] || "");

  for (const text of items) {
    if (/registration start:/i.test(text)) result.registrationStart = cleanText(text.replace(/.*registration start:\s*/i, ""));
    if (/registration end:/i.test(text)) result.registrationEnd = cleanText(text.replace(/.*registration end:\s*/i, ""));
    if (/maximum number of players:/i.test(text)) result.maxPlayers = parseNumber(text);
    if (/the number of registered players:/i.test(text)) result.registeredPlayers = parseNumber(text);
    if (/wildcards:/i.test(text)) result.wildcards = parseNumber(text);
  }

  return result;
}

function splitRegistrationTables(html) {
  return getAllMatches(html, /<table class="data data-hover">([\s\S]*?)<\/table>/gi).map(m => m[1]);
}

function parseEntrants(html, eventId) {
  const tables = splitRegistrationTables(html);
  const entrants = [];

  for (let i = 1; i < tables.length; i++) {
    const table = tables[i];
    const headerMatch = table.match(/<thead>[\s\S]*?<th>&nbsp;<\/th><th>([\s\S]*?)<\/th>/i);
    const divisionHeader = cleanText(headerMatch?.[1] || "");
    const divisionCountMatch = divisionHeader.match(/^(.*)\((\d+)\)$/);
    const divisionName = divisionCountMatch ? cleanText(divisionCountMatch[1]) : divisionHeader;
    const divisionShownCount = divisionCountMatch ? Number(divisionCountMatch[2]) : null;

    const rows = getAllMatches(table, /<tr>([\s\S]*?)<\/tr>/gi);
    for (const row of rows) {
      const tds = getAllMatches(row[1], /<td[^>]*>([\s\S]*?)<\/td>/gi);
      if (tds.length < 8) continue;

      const nameCellRaw = tds[1][1];
      const playerMatch = nameCellRaw.match(/<a href="([^"]+)">([\s\S]*?)<\/a>/i);
      const flagMatch = nameCellRaw.match(/\/([a-z]{2})\.png/i);

      entrants.push({
        eventId,
        divisionName,
        divisionShownCount,
        placement: parseNumber(tds[0][1]),
        playerName: cleanText(playerMatch?.[2] || nameCellRaw),
        playerProfileUrl: playerMatch?.[1] ? toAbsoluteUrl(playerMatch[1]) : null,
        countryCode: flagMatch?.[1] ? flagMatch[1].toUpperCase() : null,
        pdgaNumber: cleanText(tds[2][1]),
        pdgaRating: parseNumber(tds[3][1]),
        club: cleanText(tds[4][1]),
        waitingListPosition: parseNumber(tds[5][1]),
        confirmed: boolFromYesNo(tds[6][1]),
        registeredOn: cleanText(tds[7][1])
      });
    }
  }

  return entrants;
}

function parseRegistrationStatistics(html) {
  const statsBlockMatch = html.match(/<h2>Registration statistics<\/h2>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i);
  const block = statsBlockMatch?.[1] || html;
  const tables = getAllMatches(block, /<table>([\s\S]*?)<\/table>/gi).map(m => m[1]);

  const summaryRows = [];
  const countryRows = [];

  for (const table of tables) {
    const headerText = cleanText(table.match(/<thead>([\s\S]*?)<\/thead>/i)?.[1] || "").toLowerCase();
    const rows = getAllMatches(table, /<tr>([\s\S]*?)<\/tr>/gi);

    if (headerText.includes("summary")) {
      for (const row of rows) {
        const tds = getAllMatches(row[1], /<td[^>]*>([\s\S]*?)<\/td>/gi).map(m => cleanText(m[1]));
        if (tds.length >= 2) {
          summaryRows.push({
            label: tds[0],
            count: parseNumber(tds[1]),
            max: tds.length >= 3 ? parseNumber(tds[2]) : null,
            waiting: tds.length >= 4 ? parseNumber(tds[3]) : null
          });
        }
      }
    } else if (headerText.includes("countries")) {
      for (const row of rows) {
        const tds = getAllMatches(row[1], /<td[^>]*>([\s\S]*?)<\/td>/gi).map(m => cleanText(m[1]));
        if (tds.length >= 2) {
          countryRows.push({
            country: tds[0],
            count: parseNumber(tds[1])
          });
        }
      }
    }
  }

  const totals = {
    registeredPlayersTotal: null,
    maxPlayersTotal: null,
    waitingTotal: null,
    confirmedTotal: null,
    usedWildcards: null
  };

  for (const row of summaryRows) {
    const label = (row.label || "").toLowerCase();
    if (label.includes("the number of registered players")) {
      totals.registeredPlayersTotal = row.count;
      totals.maxPlayersTotal = row.max;
      totals.waitingTotal = row.waiting;
    } else if (label === "confirmed:") {
      totals.confirmedTotal = row.count;
    } else if (label === "used wildcards:") {
      totals.usedWildcards = row.count;
    }
  }

  return { summaryRows, countryRows, totals };
}

function parseRegistrationPage(html, eventId) {
  return {
    registrationSettings: parseRegistrationSettings(html),
    divisionConditions: parseConditionsTable(html),
    entrants: parseEntrants(html, eventId),
    registrationSummary: parseRegistrationStatistics(html)
  };
}

async function scrapeOneEvent(event) {
  const eventHtml = await fetchText(event.eventUrl, event.eventUrl);
  await sleep(100);
  const registrationHtml = await fetchText(event.registrationUrl, event.eventUrl);

  return {
    ...event,
    details: parseEventHeader(eventHtml, event.eventId),
    registration: parseRegistrationPage(registrationHtml, event.eventId)
  };
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await mapper(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function collectAllSearchPages(criteria) {
  const batchSize = Number(criteria.to || 20);
  let from = Number(criteria.from || 1);
  let pageCount = 0;
  const maxPages = Number(criteria.maxPages || 25);
  const allEvents = [];
  const seenIds = new Set();
  let lastPagination = { currentPage: "1", hasNext: false };
  let lastSearchUrl = null;
  const logs = [];

  while (pageCount < maxPages) {
    const to = from + batchSize - 1;
    const apiUrl = buildSearchApiUrl({ ...criteria, from, to, page: criteria.page || "all" });
    const pageUrl = buildSearchPageUrl(criteria);

    lastSearchUrl = apiUrl;
    logs.push(`Search API URL: ${apiUrl}`);
    const apiHtml = await fetchText(apiUrl, pageUrl);
    logs.push(`Fetched API page: ${apiHtml.length} chars`);

    let parsed = parseSearchResults(apiHtml);
    logs.push(`API event links found: ${parsed.events.length}`);

    if (parsed.events.length === 0) {
      logs.push(`Fallback page URL: ${pageUrl}`);
      const pageHtml = await fetchText(pageUrl, pageUrl);
      logs.push(`Fetched fallback page: ${pageHtml.length} chars`);
      parsed = parseSearchResults(pageHtml);
      logs.push(`Fallback event links found: ${parsed.events.length}`);
      lastSearchUrl = pageUrl;
    }

    lastPagination = parsed.pagination;

    let newCount = 0;
    for (const event of parsed.events) {
      if (!seenIds.has(event.eventId)) {
        seenIds.add(event.eventId);
        allEvents.push(event);
        newCount++;
      }
    }

    logs.push(`New events added: ${newCount}`);

    if (parsed.events.length === 0) break;
    if (newCount === 0) break;
    if (parsed.events.length < batchSize) break;

    from += batchSize;
    pageCount++;
    await sleep(100);
  }

  return {
    searchUrl: lastSearchUrl,
    events: allEvents,
    pagination: lastPagination,
    logs
  };
}

async function searchAndScrape(payload) {
  const criteria = {
    name: payload.name || "",
    date1: payload.date1 || "",
    date2: payload.date2 || "",
    registration_date1: payload.registration_date1 || "",
    registration_date2: payload.registration_date2 || "",
    country_code: payload.country_code || "",
    area: payload.area || "",
    type: payload.type || "",
    from: Number(payload.from || 1),
    to: Number(payload.to || 20),
    page: payload.page || "all",
    maxPages: Number(payload.maxPages || 25)
  };

  const includeDetails = payload.includeDetails !== false;
  const concurrency = Math.max(1, Math.min(5, Number(payload.concurrency || 2)));

  const searchData = await collectAllSearchPages(criteria);
  let events = searchData.events;

  if (includeDetails) {
    events = await mapLimit(events, concurrency, async (event) => {
      try {
        return await scrapeOneEvent(event);
      } catch (error) {
        return {
          ...event,
          scrapeError: error.message || String(error)
        };
      }
    });
  }

  return {
    ok: true,
    cloudflareDeployable: true,
    deploymentTarget: "Cloudflare Pages + Functions",
    runtime: "Cloudflare Pages Functions",
    searchUrl: searchData.searchUrl,
    criteria,
    pagination: searchData.pagination,
    totalEventsReturned: events.length,
    events,
    logs: searchData.logs
  };
}
