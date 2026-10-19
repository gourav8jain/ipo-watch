// Date helpers. All "dates" are ISO strings (YYYY-MM-DD) in India time.
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../../config.json', import.meta.url), 'utf8'));

export const TZ = config.timezone || 'Asia/Kolkata';

export const HOLIDAYS = new Set(
  Object.entries(config)
    .filter(([k]) => k.startsWith('nseHolidays'))
    .flatMap(([, v]) => v)
);

const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

export function monthIndex(name) {
  if (!name) return undefined;
  const k = name.trim().toLowerCase();
  return MONTHS[k] ?? MONTHS[k.slice(0, 3)];
}

/** Today's date in India as YYYY-MM-DD (override with TODAY env for testing). */
export function todayIST(now = new Date()) {
  if (process.env.TODAY) return process.env.TODAY;
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function toISO(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

export function isWorkingDay(iso) {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay();
  return dow !== 0 && dow !== 6 && !HOLIDAYS.has(iso);
}

export function nextWorkingDay(iso) {
  let d = addDays(iso, 1);
  for (let i = 0; i < 15 && !isWorkingDay(d); i++) d = addDays(d, 1);
  return d;
}

/** Pick the year that puts day/month closest to the reference date. */
export function inferYear(m, d, refISO) {
  const refY = Number(refISO.slice(0, 4));
  let best = null;
  for (const y of [refY - 1, refY, refY + 1]) {
    const iso = toISO(y, m, d);
    const dist = Math.abs(daysBetween(refISO, iso));
    if (!best || dist < best.dist) best = { iso, dist };
  }
  return best.iso;
}

/**
 * Parse list-page ranges like "15-19 Oct", "29 Oct-2 Nov", "29 Oct - 02 Nov".
 * Returns { open, close } ISO strings or null.
 */
export function parseRange(text, refISO) {
  if (!text) return null;
  const t = text.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(\d{1,2})\s*([A-Za-z]{3,9})?\s*-\s*(\d{1,2})\s*([A-Za-z]{3,9})$/);
  if (!m) return null;
  const closeM = monthIndex(m[4]);
  const openM = m[2] ? monthIndex(m[2]) : closeM;
  if (closeM === undefined || openM === undefined) return null;
  const close = inferYear(closeM, Number(m[3]), refISO);
  let open = toISO(Number(close.slice(0, 4)), openM, Number(m[1]));
  if (open > close) open = toISO(Number(close.slice(0, 4)) - 1, openM, Number(m[1]));
  return { open, close };
}

/** Parse "October 21, 2026" / "21 October 2026" / "Oct 21, 2026". */
export function parseFullDate(text) {
  if (!text) return null;
  const t = text.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  let m = t.match(/^([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})/);
  if (m && monthIndex(m[1]) !== undefined) return toISO(Number(m[3]), monthIndex(m[1]), Number(m[2]));
  m = t.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m && monthIndex(m[2]) !== undefined) return toISO(Number(m[3]), monthIndex(m[2]), Number(m[1]));
  return null;
}

/** Parse "19 October" (history rows, no year) relative to a reference date. */
export function parseDayMonth(text, refISO) {
  const full = parseFullDate(text);
  if (full) return full;
  const t = (text || '').replace(/\s+/g, ' ').trim();
  let m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)/);
  if (m && monthIndex(m[2]) !== undefined) return inferYear(monthIndex(m[2]), Number(m[1]), refISO);
  m = t.match(/^([A-Za-z]+)\s+(\d{1,2})/);
  if (m && monthIndex(m[1]) !== undefined) return inferYear(monthIndex(m[1]), Number(m[2]), refISO);
  return null;
}

export function prettyDate(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' });
}
