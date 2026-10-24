/* 睡眠：Apple Watch 自動匯入（睡眠分期、靜止心率、HRV）＋手動紀錄（新增／編輯／刪除） */
(() => {
  'use strict';

  const HS = window.HS;
  const { esc, chip, icon, fmtDate } = HS;
  const DAY = 864e5;
  const QUALITY = ['', '很差', '差', '普通', '好', '很好'];

  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const sd = (a) => { const m = avg(a); return a.length > 1 ? Math.sqrt(avg(a.map((x) => (x - m) ** 2))) : null; };
  const ageDays = (date) => (Date.now() - HS.time(date)) / DAY;
  const one = (v) => (v == null ? '—' : v.toFixed(1));
  const spreadStatus = (v) => (v == null ? null : v < 30 ? 'good' : v < 60 ? 'fair' : 'warn');

  // ---------- 手動紀錄 ----------
  const toMin = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return h * 60 + m; };
  // 睡眠時數：起床 − 就寢，跨午夜自動加 24 小時
  const hoursOf = (e) => { let d = toMin(e.wake) - toMin(e.bedtime); if (d <= 0) d += 1440; return d / 60; };
  // 就寢時間換成「18:00 起算的分鐘數」，跨午夜也能比較
  const fromSix = (minutes) => (minutes - 18 * 60 + 1440) % 1440;

  function manualStats() {
    const list = HS.store.list('sleep').filter((e) => e.bedtime && e.wake);
    const last7 = list.filter((e) => ageDays(e.date) < 7);
    const avg7 = avg(last7.map(hoursOf));
    return {
      list, total: list.length, avg7,
      avgStatus: avg7 == null ? null : HS.grade('sleepHours', avg7),
      spread: sd(last7.map((e) => fromSix(toMin(e.bedtime)))),
      short7: last7.filter((e) => hoursOf(e) < 6).length,
      quality7: avg(last7.map((e) => e.quality).filter(Boolean)),
    };
  }

  // ---------- Apple Watch ----------
  const clock = (iso) => { const d = new Date(iso); return `${HS.pad2(d.getHours())}:${HS.pad2(d.getMinutes())}`; };
  const pct = (part, whole) => (whole ? (part / whole) * 100 : null);

  function watchStats() {
    const h = HS.health ? HS.health.data() : null;
    const nights = h ? h.nights.slice().sort((a, b) => a.date.localeCompare(b.date)) : [];
    const last7 = nights.filter((n) => ageDays(n.date) < 7);
    const staged7 = last7.filter((n) => n.staged);
    const between = (list, field, days) => avg(list.filter((x) => ageDays(x.date) < days).map((x) => x[field]));
    const rhr = h ? h.restingHR : [];
    const hrv = h ? h.hrv : [];
    const s = {
      h, nights, last7,
      avgH: avg(last7.map((n) => n.asleepMin / 60)),
      deep: avg(staged7.map((n) => pct(n.deepMin, n.asleepMin))),
      rem: avg(staged7.map((n) => pct(n.remMin, n.asleepMin))),
      spread: sd(last7.map((n) => { const d = new Date(n.start); return fromSix(d.getHours() * 60 + d.getMinutes()); })),
      short7: last7.filter((n) => n.asleepMin < 360).length,
      rhr, hrv,
      rhr7: between(rhr, 'bpm', 7), rhr30: between(rhr, 'bpm', 30),
      hrv7: between(hrv, 'ms', 7), hrv30: between(hrv, 'ms', 30),
    };
    s.avgStatus = s.avgH == null ? null : HS.grade('sleepHours', s.avgH);
    s.deepStatus = s.deep == null ? null : HS.grade('sleepDeepPct', s.deep);
    s.remStatus = s.rem == null ? null : HS.grade('sleepRemPct', s.rem);
    s.spreadStatus = spreadStatus(s.spread);
    s.rhrStatus = s.rhr7 == null ? null : HS.grade('restingHR', s.rhr7);
    // HRV 因人而異，看的是和自己 30 天平均相比
    s.hrvStatus = s.hrv7 == null || s.hrv30 == null ? null : s.hrv7 >= s.hrv30 * 0.9 ? 'good' : s.hrv7 >= s.hrv30 * 0.8 ? 'fair' : 'warn';
    return s;
  }

  // 總覽頁使用：有 Apple Watch 數據時以手錶為準
  HS.sleepStats = () => {
    const w = watchStats();
    if (w.nights.length) return { total: w.nights.length, avg7: w.avgH, avgStatus: w.avgStatus };
    const m = manualStats();
    return { total: m.total, avg7: m.avg7, avgStatus: m.avgStatus };
  };

  function watchInsights(w) {
    const out = [];
    if (w.avgH != null) out.push({ s: w.avgStatus, text: `近 7 晚平均睡 ${one(w.avgH)} 小時；建議 7–9 小時，減脂期睡不夠會讓肌肉更容易流失。` });
    if (w.short7) out.push({ s: w.short7 >= 3 ? 'warn' : 'fair', text: `近 7 晚有 ${w.short7} 晚睡不到 6 小時。` });
    if (w.deep != null) out.push({ s: w.deepStatus, text: `深層睡眠約佔 ${one(w.deep)}%（一般成人約 13–23%）。手錶的分期是估計值，看長期趨勢比單晚準確。` });
    if (w.rem != null) out.push({ s: w.remStatus, text: `快速動眼期約佔 ${one(w.rem)}%（一般約 20–25%）。` });
    if (w.spread != null) out.push({ s: w.spreadStatus, text: `入睡時間的變動約 ±${Math.round(w.spread)} 分鐘；固定在 30 分鐘內最利於恢復。` });
    if (w.rhr7 != null) {
      const up = w.rhr30 != null && w.rhr7 > w.rhr30 + 3;
      out.push({ s: up ? 'fair' : w.rhrStatus, text: `靜止心率 7 日平均 ${one(w.rhr7)} 次／分${w.rhr30 != null ? `（30 日平均 ${one(w.rhr30)}）` : ''}。${up ? '比平常高，可能是疲勞、睡眠不足、生病或訓練量過大的訊號。' : ''}` });
    }
    if (w.hrv7 != null) {
      out.push({ s: w.hrvStatus, text: `HRV 7 日平均 ${one(w.hrv7)} ms${w.hrv30 != null ? `（30 日平均 ${one(w.hrv30)}）` : ''}。${w.hrvStatus === 'good' ? '恢復狀況穩定。' : '比平常低，代表恢復不足，可以減少高強度訓練、早點睡。'}` });
    }
    return out;
  }

  function manualInsights(m) {
    const out = [];
    if (m.avg7 != null) out.push({ s: m.avgStatus, text: `近 7 晚平均睡 ${one(m.avg7)} 小時（手動紀錄）；建議 7–9 小時。` });
    if (m.spread != null) out.push({ s: spreadStatus(m.spread), text: `就寢時間的變動約 ±${Math.round(m.spread)} 分鐘；固定在 30 分鐘內最利於恢復。` });
    if (m.short7) out.push({ s: m.short7 >= 3 ? 'warn' : 'fair', text: `近 7 晚有 ${m.short7} 晚睡不到 6 小時。` });
    if (m.quality7 != null) out.push({ s: m.quality7 >= 4 ? 'good' : m.quality7 >= 3 ? 'fair' : 'warn', text: `自評睡眠品質平均 ${one(m.quality7)} / 5。` });
    return out;
  }

  const tile = (label, value, unit, s, meta) => `<div class="card metric">
    <div class="metric-top"><span class="metric-name">${esc(label)}</span>${chip(s)}</div>
    <div class="metric-value"><b class="num">${esc(value)}</b><span class="unit">${esc(unit)}</span></div>
    ${meta ? `<div class="metric-meta">${esc(meta)}</div>` : ''}
  </div>`;

  function watchSection(w) {
    const st = HS.health ? HS.health.status() : { busy: false, error: '' };
    const h = w.h;
    const notes = [st.error, ...((h && h.problems) || [])].filter(Boolean).map((t) => `<p class="gate-err" style="margin:0 0 10px">${esc(t)}</p>`).join('');
    const last = h && h.lastImport ? `最後匯入 ${fmtDate(h.lastImport.at.slice(0, 10))} ${clock(h.lastImport.at)}` : '尚未匯入';
    const head = `<div class="section-head"><h2>Apple Watch</h2><span class="sub">${st.busy ? '正在整理匯入檔…' : esc(last)}${w.nights.length ? `・共 ${w.nights.length} 晚` : ''}</span></div>`;
    if (!w.nights.length) {
      return `<section class="section">${head}${notes}<div class="card empty">
        <h3>還沒有 Apple Watch 數據</h3>
        <p>在 iPhone 設定好「HealthSpan 睡眠上傳」捷徑後，每天早上會自動上傳昨晚的睡眠、靜止心率與 HRV；打開這個網站時會自動整理進來。</p>
      </div></section>`;
    }
    const recent = w.nights.slice(-30).reverse();
    const rows = recent.map((n) => {
      const s = HS.grade('sleepHours', n.asleepMin / 60);
      const m = (v) => (n.staged ? `${(v / 60).toFixed(1)}` : '—');
      return `<tr><th scope="row">${esc(fmtDate(n.date))}</th><td>${clock(n.start)}</td><td>${clock(n.end)}</td>
        <td>${(n.asleepMin / 60).toFixed(1)} ${chip(s)}</td><td>${m(n.deepMin)}</td><td>${m(n.coreMin)}</td><td>${m(n.remMin)}</td><td>${(n.awakeMin / 60).toFixed(1)}</td></tr>`;
    }).join('');
    return `<section class="section">
      ${head}${notes}
      <div class="grid g3">
        ${tile('近 7 晚平均睡眠', one(w.avgH), '小時', w.avgStatus, '目標 7–9 小時')}
        ${tile('深層睡眠比例', one(w.deep), '%', w.deepStatus, '一般成人約 13–23%')}
        ${tile('快速動眼期比例', one(w.rem), '%', w.remStatus, '一般約 20–25%')}
        ${tile('入睡時間穩定度', w.spread == null ? '—' : `±${Math.round(w.spread)}`, '分鐘', w.spreadStatus, '近 7 晚的變動，越小越好')}
        ${tile('靜止心率（7 日平均）', one(w.rhr7), '次/分', w.rhrStatus, w.rhr30 != null ? `30 日平均 ${one(w.rhr30)}` : '')}
        ${tile('HRV（7 日平均）', one(w.hrv7), 'ms', w.hrvStatus, w.hrv30 != null ? `30 日平均 ${one(w.hrv30)}，和自己比較` : '')}
      </div>
      <div class="card" style="margin-top:14px">
        <div class="card-head"><h3>每晚睡眠分期</h3><span class="muted">最近 ${Math.min(14, w.nights.length)} 晚，單位小時；背景綠色帶為 7–9 小時</span></div>
        <div class="chart tall"><canvas id="aw-stages" role="img" aria-label="每晚睡眠分期堆疊長條圖，數值見下方每晚明細"></canvas></div>
      </div>
      <div class="grid g2" style="margin-top:14px">
        <div class="card"><h3>靜止心率</h3><div class="chart short"><canvas id="aw-rhr" role="img" aria-label="靜止心率趨勢"></canvas></div></div>
        <div class="card"><h3>HRV（心率變異性）</h3><div class="chart short"><canvas id="aw-hrv" role="img" aria-label="HRV 趨勢"></canvas></div></div>
      </div>
      <details class="card" style="margin-top:14px"><summary>每晚明細（最近 30 晚）</summary>
        <div class="table-wrap"><table>
          <thead><tr><th scope="col">日期（起床）</th><th scope="col">入睡</th><th scope="col">起床</th><th scope="col">睡眠 小時</th><th scope="col">深層</th><th scope="col">核心</th><th scope="col">快速動眼</th><th scope="col">清醒</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </details>
    </section>`;
  }

  // ---------- 手動紀錄表單 ----------
  function formBody(e) {
    return `<form novalidate class="form-grid">
      <label class="field full"><span>日期（起床當天）</span><input type="date" name="date" value="${esc(e.date)}"></label>
      <label class="field"><span>就寢時間</span><input type="time" name="bedtime" value="${esc(e.bedtime)}"></label>
      <label class="field"><span>起床時間</span><input type="time" name="wake" value="${esc(e.wake)}"></label>
      <label class="field"><span>睡眠品質</span><select name="quality">${QUALITY.map((q, i) => `<option value="${i || ''}"${Number(e.quality) === i && i ? ' selected' : ''}>${i ? `${i}・${q}` : '未填'}</option>`).join('')}</select></label>
      <label class="field"><span>夜醒次數</span><input type="number" min="0" inputmode="numeric" name="awakenings" value="${e.awakenings ?? ''}"></label>
      <label class="field full"><span>備註</span><textarea name="notes" placeholder="咖啡因、壓力、運動時間等">${esc(e.notes || '')}</textarea></label>
    </form>`;
  }

  function open(id) {
    const editing = id ? HS.store.get('sleep', id) : null;
    const e = editing ? { ...editing } : { date: HS.todayStr(), bedtime: '23:30', wake: '07:00', quality: '', awakenings: null, notes: '' };
    const sheet = HS.openSheet({
      title: editing ? '編輯睡眠紀錄' : '記錄睡眠',
      body: formBody(e),
      dismissible: false,
      foot: '<button type="button" class="btn" data-close>取消</button><button type="button" class="btn primary" data-act="save">儲存</button>',
    });
    sheet.el.querySelector('[data-act="save"]').addEventListener('click', () => {
      const f = sheet.el.querySelector('form');
      const v = (n) => f.elements[n].value;
      const rec = {
        ...e, date: v('date'), bedtime: v('bedtime'), wake: v('wake'),
        quality: v('quality') ? Number(v('quality')) : null,
        awakenings: v('awakenings') === '' ? null : Number(v('awakenings')),
        notes: v('notes').trim(),
      };
      if (!rec.date || !rec.bedtime || !rec.wake) { HS.toast('請填日期、就寢與起床時間'); return; }
      if (!HS.store.save('sleep', rec)) return;
      sheet.close();
      HS.toast(editing ? '已更新睡眠紀錄' : '已儲存睡眠紀錄');
    });
  }

  function entryRow(e) {
    const h = hoursOf(e);
    return `<div class="card log-item">
      <div class="log-head">
        <div>
          <h3><span class="num">${h.toFixed(1)}</span> 小時 ${chip(HS.grade('sleepHours', h))}</h3>
          <div class="log-meta">${esc(fmtDate(e.date))}・${esc(e.bedtime)} → ${esc(e.wake)}${e.quality ? `・品質 ${e.quality}/5` : ''}${e.awakenings != null ? `・夜醒 ${e.awakenings} 次` : ''}</div>
        </div>
        <div class="btn-row">
          <button type="button" class="btn small" data-act="edit" data-id="${esc(e.id)}">${icon('edit')}編輯</button>
          <button type="button" class="btn small danger" data-act="delete" data-id="${esc(e.id)}">${icon('trash')}刪除</button>
        </div>
      </div>
      ${e.notes ? `<div class="log-body">${esc(e.notes)}</div>` : ''}
    </div>`;
  }

  HS.views.sleep = {
    title: '睡眠',
    render(root) {
      const w = watchStats();
      const m = manualStats();
      const ins = w.nights.length ? watchInsights(w) : manualInsights(m);
      root.innerHTML = `
        <header class="page-head">
          <div><h1>睡眠</h1><div class="sub">${w.nights.length ? `Apple Watch ${w.nights.length} 晚` : 'Apple Watch 尚未匯入'}・手動紀錄 ${m.total} 晚</div></div>
          <button type="button" class="btn primary desktop-only" data-act="new">${icon('plus')}手動記錄</button>
        </header>

        <section class="card hero">
          ${HS.sectionComment('sleep')}
          ${ins.length ? `<ul class="mini-list" style="margin-top:14px">${ins.map((i) => `<li style="justify-content:flex-start;align-items:flex-start">${chip(i.s)}<span style="color:var(--ink)">${esc(i.text)}</span></li>`).join('')}</ul>` : ''}
        </section>

        ${watchSection(w)}

        <section class="section">
          <div class="section-head"><h2>手動紀錄</h2><span class="sub">沒有戴錶的晚上可以手動補記</span></div>
          ${m.total ? `<div class="log">${m.list.map(entryRow).join('')}</div>` : `<div class="card empty">
            <h3>沒有手動紀錄</h3>
            <p>有 Apple Watch 自動匯入就不需要手動記錄；沒戴錶的晚上可以在這裡補記。</p>
            <button type="button" class="btn" data-act="new">${icon('plus')}手動記錄一晚</button>
          </div>`}
        </section>

        <button type="button" class="fab" data-act="new">${icon('plus')}手動記錄</button>`;

      root.onclick = (ev) => {
        const b = ev.target.closest('[data-act]');
        if (!b) return;
        if (b.dataset.act === 'new') open();
        if (b.dataset.act === 'edit') open(b.dataset.id);
        if (b.dataset.act === 'delete') {
          const e = HS.store.get('sleep', b.dataset.id);
          if (e && window.confirm(`刪除 ${fmtDate(e.date)} 的睡眠紀錄？刪除後無法復原。`)) {
            HS.store.remove('sleep', e.id);
            HS.toast('已刪除');
          }
        }
      };

      if (!HS.charts.ok || !w.nights.length) return;
      const last = w.nights.slice(-14);
      const hrs = (v) => Math.round((v / 60) * 10) / 10;
      const sets = [
        { label: '深層', color: '--series', data: last.map((n) => hrs(n.deepMin)) },
        { label: '核心', color: '--series-3', data: last.map((n) => hrs(n.coreMin)) },
        { label: '快速動眼', color: '--series-2', data: last.map((n) => hrs(n.remMin)) },
      ];
      if (last.some((n) => !n.staged)) sets.push({ label: '未分期', color: '--info', data: last.map((n) => (n.staged ? 0 : hrs(n.asleepMin))) });
      sets.push({ label: '清醒', color: '--ink-3', data: last.map((n) => hrs(n.awakeMin)) });
      HS.charts.stack(root.querySelector('#aw-stages'), { labels: last.map((n) => HS.md(HS.time(n.date))), sets, zones: HS.A.criteria.sleepHours.zones, unit: '小時' });
      const crit = HS.A.criteria.restingHR;
      HS.charts.trend(root.querySelector('#aw-rhr'), {
        key: 'restingHR', label: '靜止心率', unit: '次/分', zones: crit ? crit.zones : null,
        points: w.rhr.slice(-30).map((x) => ({ t: HS.time(x.date), v: x.bpm, s: HS.grade('restingHR', x.bpm), date: x.date, source: 'Apple Watch' })),
      });
      HS.charts.trend(root.querySelector('#aw-hrv'), {
        key: 'hrv', label: 'HRV', unit: 'ms',
        points: w.hrv.slice(-30).map((x) => ({ t: HS.time(x.date), v: x.ms, date: x.date, source: 'Apple Watch' })),
      });
    },
  };

  HS.sleep = { hoursOf, open };
})();
