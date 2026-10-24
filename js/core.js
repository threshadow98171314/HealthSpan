/* 核心：資料索引、格式化、狀態判讀、範圍條、迷你趨勢、對話框、主題 */
(() => {
  'use strict';

  const D = window.HEALTH_DATA;
  const A = window.HEALTH_ANALYSIS;
  const DEF = Object.fromEntries([...D.metricDefinitions, ...D.labDefinitions].map((d) => [d.key, d]));

  // ---------- 格式化 ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const decimals = (v) => (String(v).split('.')[1] || '').length;
  // 依報表列印位數顯示：至少 digits 位；原始值位數更多時保留（例如 SMI 10.17）
  const fmt = (v, digits = 1) => (v == null ? null : Number(v).toFixed(Math.max(decimals(v), digits)));
  const digitsOf = (key) => (DEF[key] && DEF[key].digits != null ? DEF[key].digits : 1);
  const fmtKey = (key, v) => fmt(v, digitsOf(key));
  const unitOf = (key) => (DEF[key] && DEF[key].unit) || '';
  const labelOf = (key) => (DEF[key] ? DEF[key].zh : key);
  const fmtNum = (n, d = 0) => Number(n).toLocaleString('zh-TW', { maximumFractionDigits: d, minimumFractionDigits: d });

  // ---------- 日期 ----------
  const pad2 = (n) => String(n).padStart(2, '0');
  const dateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const todayStr = () => dateStr(new Date());
  const parseDate = (s) => new Date(String(s).slice(0, 16).replace(' ', 'T') + (String(s).length <= 10 ? 'T00:00' : ''));
  const time = (s) => parseDate(s).getTime();
  const daysSince = (s) => Math.floor((Date.now() - time(String(s).slice(0, 10))) / 864e5);
  const fmtDate = (s) => String(s).slice(0, 10).replace(/-/g, '/');
  const md = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };

  function ago(s) {
    const n = daysSince(s);
    if (n <= 0) return '今天';
    if (n < 14) return `${n} 天前`;
    if (n < 60) return `${Math.round(n / 7)} 週前`;
    if (n < 365) return `${Math.round(n / 30.4)} 個月前`;
    return `${(n / 365).toFixed(1)} 年前`;
  }

  // 資料新鮮度：越舊的資料在整體評估中權重越低
  function freshness(s) {
    const n = daysSince(s);
    if (n <= 45) return { key: 'fresh', label: '最新' };
    if (n <= 180) return { key: 'recent', label: '近期' };
    if (n <= 365) return { key: 'old', label: '較舊' };
    return { key: 'stale', label: '過時' };
  }

  function ageOn(birth, date) {
    const [y, m, d] = birth.split('-').map(Number);
    let age = date.getFullYear() - y;
    if (date.getMonth() + 1 < m || (date.getMonth() + 1 === m && date.getDate() < d)) age--;
    return age;
  }

  // ---------- 狀態判讀 ----------
  const STATUS = {
    good: { label: '良好', icon: '✓' },
    fair: { label: '留意', icon: '•' },
    warn: { label: '警戒', icon: '▲' },
    bad: { label: '不佳', icon: '✕' },
    info: { label: '參考', icon: 'i' },
  };
  const RANK = { bad: 4, warn: 3, fair: 2, good: 1, info: 0 };

  function zoneOf(zones, v) {
    let s = zones[0];
    for (let i = 1; i < zones.length; i += 2) {
      if (v < zones[i]) return s;
      s = zones[i + 1];
    }
    return s;
  }

  function grade(key, value, ctx = {}) {
    const c = A.criteria[key];
    if (!c || value == null) return null;
    const v = c.relativeTo === 'age' ? value - ctx.age : value;
    return zoneOf(c.zones, v);
  }

  function gradeText(key, text) {
    if (A.pendingKeys.includes(key)) return 'info';
    return A.normalText.includes(text) ? 'good' : 'warn';
  }

  const chip = (s, label) => (s
    ? `<span class="chip s-${s}"><i aria-hidden="true">${STATUS[s].icon}</i>${esc(label || STATUS[s].label)}</span>`
    : '');

  const comment = (key) => (A.comments[key] ? `<div class="ai">${esc(A.comments[key])}</div>` : '');
  const sectionComment = (key) => (A.sections[key] ? `<div class="ai">${esc(A.sections[key])}</div>` : '');

  // 範圍條：依判讀標準畫出 良好／留意／警戒／不佳 色帶，三角形為本次數值，空心圓為前次
  function rangeBar(key, value, prev) {
    const c = A.criteria[key];
    if (!c || !c.scale || value == null) return '';
    const [lo, hi] = c.scale;
    const span = hi - lo;
    const segs = [];
    let from = -Infinity;
    for (let i = 0; i < c.zones.length; i += 2) {
      const to = i + 1 < c.zones.length ? c.zones[i + 1] : Infinity;
      const a = Math.max(from, lo);
      const b = Math.min(to, hi);
      if (b > a) segs.push(`<span class="s-${c.zones[i]}" style="width:${((b - a) / span) * 100}%"></span>`);
      from = to;
    }
    const pos = (v) => Math.min(100, Math.max(0, ((v - lo) / span) * 100));
    const d = digitsOf(key);
    return `<div class="rangebar" role="img" aria-label="${esc(labelOf(key))} ${esc(fmtKey(key, value))}，顯示區間 ${fmt(lo, 0)} 到 ${fmt(hi, 0)}">
      <div class="rb-track">${segs.join('')}</div>
      ${prev != null ? `<i class="rb-prev" style="left:${pos(prev)}%" title="前次 ${esc(fmtKey(key, prev))}"></i>` : ''}
      <i class="rb-mark" style="left:${pos(value)}%"></i>
      <div class="rb-scale"><span>${fmt(lo, d === 0 ? 0 : Math.min(d, 1))}</span><span>${fmt(hi, d === 0 ? 0 : Math.min(d, 1))}</span></div>
    </div>`;
  }

  // 迷你趨勢：points = [{ t, v, s }]
  function spark(points) {
    if (points.length < 2) return '';
    const W = 140, H = 40, P = 6;
    const ts = points.map((p) => p.t), vs = points.map((p) => p.v);
    const t0 = Math.min(...ts), t1 = Math.max(...ts), v0 = Math.min(...vs), v1 = Math.max(...vs);
    const x = (t) => (t1 === t0 ? W / 2 : P + ((t - t0) / (t1 - t0)) * (W - 2 * P));
    const y = (v) => (v1 === v0 ? H / 2 : P + (1 - (v - v0) / (v1 - v0)) * (H - 2 * P));
    const line = points.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const dots = points.map((p) => `<circle class="s-${p.s || 'info'}" cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3.5"></circle>`).join('');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${line}"></polyline>${dots}</svg>`;
  }

  // ---------- 資料組裝 ----------
  const bodyRecords = () => [...D.bodyComposition].sort((a, b) => time(a.datetime) - time(b.datetime));
  const checkups = () => [...D.checkups].sort((a, b) => a.date.localeCompare(b.date));

  function bodySeries(key, withCheckups) {
    const out = bodyRecords().filter((r) => r.metrics[key] != null).map((r) => ({
      date: r.datetime.slice(0, 10), t: time(r.datetime), v: r.metrics[key], s: grade(key, r.metrics[key], { age: r.ageAtTest }),
      source: `${r.location}・${r.brand}`, kind: 'body',
    }));
    if (withCheckups) {
      for (const c of checkups()) {
        for (const x of c.results) {
          if (x.key === key && x.value != null) out.push({ date: c.date, t: time(c.date), v: x.value, s: grade(key, x.value), source: `${c.location}・${c.kind}`, kind: 'checkup' });
        }
      }
    }
    return out.sort((a, b) => a.t - b.t);
  }

  function labSeries(key) {
    const out = [];
    for (const c of checkups()) {
      for (const x of c.results) if (x.key === key) out.push({ ...x, date: c.date, t: time(c.date), report: c });
    }
    return out;
  }

  // ---------- 介面工具 ----------
  const ICONS = {
    overview: '<path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z"/>',
    body: '<circle cx="12" cy="4.5" r="2.2"/><path d="M5 8.5h14M12 8.5v6M12 14.5l-3.5 6M12 14.5l3.5 6"/>',
    labs: '<path d="M12 3.5s6 6.6 6 10.6a6 6 0 0 1-12 0c0-4 6-10.6 6-10.6z"/>',
    training: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
    sleep: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    export: '<path d="M12 3.5v11M7.5 8l4.5-4.5L16.5 8M5 14.5v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  // 對話框：手機為全螢幕，桌面為置中視窗；dismissible=false 時點背景不會關閉（避免表單誤關）
  function openSheet({ title, body, foot = '', dismissible = true, onClose }) {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-backdrop';
    wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="關閉">${icon('x')}</button></div>
      <div class="sheet-body">${body}</div>
      ${foot ? `<div class="sheet-foot">${foot}</div>` : ''}
    </div>`;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    function close() {
      wrap.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      if (onClose) onClose();
    }
    wrap.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]') || (dismissible && e.target === wrap)) close();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';
    return { el: wrap.querySelector('.sheet'), close };
  }

  // ---------- 主題 ----------
  const THEME_KEY = 'healthspan:theme';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const storedTheme = () => { try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; } };
  function applyTheme() {
    document.documentElement.dataset.theme = storedTheme() || (media.matches ? 'dark' : 'light');
    document.dispatchEvent(new CustomEvent('hs:theme'));
  }
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* 無法儲存時只套用本次 */ }
    applyTheme();
  }
  media.addEventListener('change', () => { if (!storedTheme()) applyTheme(); });

  window.HS = {
    D, A, DEF, STATUS, RANK,
    esc, fmt, fmtKey, fmtNum, digitsOf, unitOf, labelOf, decimals,
    pad2, dateStr, todayStr, parseDate, time, daysSince, fmtDate, md, ago, freshness, ageOn,
    grade, gradeText, chip, comment, sectionComment, rangeBar, spark,
    bodyRecords, checkups, bodySeries, labSeries,
    icon, toast, openSheet, applyTheme, toggleTheme,
    views: {},
  };
})();
