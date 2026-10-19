#!/usr/bin/env node
// Scrapes ipowatch.in: the live GMP list (mainboard + SME) and, for each IPO,
// its detail page (exact dates, issue facts, day-wise GMP history).
// Writes public/data/ipos.json. Exits non-zero only if nothing could be parsed,
// so the last committed snapshot keeps the site alive if the source changes.
import { load } from 'cheerio';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOLIDAYS, addDays, nextWorkingDay, parseDayMonth, parseFullDate, parseRange, todayIST,
} from './lib/dates.mjs';

const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const OUT = fileURLToPath(new URL('../public/data/ipos.json', import.meta.url));
const UA = 'Mozilla/5.0 (compatible; ipo-watch/1.0; +https://github.com) AppleWebKit/537.36 Chrome/126 Safari/537.36';

const clean = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

export function parseMoney(s) {
  const t = clean(s).replace(/,/g, '');
  const m = t.match(/(-)?\s*₹?\s*(-)?\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const v = Number(m[3]);
  return m[1] || m[2] ? -v : v;
}

export function parsePct(s) {
  const m = clean(s).match(/(-?\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}

export function parseTrend(s) {
  const t = s || '';
  if (t.includes('🟢')) return 'up';
  if (t.includes('🔴')) return 'down';
  if (t.includes('🟡')) return 'flat';
  return null;
}

function absUrl(href) {
  if (!href) return null;
  try { return new URL(href, config.source.baseUrl).href; } catch { return null; }
}

function slugOf(url, name) {
  const fromUrl = url ? new URL(url).pathname.replace(/\/+$/, '').split('/').pop() : '';
  return (fromUrl || name).toLowerCase().replace(/-ipo-gmp.*$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function fetchHtml(url, attempt = 1) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.requestTimeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-IN,en;q=0.9' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      return fetchHtml(url, attempt + 1);
    }
    throw new Error(`${url}: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** List page: every tablepress table with a "Company" header. */
export function parseList(html, today) {
  const $ = load(html);
  const ipos = [];
  let lastHeading = '';
  $('h1, h2, h3, h4, table').each((_, el) => {
    if (el.tagName !== 'table') { lastHeading = clean($(el).text()); return; }
    const headers = $(el).find('thead th, tr:first-child th').map((_, th) => clean($(th).text()).toLowerCase()).get();
    if (!headers.length || !headers[0].startsWith('company')) return;
    const col = (name) => headers.findIndex((h) => h.startsWith(name));
    const iGmp = col('gmp'), iTrend = col('trend'), iPrice = col('price'), iGain = col('est'), iDate = col('date');
    const segment = /sme/i.test(lastHeading) ? 'SME' : 'Mainboard';

    $(el).find('tbody tr').each((_, tr) => {
      const tds = $(tr).find('td');
      if (tds.length < 4) return;
      const first = tds.eq(0);
      const a = first.find('a').first();
      const name = clean(a.text() || first.contents().first().text());
      if (!name) return;
      const status = clean(first.find('span').last().text()) || null;
      const url = absUrl(a.attr('href'));
      const gainCell = iGain >= 0 ? clean(tds.eq(iGain).text()) : '';
      const dateText = iDate >= 0 ? clean(tds.eq(iDate).text()) : '';
      const range = parseRange(dateText, today);
      ipos.push({
        id: slugOf(url, name),
        name,
        url,
        segment,
        status,
        gmp: iGmp >= 0 ? parseMoney(tds.eq(iGmp).text()) : null,
        trend: iTrend >= 0 ? parseTrend(tds.eq(iTrend).text()) : null,
        price: iPrice >= 0 ? parseMoney(tds.eq(iPrice).text()) : null,
        estListing: parseMoney(gainCell),
        estGainPct: parsePct(gainCell),
        dateText,
        open: range?.open ?? null,
        close: range?.close ?? null,
      });
    });
  });
  // De-duplicate (same IPO can appear in more than one table)
  const seen = new Set();
  return ipos.filter((i) => (seen.has(i.id) ? false : seen.add(i.id)));
}

/** Detail page: key/value facts + day-wise GMP history table. */
export function parseDetail(html, today) {
  const $ = load(html);
  const facts = {};
  let history = [];

  $('table').each((_, table) => {
    const rows = $(table).find('tr');
    const firstCells = rows.first().find('td, th').map((_, c) => clean($(c).text()).toLowerCase()).get();

    if (!history.length && firstCells.some((c) => c === 'date') && firstCells.some((c) => c.includes('gmp'))) {
      const idx = (pred) => firstCells.findIndex(pred);
      const iDate = idx((c) => c === 'date');
      const iGmp = idx((c) => c.includes('gmp') && !c.includes('trend'));
      const iTrend = idx((c) => c.includes('trend'));
      const iGain = idx((c) => c.includes('gain'));
      const iUpd = idx((c) => c.includes('updated'));
      rows.slice(1).each((_, tr) => {
        const tds = $(tr).find('td');
        const date = parseDayMonth(clean(tds.eq(iDate).text()), today);
        if (!date) return;
        history.push({
          date,
          gmp: iGmp >= 0 ? parseMoney(tds.eq(iGmp).text()) : null,
          trend: iTrend >= 0 ? parseTrend(tds.eq(iTrend).text()) : null,
          gainPct: iGain >= 0 ? parsePct(tds.eq(iGain).text()) : null,
          updated: iUpd >= 0 ? clean(tds.eq(iUpd).text()) || null : null,
        });
      });
      return;
    }

    rows.each((_, tr) => {
      const tds = $(tr).find('td, th');
      if (tds.length !== 2) return;
      const k = clean(tds.eq(0).text());
      const v = clean(tds.eq(1).text());
      if (k && v && k.length < 60 && v.length < 160 && !(k in facts)) facts[k] = v;
    });
  });

  const pick = (re) => {
    const key = Object.keys(facts).find((k) => re.test(k));
    return key ? facts[key] : null;
  };

  // Keep one row per date (latest first), within the history window.
  const cutoff = addDays(today, -(config.historyDays - 1));
  const byDate = new Map();
  for (const h of history) if (h.date >= cutoff && h.date <= addDays(today, 1) && !byDate.has(h.date)) byDate.set(h.date, h);
  history = [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));

  return {
    open: parseFullDate(pick(/^ipo open date$/i) || pick(/open date/i)),
    close: parseFullDate(pick(/^ipo close date$/i) || pick(/close date/i)),
    listingDate: parseFullDate(pick(/listing date/i)),
    allotmentDate: parseFullDate(pick(/allotment date|basis of allotment/i)),
    details: {
      priceBand: pick(/price band/i),
      issueSize: pick(/^issue size/i) || pick(/^fresh issue/i),
      issueType: pick(/issue type/i),
      listingAt: pick(/^ipo listing$|listing at/i),
    },
    history,
  };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) { const n = i++; out[n] = await fn(items[n], n); }
  }));
  return out;
}

export async function scrape() {
  const today = todayIST();
  const listHtml = await fetchHtml(config.source.listUrl);
  const ipos = parseList(listHtml, today);
  if (!ipos.length) throw new Error('No IPOs parsed from list page — source layout may have changed');

  const errors = [];
  await mapLimit(ipos, config.detailConcurrency, async (ipo) => {
    if (!ipo.url) return;
    try {
      const d = parseDetail(await fetchHtml(ipo.url), today);
      if (d.open) ipo.open = d.open;
      if (d.close) ipo.close = d.close;
      ipo.listingDate = d.listingDate;
      ipo.allotmentDate = d.allotmentDate;
      ipo.details = d.details;
      ipo.history = d.history;
    } catch (err) {
      errors.push(err.message);
      ipo.history = [];
    }
  });

  ipos.sort((a, b) => (a.close || '9999').localeCompare(b.close || '9999') || a.name.localeCompare(b.name));

  return {
    generatedAt: new Date().toISOString(),
    today,
    nextWorkingDay: nextWorkingDay(today),
    holidays: [...HOLIDAYS].sort(),
    historyDays: config.historyDays,
    source: config.source.listUrl,
    errors,
    ipos,
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    const data = await scrape();
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
    const closingToday = data.ipos.filter((i) => i.close === data.today).length;
    const closingNext = data.ipos.filter((i) => i.close === data.nextWorkingDay).length;
    console.log(`✓ ${data.ipos.length} IPOs · closing today ${closingToday} · next working day (${data.nextWorkingDay}) ${closingNext} · detail errors ${data.errors.length}`);
    for (const e of data.errors) console.warn('  ! ' + e);
  } catch (err) {
    console.error('✗ Scrape failed:', err.message);
    process.exit(1);
  }
}
