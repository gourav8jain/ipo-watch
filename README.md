# GMP Watch

Mobile-first site showing the grey market premium (GMP) of IPOs **closing today** and on the **next working day** (NSE holidays aware), with up to 14 days of day-wise GMP history per IPO. Data is scraped from [ipowatch.in](https://ipowatch.in/). A WhatsApp summary of IPOs closing today goes out at **10:00 AM IST** on market days.

```
public/                  static site (deployed as-is to GitHub Pages)
  data/ipos.json         scraped snapshot (regenerated on every deploy)
scripts/scrape.mjs       list page + each IPO page → public/data/ipos.json
scripts/notify.mjs       WhatsApp summary (CallMeBot / Meta Cloud API / Twilio)
config.json              source URLs, history window, NSE holiday list
.github/workflows/
  deploy.yml             on push to main + every 2h (9 AM–9 PM IST): scrape → deploy Pages
  whatsapp.yml           10:00 AM IST Mon–Fri: scrape → send summary
```

## Go live (one-time, ~5 minutes)

1. **Create the GitHub repo and push**
   ```bash
   git remote add origin https://github.com/<you>/ipo-watch.git
   git push -u origin main
   ```
2. **Enable Pages:** repo → *Settings → Pages → Build and deployment → Source: **GitHub Actions***.
   Re-run the “Scrape & deploy” workflow once (Actions tab) if the first push ran before this was set.
   Site URL: `https://<you>.github.io/ipo-watch/`
3. **WhatsApp recipients** → see below. Then Actions → *WhatsApp 10 AM summary* → *Run workflow* (dry run ticked) to preview the message, untick to send a real one.

From then on every `git push` to `main` redeploys automatically, and data refreshes every 2 hours.

## WhatsApp setup

Phone numbers and keys live in **GitHub secrets**, never in the repo (Pages repos are usually public).

### Option A — CallMeBot (free, simplest; good for personal use)
Each recipient activates once from their own phone:
1. Get the bot's current number from [callmebot.com](https://www.callmebot.com/blog/free-api-whatsapp-messages/) and save it as a contact (the page hides the number when the free bot is full; check back, or use Option B/C).
2. Send it the WhatsApp message `I allow callmebot to send me messages`.
3. You receive an **API key** back.

Add repo secret `WHATSAPP_RECIPIENTS` (Settings → Secrets and variables → Actions → New repository secret):
```
919953573400:APIKEY_1,91XXXXXXXXXX:APIKEY_2
```
To add the second number later, edit the secret and append `,<number>:<apikey>` — no code change.

### Option B — Meta WhatsApp Cloud API (official, for business use)
Set repo **variable** `WHATSAPP_PROVIDER=meta`, secrets `META_TOKEN` (permanent system-user token), `META_PHONE_NUMBER_ID`, and `WHATSAPP_RECIPIENTS=919953573400,91XXXXXXXXXX`.
Business-initiated messages need an approved template: create a utility template with one body variable `{{1}}` and set variable `META_TEMPLATE=<template_name>` (the summary is flattened to one line because template variables can't contain newlines).

### Option C — Twilio
`WHATSAPP_PROVIDER=twilio`, secrets `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (your WhatsApp-enabled number), `WHATSAPP_RECIPIENTS=919953573400,...`.

### Optional repo variables
| Variable | Default | Purpose |
|---|---|---|
| `SITE_URL` | `https://<owner>.github.io/<repo>/` | Link at the end of the message |
| `SEND_WHEN_EMPTY` | `true` | Set `false` to skip the message when nothing closes today |

## Local development
```bash
npm install
npm test            # parser + message unit tests
npm run scrape      # refresh public/data/ipos.json
npm run serve       # http://localhost:4173
npm run notify:dry  # print today's WhatsApp message
TODAY=2026-10-23 npm run notify:dry   # preview for another date
```

## Notes
- **Timing:** GitHub's scheduler can start jobs a few minutes late at busy times; the message usually lands between 10:00 and 10:15 IST.
- **Holidays:** update `nseHolidays<year>` in `config.json` each year (NSE publishes the list in December). Weekends and listed holidays are skipped for both "next working day" and the 10 AM message.
- **Resilience:** if ipowatch.in is unreachable, the deploy ships the last committed `data/ipos.json` (the page flags stale data), and the notifier falls back to that snapshot.
- **Inactivity:** GitHub disables scheduled workflows after 60 days without repo activity; re-enable from the Actions tab if that happens.
- **Source layout changes:** if ipowatch.in changes its tables, the scrape step fails with a clear message and `npm test` fixtures show what's expected.
- GMP is unofficial grey-market data. Not investment advice.
