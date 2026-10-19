#!/usr/bin/env node
// Sends a WhatsApp summary of IPOs closing today (IST).
// Scrapes fresh data; falls back to public/data/ipos.json if the source is down.
//
// Env:
//   WHATSAPP_PROVIDER    callmebot (default) | meta | twilio
//   WHATSAPP_RECIPIENTS  comma-separated. callmebot: "919953573400:APIKEY,91XXXXXXXXXX:APIKEY"
//                        meta / twilio: "919953573400,91XXXXXXXXXX" (country code, no +)
//   META_TOKEN, META_PHONE_NUMBER_ID, META_TEMPLATE (optional), META_TEMPLATE_LANG (default en)
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (e.g. +14155238886)
//   SITE_URL             link appended to the message
//   SEND_WHEN_EMPTY      "false" to skip sending when nothing closes today (default: send)
//   DRY_RUN=1            print the message, send nothing
//   FORCE=1              send even on a weekend / exchange holiday
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isWorkingDay, nextWorkingDay, prettyDate, todayIST } from './lib/dates.mjs';
import { scrape } from './scrape.mjs';

const env = process.env;
const inr = (n) => (n == null ? '—' : (n < 0 ? '-₹' : '₹') + Math.abs(n).toLocaleString('en-IN'));
const pct = (n) => (n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%');
const arrow = (t) => (t === 'up' ? '🟢' : t === 'down' ? '🔴' : '🟡');

async function getData() {
  try {
    return await scrape();
  } catch (err) {
    console.warn('Live scrape failed, using last snapshot:', err.message);
    return JSON.parse(readFileSync(new URL('../public/data/ipos.json', import.meta.url), 'utf8'));
  }
}

export function buildMessage(data, today, siteUrl) {
  const next = nextWorkingDay(today);
  const closing = data.ipos
    .filter((i) => i.close === today)
    .sort((a, b) => (b.estGainPct ?? -1e9) - (a.estGainPct ?? -1e9));
  const closingNext = data.ipos.filter((i) => i.close === next);

  const lines = [`*IPOs closing today · ${prettyDate(today)}*`];
  if (!closing.length) {
    lines.push('', 'No IPOs close today.');
  } else {
    closing.forEach((ipo, n) => {
      const trail = (ipo.history || []).filter((h) => h.gmp != null).slice(0, 7).reverse().map((h) => h.gmp);
      lines.push(
        '',
        `${n + 1}. *${ipo.name}* (${ipo.segment})`,
        `   GMP ${inr(ipo.gmp)} ${arrow(ipo.trend)} · ${pct(ipo.estGainPct)}`,
        `   Price ${inr(ipo.price)} → est. ${inr(ipo.estListing)}`,
      );
      if (trail.length > 1) lines.push(`   ${trail.length}d GMP: ${trail.join(' › ')}`);
      if (ipo.listingDate) lines.push(`   Lists ${prettyDate(ipo.listingDate)}`);
    });
  }
  if (closingNext.length) {
    lines.push('', `_Closing ${prettyDate(next)}:_ ` + closingNext.map((i) => `${i.name} (${inr(i.gmp)})`).join(', '));
  }
  lines.push('');
  if (siteUrl) lines.push(siteUrl);
  lines.push('_GMP is unofficial. Source: ipowatch.in_');
  return { text: lines.join('\n'), count: closing.length };
}

function recipients() {
  return (env.WHATSAPP_RECIPIENTS || '').split(/[,\n;]/).map((s) => s.trim()).filter(Boolean);
}

const providers = {
  async callmebot(entry, text) {
    const [phone, apikey] = entry.split(':').map((s) => s.trim());
    if (!apikey) throw new Error(`callmebot recipient "${phone}" needs "phone:apikey"`);
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent('+' + phone.replace(/^\+/, ''))}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apikey)}`;
    const res = await fetch(url);
    const body = await res.text();
    if (!res.ok || /error|invalid|not\s+allowed/i.test(body.slice(0, 500))) throw new Error(`CallMeBot ${res.status}: ${body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200)}`);
    return phone;
  },

  async meta(phone, text) {
    const { META_TOKEN, META_PHONE_NUMBER_ID, META_TEMPLATE, META_TEMPLATE_LANG = 'en' } = env;
    if (!META_TOKEN || !META_PHONE_NUMBER_ID) throw new Error('META_TOKEN and META_PHONE_NUMBER_ID are required');
    const to = phone.replace(/^\+/, '');
    // Template params may not contain newlines, so flatten for template sends.
    const body = META_TEMPLATE
      ? { messaging_product: 'whatsapp', to, type: 'template', template: { name: META_TEMPLATE, language: { code: META_TEMPLATE_LANG }, components: [{ type: 'body', parameters: [{ type: 'text', text: text.replace(/\n+/g, ' | ').replace(/\s{4,}/g, ' ').slice(0, 1000) }] }] } }
      : { messaging_product: 'whatsapp', to, type: 'text', text: { body: text, preview_url: true } };
    const res = await fetch(`https://graph.facebook.com/v21.0/${META_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${META_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Meta ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return to;
  },

  async twilio(phone, text) {
    const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: tok, TWILIO_FROM: from } = env;
    if (!sid || !tok || !from) throw new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM are required');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: `whatsapp:+${from.replace(/^\+/, '')}`, To: `whatsapp:+${phone.replace(/^\+/, '')}`, Body: text }),
    });
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return phone;
  },
};

async function main() {
  const today = todayIST();
  if (!isWorkingDay(today) && !env.FORCE) {
    console.log(`${today} is a weekend/exchange holiday — no IPOs close today. Skipping.`);
    return;
  }

  const siteUrl = env.SITE_URL || (env.GITHUB_REPOSITORY
    ? `https://${env.GITHUB_REPOSITORY.split('/')[0].toLowerCase()}.github.io/${env.GITHUB_REPOSITORY.split('/')[1]}/`
    : '');
  const data = await getData();
  const { text, count } = buildMessage(data, today, siteUrl);

  console.log('----- message -----\n' + text + '\n-------------------');
  if (!count && String(env.SEND_WHEN_EMPTY).toLowerCase() === 'false') { console.log('Nothing closes today; SEND_WHEN_EMPTY=false, skipping.'); return; }
  if (env.DRY_RUN) { console.log('DRY_RUN set — not sending.'); return; }

  const provider = (env.WHATSAPP_PROVIDER || 'callmebot').toLowerCase();
  const send = providers[provider];
  if (!send) throw new Error(`Unknown WHATSAPP_PROVIDER "${provider}"`);
  const list = recipients();
  if (!list.length) throw new Error('WHATSAPP_RECIPIENTS is empty');

  let failed = 0;
  for (const r of list) {
    try {
      const who = await send(r, text);
      console.log(`✓ sent to ${String(who).replace(/\d(?=\d{4})/g, '•')}`);
    } catch (err) {
      failed++;
      console.error('✗ ' + err.message);
    }
    await new Promise((res) => setTimeout(res, 2500)); // be gentle with rate limits
  }
  if (failed) process.exit(1);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main().catch((err) => { console.error('✗', err.message); process.exit(1); });
