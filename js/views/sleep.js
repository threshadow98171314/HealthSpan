/* 睡眠：手動紀錄（新增／編輯／刪除）、每晚時數、作息穩定度、自動分析 */
(() => {
  'use strict';

  const HS = window.HS;
  const { esc, chip, icon, fmtDate } = HS;
  const DAY = 864e5;
  const QUALITY = ['', '很差', '差', '普通', '好', '很好'];

  const toMin = (hhmm) => { const [h, m] = String(hhmm || '').split(':').map(Number); return h * 60 + m; };
  // 睡眠時數：起床 − 就寢，跨午夜自動加 24 小時
  const hoursOf = (e) => { let d = toMin(e.wake) - toMin(e.bedtime); if (d <= 0) d += 1440; return d / 60; };
  // 就寢時間換成「18:00 起算的分鐘數」，跨午夜也能比較
  const bedMin = (e) => (toMin(e.bedtime) - 18 * 60 + 1440) % 1440;
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const sd = (a) => { const m = avg(a); return a.length > 1 ? Math.sqrt(avg(a.map((x) => (x - m) ** 2))) : null; };

  function stats() {
    const list = HS.store.list('sleep').filter((e) => e.bedtime && e.wake);
    const now = Date.now();
    const last7 = list.filter((e) => (now - HS.time(e.date)) / DAY < 7);
    const avg7 = avg(last7.map(hoursOf));
    const spread = sd(last7.map(bedMin));
    return {
      list, total: list.length, last7,
      avg7, avgStatus: avg7 == null ? null : HS.grade('sleepHours', avg7),
      spread, spreadStatus: spread == null ? null : spread < 30 ? 'good' : spread < 60 ? 'fair' : 'warn',
      short7: last7.filter((e) => hoursOf(e) < 6).length,
      quality7: avg(last7.map((e) => e.quality).filter(Boolean)),
    };
  }
  HS.sleepStats = stats;

  function insights(st) {
    if (!st.total) return [];
    const out = [];
    if (st.avg7 != null) out.push({ s: st.avgStatus, text: `近 7 晚平均睡 ${st.avg7.toFixed(1)} 小時；建議 7–9 小時，減脂期睡不夠會讓肌肉更容易流失。` });
    if (st.spread != null) out.push({ s: st.spreadStatus, text: `就寢時間的變動約 ±${Math.round(st.spread)} 分鐘；固定在 30 分鐘內最利於恢復。` });
    if (st.short7) out.push({ s: st.short7 >= 3 ? 'warn' : 'fair', text: `近 7 晚有 ${st.short7} 晚睡不到 6 小時。` });
    if (st.quality7 != null) out.push({ s: st.quality7 >= 4 ? 'good' : st.quality7 >= 3 ? 'fair' : 'warn', text: `自評睡眠品質平均 ${st.quality7.toFixed(1)} / 5。` });
    return out;
  }

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
    const s = HS.grade('sleepHours', h);
    return `<div class="card log-item">
      <div class="log-head">
        <div>
          <h3><span class="num">${h.toFixed(1)}</span> 小時 ${chip(s)}</h3>
          <div class="log-meta">${esc(fmtDate(e.date))}・${esc(e.bedtime)} → ${esc(e.wake)}${e.quality ? `・品質 ${e.quality}/5` : ''}${e.awakenings != null ? `・夜醒 ${e.awakenings} 次` : ''}</div>
        </div>
        ${e.readonly ? '' : `<div class="btn-row">
          <button type="button" class="btn small" data-act="edit" data-id="${esc(e.id)}">${icon('edit')}編輯</button>
          <button type="button" class="btn small danger" data-act="delete" data-id="${esc(e.id)}">${icon('trash')}刪除</button>
        </div>`}
      </div>
      ${e.notes ? `<div class="log-body">${esc(e.notes)}</div>` : ''}
    </div>`;
  }

  const PLAN = [
    ['每晚睡眠時數', '長條圖顯示每晚時數，背景色帶標出 7–9 小時的良好區間，並計算 7 日平均。'],
    ['作息穩定度', '就寢與起床時間的變動幅度；固定作息有助恢復與減脂。'],
    ['主觀品質與夜醒', '自評 1–5 分與夜醒次數，找出影響睡眠的因素（咖啡因、晚間訓練）。'],
    ['穿戴裝置數據（規劃中）', '若有手錶或手環，可匯入深睡／REM 比例、靜止心率、HRV。'],
  ];

  HS.views.sleep = {
    title: '睡眠',
    render(root) {
      const st = stats();
      const ins = insights(st);
      const recent = st.list.slice(0, 14).reverse();
      root.innerHTML = `
        <header class="page-head">
          <div><h1>睡眠</h1><div class="sub">${st.total ? `共 ${st.total} 晚紀錄` : '尚無紀錄'}</div></div>
          <button type="button" class="btn primary desktop-only" data-act="new">${icon('plus')}記錄睡眠</button>
        </header>

        <section class="card hero">
          ${HS.sectionComment('sleep')}
          ${ins.length ? `<ul class="mini-list" style="margin-top:14px">${ins.map((i) => `<li style="justify-content:flex-start;align-items:flex-start">${chip(i.s)}<span style="color:var(--ink)">${esc(i.text)}</span></li>`).join('')}</ul>` : ''}
        </section>

        ${st.total ? `<section class="section card">
          <div class="card-head"><h3>每晚睡眠時數</h3><span class="muted">最近 ${recent.length} 晚，目標 7–9 小時</span></div>
          <div class="chart"><canvas id="sl-hours" role="img" aria-label="每晚睡眠時數長條圖，數值見下方紀錄"></canvas></div>
        </section>` : `<section class="section">
          <div class="section-head"><h2>會呈現的內容</h2></div>
          <div class="grid g2">${PLAN.map(([t, d]) => `<div class="card"><h3>${esc(t)}</h3><p class="muted" style="margin:6px 0 0;font-size:14px">${esc(d)}</p></div>`).join('')}</div>
        </section>`}

        <section class="section">
          <div class="section-head"><h2>紀錄</h2></div>
          ${st.total ? `<div class="log">${st.list.map(entryRow).join('')}</div>` : `<div class="card empty">
            <h3>還沒有睡眠紀錄</h3>
            <p>每天起床後花 10 秒記下就寢與起床時間，累積 2 週就能評估睡眠時數與作息穩定度。</p>
            <button type="button" class="btn primary" data-act="new">${icon('plus')}記錄第一晚</button>
          </div>`}
        </section>

        <button type="button" class="fab" data-act="new">${icon('plus')}記錄睡眠</button>`;

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

      if (!HS.charts.ok || !st.total) return;
      HS.charts.bars(root.querySelector('#sl-hours'), {
        labels: recent.map((e) => HS.md(HS.time(e.date))),
        values: recent.map((e) => Math.round(hoursOf(e) * 10) / 10),
        statuses: recent.map((e) => HS.grade('sleepHours', hoursOf(e))),
        zones: HS.A.criteria.sleepHours.zones,
        format: (v) => `${v} 小時`,
      });
    },
  };

  HS.sleep = { hoursOf, open };
})();
