import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextWorkingDay, parseDayMonth, parseFullDate, parseRange } from './lib/dates.mjs';
import { parseDetail, parseList, parseMoney, parsePct } from './scrape.mjs';
import { buildMessage } from './notify.mjs';

test('date ranges from the list page', () => {
  assert.deepEqual(parseRange('15-19 Oct', '2026-10-19'), { open: '2026-10-15', close: '2026-10-19' });
  assert.deepEqual(parseRange('29 Oct-2 Nov', '2026-10-19'), { open: '2026-10-29', close: '2026-11-02' });
  assert.deepEqual(parseRange('30 Dec - 2 Jan', '2026-12-29'), { open: '2026-12-30', close: '2027-01-02' });
  assert.equal(parseRange('TBA', '2026-10-19'), null);
});

test('full and partial dates', () => {
  assert.equal(parseFullDate('October 21, 2026'), '2026-10-21');
  assert.equal(parseDayMonth('19 October', '2026-10-19'), '2026-10-19');
  assert.equal(parseDayMonth('31 December', '2027-01-03'), '2026-12-31');
});

test('next working day skips weekends and NSE holidays', () => {
  assert.equal(nextWorkingDay('2026-10-19'), '2026-10-21'); // 20 Oct = Dussehra
  assert.equal(nextWorkingDay('2026-10-23'), '2026-10-26'); // Fri → Mon
});

test('money and percent', () => {
  assert.equal(parseMoney('₹1,119'), 1119);
  assert.equal(parseMoney('-₹5'), -5);
  assert.equal(parseMoney('₹-'), null);
  assert.equal(parseMoney('₹1379 (23.24%)'), 1379);
  assert.equal(parsePct('₹1379 (23.24%)'), 23.24);
  assert.equal(parsePct('[.]%'), null);
});

const LIST = `<h2>Mainboard IPO GMP</h2><table class="tablepress"><thead><tr><th>Company</th><th>GMP*</th><th>Trend</th><th>Price Band</th><th>Est. Gain</th><th>Date</th></tr></thead>
<tbody><tr><td><a href="/tonbo-imaging-ipo-gmp-grey-market-premium/">Tonbo Imaging</a><br><span style="color: green;">Open</span></td><td><strong>₹520</strong></td><td>🟢</td><td>₹700</td><td>₹1220 (74.28%)</td><td>15-19 Oct</td></tr></tbody></table>
<h2>SME IPO GMP</h2><table class="tablepress"><thead><tr><th>Company</th><th>GMP*</th><th>Trend</th><th>Price Band</th><th>Est. Gain</th><th>Date</th></tr></thead>
<tbody><tr><td><a href="https://ipowatch.in/shellz-india-ipo-gmp-grey-market-premium/">Shellz India</a><br><span>Open</span></td><td>₹35</td><td>🟡</td><td>₹179</td><td>₹214 (19.55%)</td><td>15-19 Oct</td></tr></tbody></table>`;

test('list page parsing', () => {
  const ipos = parseList(LIST, '2026-10-19');
  assert.equal(ipos.length, 2);
  assert.equal(ipos[0].name, 'Tonbo Imaging');
  assert.equal(ipos[0].segment, 'Mainboard');
  assert.equal(ipos[0].url, 'https://ipowatch.in/tonbo-imaging-ipo-gmp-grey-market-premium/');
  assert.equal(ipos[0].gmp, 520);
  assert.equal(ipos[0].trend, 'up');
  assert.equal(ipos[0].close, '2026-10-19');
  assert.equal(ipos[1].segment, 'SME');
  assert.equal(ipos[1].estGainPct, 19.55);
});

const DETAIL = `<table><tr><td>Date</td><td>IPO GMP</td><td>GMP Trend</td><td>Gain</td><td>Last Updated</td></tr>
<tr><td>19 October</td><td>₹520</td><td>🟢</td><td>74.28%</td><td>17:30</td></tr>
<tr><td>18 October</td><td>₹500</td><td>🔴</td><td>[.]%</td><td>15:30</td></tr>
<tr><td>1 September</td><td>₹10</td><td>🔴</td><td>1%</td><td>15:30</td></tr></table>
<table><tr><td>IPO Open Date</td><td>October 15, 2026</td></tr><tr><td>IPO Close Date</td><td>October 19, 2026</td></tr>
<tr><td>IPO Price Band</td><td>₹665 to ₹700 Per Share</td></tr><tr><td>IPO Listing Date:</td><td>October 23, 2026</td></tr></table>`;

test('detail page parsing keeps only the history window', () => {
  const d = parseDetail(DETAIL, '2026-10-19');
  assert.equal(d.open, '2026-10-15');
  assert.equal(d.close, '2026-10-19');
  assert.equal(d.listingDate, '2026-10-23');
  assert.equal(d.details.priceBand, '₹665 to ₹700 Per Share');
  assert.equal(d.history.length, 2);
  assert.equal(d.history[0].gmp, 520);
  assert.equal(d.history[1].gainPct, null);
});

test('whatsapp message', () => {
  const data = { ipos: [
    { name: 'Tonbo Imaging', segment: 'Mainboard', gmp: 520, trend: 'up', price: 700, estListing: 1220, estGainPct: 74.28, close: '2026-10-19', history: [{ gmp: 520 }, { gmp: 500 }] },
    { name: 'Jio Platforms', segment: 'Mainboard', gmp: 260, close: '2026-10-21', history: [] },
  ] };
  const { text, count } = buildMessage(data, '2026-10-19', 'https://x.github.io/ipo-watch/');
  assert.equal(count, 1);
  assert.match(text, /Tonbo Imaging/);
  assert.match(text, /2d GMP: 500 › 520/);
  assert.match(text, /Jio Platforms \(₹260\)/);
});
