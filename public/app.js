(() => {
  'use strict';

  const TZ = 'Asia/Kolkata';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const state = { data: null, tab: 'today', seg: 'all', today: null, next: null };

  try {
    const saved = JSON.parse(localStorage.getItem('gmpwatch:prefs') || '{}');
    if (saved.seg) state.seg = saved.seg;
  } catch { /* storage unavailable */ }

  // ---------- date helpers (IST, ISO strings) ----------
  const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const fmt = (iso, o = { weekday: 'short', day: 'numeric', month: 'short' }) =>
    iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { ...o, timeZone: 'UTC' }) : '—';
  function nextWorkingDay(iso, holidays) {
    let d = addDays(iso, 1);
    for (let i = 0; i < 15; i++) {
      const dow = new Date(d + 'T00:00:00Z').getUTCDay();
      if (dow !== 0 && dow !== 6 && !holidays.has(d)) return d;
      d = addDays(d, 1);
    }
    return d;
  }

  // ---------- formatting ----------
  const inr = (n) => (n == null ? '—' : (n < 0 ? '-₹' : '₹') + Math.abs(n).toLocaleString('en-IN'));
  const pct = (n) => (n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(2) + '%');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function trendOf(ipo) {
    if (ipo.trend) return ipo.trend; // ipowatch's own signal
    const h = ipo.history || [];
    if (h.length >= 2 && h[0].gmp != null && h[1].gmp != null) {
      if (h[0].gmp > h[1].gmp) return 'up';
      if (h[0].gmp < h[1].gmp) return 'down';
      return 'flat';
    }
    return 'flat';
  }

  // ---------- sparkline ----------
  function sparkline(history) {
    const pts = (history || []).filter((h) => h.gmp != null).slice().reverse(); // oldest → newest
    if (pts.length < 2) return '<div class="empty">Not enough GMP history yet.</div>';
    const W = 300, H = 72, P = 6;
    const vals = pts.map((p) => p.gmp);
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = max - min || 1;
    const x = (i) => P + (i * (W - 2 * P)) / (pts.length - 1);
    const y = (v) => H - P - ((v - min) / span) * (H - 2 * P);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.gmp).toFixed(1)}`).join('');
    const area = `${line}L${x(pts.length - 1).toFixed(1)},${H}L${x(0).toFixed(1)},${H}Z`;
    const up = vals.at(-1) >= vals[0];
    const color = up ? 'var(--up)' : 'var(--down)';
    const id = 'g' + Math.random().toString(36).slice(2, 8);
    const lx = x(pts.length - 1), ly = y(vals.at(-1));
    return `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="GMP from ${inr(vals[0])} to ${inr(vals.at(-1))} over ${pts.length} days">
        <defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
        </linearGradient></defs>
        <path d="${area}" fill="url(#${id})"/>
        <path d="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${lx}" cy="${ly}" r="3.5" fill="${color}" vector-effect="non-scaling-stroke"/>
      </svg>
      <div class="axis"><span>${fmt(pts[0].date, { day: 'numeric', month: 'short' })}</span><span>low ${inr(min)} · high ${inr(max)}</span><span>${fmt(pts.at(-1).date, { day: 'numeric', month: 'short' })}</span></div>`;
  }

  // ---------- card ----------
  const tpl = $('#card-tpl');
  function card(ipo) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    $('.name', node).textContent = ipo.name;
    $('.seg', node).textContent = ipo.segment;
    const st = $('.status', node);
    if (ipo.close === state.today) { st.textContent = 'Closes today'; st.classList.add('closing'); }
    else if (ipo.close === state.next) { st.textContent = 'Closes ' + fmt(ipo.close, { weekday: 'short' }); st.classList.add('closing'); }
    else { st.textContent = ipo.status || '—'; st.classList.add((ipo.status || '').toLowerCase()); }

    const t = trendOf(ipo);
    const g = $('.gmp-val', node);
    g.classList.add(t);
    g.innerHTML = `${esc(inr(ipo.gmp))}<span class="arrow" aria-hidden="true">${t === 'up' ? '▲' : t === 'down' ? '▼' : '•'}</span>`;

    const gain = $('.gain', node);
    gain.textContent = pct(ipo.estGainPct);
    if (ipo.estGainPct > 0) gain.classList.add('pos'); else if (ipo.estGainPct < 0) gain.classList.add('neg');
    $('.est', node).innerHTML = `Est. listing <span class="num">${esc(inr(ipo.estListing))}</span> on <span class="num">${esc(inr(ipo.price))}</span>`;

    $('.spark', node).innerHTML = sparkline(ipo.history);

    const d = ipo.details || {};
    const facts = [
      ['Open', fmt(ipo.open)],
      ['Close', fmt(ipo.close)],
      ['Price band', d.priceBand?.replace(/ Per Share/i, '')],
      ['Listing', ipo.listingDate ? fmt(ipo.listingDate) : d.listingAt],
      ['Issue size', (d.issueSize?.match(/₹\s*[\d,.]+\s*(?:Crores?|Cr|Lakhs?)/i) || [d.issueSize?.replace(/^Approx\s*/i, '')])[0]],
      ['Allotment', ipo.allotmentDate ? fmt(ipo.allotmentDate) : null],
    ].filter(([, v]) => v && !/\[\.\]/.test(v));
    $('.facts', node).innerHTML = facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');

    const hist = ipo.history || [];
    $('.hist-count', node).textContent = hist.length ? `${hist.length} day${hist.length > 1 ? 's' : ''}` : 'none';
    $('.hist tbody', node).innerHTML = hist.map((h, i) => {
      const prev = hist[i + 1]?.gmp;
      const delta = h.gmp != null && prev != null ? h.gmp - prev : null;
      const cls = delta > 0 ? 'd-up' : delta < 0 ? 'd-down' : 'd-flat';
      const dtxt = delta == null ? '—' : delta === 0 ? '0' : (delta > 0 ? '+' : '') + delta;
      return `<tr><td>${esc(fmt(h.date))}${h.updated ? ` <small style="color:var(--ink-3)">${esc(h.updated)}</small>` : ''}</td><td>${esc(inr(h.gmp))}</td><td class="${cls}">${dtxt}</td><td>${h.gainPct == null ? '—' : esc(h.gainPct.toFixed(2) + '%')}</td></tr>`;
    }).join('');
    if (!hist.length) $('.hist', node).remove();

    const a = $('.src', node);
    if (ipo.url) a.href = ipo.url; else a.remove();
    return node;
  }

  // ---------- render ----------
  function filtered() {
    const all = state.data?.ipos || [];
    return state.seg === 'all' ? all : all.filter((i) => i.segment === state.seg);
  }
  function groups() {
    const list = filtered();
    const byGain = (a, b) => (b.estGainPct ?? -1e9) - (a.estGainPct ?? -1e9);
    return {
      today: list.filter((i) => i.close === state.today).sort(byGain),
      next: list.filter((i) => i.close === state.next).sort(byGain),
      all: list,
    };
  }

  function render() {
    if (!state.data) return;
    const g = groups();
    for (const k of ['today', 'next', 'all']) $(`[data-count="${k}"]`).textContent = g[k].length;
    $('[data-label="next"]').textContent = fmt(state.next, { weekday: 'short', day: 'numeric' });

    $$('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
    $$('.chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.seg === state.seg)));

    const titles = {
      today: `Closing today · ${fmt(state.today)}`,
      next: `Closing next working day · ${fmt(state.next)}`,
      all: 'All tracked IPOs · by close date',
    };
    $('#section-title').textContent = titles[state.tab];

    const list = $('#list');
    list.innerHTML = '';
    const items = g[state.tab];
    list.classList.toggle('grid-2', items.length > 1);

    if (!items.length) {
      const upcoming = filtered().filter((i) => i.close && i.close > state.today).sort((a, b) => a.close.localeCompare(b.close));
      const nextClose = upcoming[0]?.close;
      const n = upcoming.filter((i) => i.close === nextClose).length;
      list.classList.remove('grid-2');
      list.innerHTML = `<div class="empty-state"><strong>No IPOs ${state.tab === 'today' ? 'close today' : 'close on ' + esc(fmt(state.next))}</strong>
        ${nextClose ? `Next close: ${esc(fmt(nextClose))} · ${n} IPO${n > 1 ? 's' : ''}<br><button type="button" data-goto="all">See all IPOs</button>` : 'Nothing scheduled right now.'}</div>`;
      return;
    }
    const frag = document.createDocumentFragment();
    items.forEach((ipo) => frag.appendChild(card(ipo)));
    list.appendChild(frag);
  }

  function setUpdated() {
    const d = state.data;
    const el = $('#updated');
    const when = new Date(d.generatedAt);
    const ageH = (Date.now() - when.getTime()) / 36e5;
    const txt = when.toLocaleString('en-IN', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    el.innerHTML = `<span class="dot"></span>Updated ${esc(txt)} IST`;
    el.classList.toggle('stale', ageH > 6);
    const notice = $('#notice');
    if (ageH > 26) {
      notice.hidden = false;
      notice.textContent = `Data is ${Math.round(ageH)} hours old. The source may be unreachable; GMP shown may be outdated.`;
    } else notice.hidden = true;
  }

  async function load(manual = false) {
    const btn = $('#refresh');
    btn.classList.add('spin');
    try {
      const res = await fetch(`data/ipos.json?t=${Math.floor(Date.now() / 300000)}`, { cache: manual ? 'reload' : 'default' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      state.data = await res.json();
      state.today = istToday();
      state.next = nextWorkingDay(state.today, new Set(state.data.holidays || []));
      setUpdated();
      render();
    } catch (err) {
      $('#list').innerHTML = `<div class="empty-state"><strong>Couldn't load GMP data</strong>${esc(err.message)}<br><button type="button" id="retry">Try again</button></div>`;
    } finally {
      btn.classList.remove('spin');
    }
  }

  // ---------- events ----------
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) { state.tab = tab.dataset.tab; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    const chip = e.target.closest('.chip');
    if (chip) {
      state.seg = chip.dataset.seg;
      try { localStorage.setItem('gmpwatch:prefs', JSON.stringify({ seg: state.seg })); } catch { /* ignore */ }
      render(); return;
    }
    const go = e.target.closest('[data-goto]');
    if (go) { state.tab = go.dataset.goto; render(); return; }
    if (e.target.closest('#refresh') || e.target.closest('#retry')) load(true);
  });

  // Auto-select the most useful tab on first load
  load().then(() => {
    if (!state.data) return;
    const g = groups();
    if (!g.today.length && g.next.length) { state.tab = 'next'; render(); }
  });
})();
