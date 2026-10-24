/* 訓練：紀錄列表（編輯／刪除）、每週頻率、各肌群組數、主要動作進步、自動分析 */
(() => {
  'use strict';

  const HS = window.HS;
  const { esc, chip, icon, fmtDate, fmtNum } = HS;
  const DAY = 864e5;
  const MAJOR = ['chest', 'back', 'shoulders', 'quads', 'hamstrings', 'glutes', 'biceps', 'triceps'];
  const WEEKDAY = '日一二三四五六';
  const M = () => HS.training.MUSCLES;

  const isCardio = (ex) => ex.muscle === 'cardio';
  // Epley 公式估計 1RM，只採 12 下以內的組
  const e1rm = (kg, reps) => (kg > 0 && reps > 0 && reps <= 12 ? kg * (1 + reps / 30) : 0);

  function summary(s) {
    const out = { sets: 0, volume: 0, cardioMin: 0, byMuscle: {} };
    for (const ex of s.exercises) {
      for (const x of ex.sets) {
        if (isCardio(ex)) { out.cardioMin += x.min || 0; continue; }
        if (!(x.reps > 0)) continue;
        out.sets++;
        out.volume += (x.kg || 0) * x.reps;
        out.byMuscle[ex.muscle] = (out.byMuscle[ex.muscle] || 0) + 1;
      }
    }
    return out;
  }

  function add(acc, x) {
    acc.sets += x.sets; acc.volume += x.volume; acc.cardioMin += x.cardioMin;
    for (const [m, n] of Object.entries(x.byMuscle)) acc.byMuscle[m] = (acc.byMuscle[m] || 0) + n;
    return acc;
  }
  const zero = () => ({ sets: 0, volume: 0, cardioMin: 0, byMuscle: {} });

  const weekStart = (t) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
  };

  function stats() {
    const list = HS.store.list('training');
    const now = Date.now();
    const age = (s) => (now - HS.time(s.date)) / DAY;
    const last7 = list.filter((s) => age(s) < 7);
    const prev7 = list.filter((s) => age(s) >= 7 && age(s) < 14);
    const monday = weekStart(now);
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const start = monday - i * 7 * DAY;
      weeks.push({ start, n: list.filter((s) => HS.time(s.date) >= start && HS.time(s.date) < start + 7 * DAY).length });
    }
    const lifts = {};
    for (const s of list) {
      for (const ex of s.exercises) {
        if (isCardio(ex)) continue;
        const best = Math.max(0, ...ex.sets.map((x) => e1rm(x.kg, x.reps)));
        if (!best) continue;
        const pts = (lifts[ex.name] = lifts[ex.name] || {});
        pts[s.date] = Math.max(pts[s.date] || 0, Math.round(best * 10) / 10);
      }
    }
    const liftSeries = Object.entries(lifts)
      .map(([name, byDate]) => [name, Object.entries(byDate).map(([date, v]) => ({ date, t: HS.time(date), v, source: '' })).sort((a, b) => a.t - b.t)])
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 4);
    return {
      list, total: list.length, week: last7.length, weekStatus: HS.grade('weeklySessions', last7.length),
      lastDate: list[0] && list[0].date,
      last7: last7.map(summary).reduce(add, zero()), prev7: prev7.map(summary).reduce(add, zero()),
      weeks, liftSeries,
    };
  }
  HS.trainingStats = stats;

  // 依紀錄即時計算的分析（規則式）；較完整的評估請 Claude 重新分析
  function insights(st) {
    if (!st.total) return [];
    const out = [{ s: st.weekStatus, text: `近 7 天訓練 ${st.week} 次；健美目標建議每週 4–5 次。` }];
    const gap = HS.daysSince(st.lastDate);
    if (gap >= 4) out.push({ s: gap >= 7 ? 'warn' : 'fair', text: `距離上次訓練已經 ${gap} 天。` });
    const low = MAJOR.filter((m) => (st.last7.byMuscle[m] || 0) < 6).map((m) => M()[m]);
    if (st.week && low.length) out.push({ s: 'fair', text: `近 7 天少於 6 組的肌群：${low.join('、')}。每個肌群每週 10–20 組較利於增肌。` });
    const high = MAJOR.filter((m) => (st.last7.byMuscle[m] || 0) > 20).map((m) => `${M()[m]} ${st.last7.byMuscle[m]} 組`);
    if (high.length) out.push({ s: 'fair', text: `${high.join('、')}，超過每週 20 組，留意恢復與關節負擔。` });
    if (st.prev7.volume > 0 && st.last7.volume > 0) {
      const r = st.last7.volume / st.prev7.volume - 1;
      out.push({ s: r < -0.3 ? 'fair' : 'good', text: `近 7 天訓練量 ${fmtNum(st.last7.volume)} kg，比前 7 天 ${r >= 0 ? '多' : '少'} ${Math.abs(Math.round(r * 100))}%。` });
    }
    out.push({ s: st.last7.cardioMin >= 60 ? 'good' : 'fair', text: `近 7 天有氧 ${st.last7.cardioMin} 分鐘；為了提升 HDL、降低血壓，建議每週 60–135 分鐘。` });
    for (const [name, pts] of st.liftSeries) {
      if (pts.length < 2) continue;
      const d = pts[pts.length - 1].v - pts[0].v;
      out.push({ s: d >= 0 ? 'good' : 'fair', text: `${name} 估計 1RM ${pts[pts.length - 1].v} kg，比 ${fmtDate(pts[0].date)} ${d >= 0 ? '進步' : '下降'} ${Math.abs(d).toFixed(1)} kg。` });
    }
    return out;
  }

  const setText = (ex) => (isCardio(ex)
    ? ex.sets.map((x) => `${x.min || 0} 分鐘${x.km ? `／${x.km} km` : ''}`).join('、')
    : ex.sets.map((x) => `${x.kg ? `${x.kg} kg` : '自體重'} × ${x.reps || 0}`).join('、'));

  function sessionCard(s) {
    const x = summary(s);
    const wd = WEEKDAY[HS.parseDate(s.date).getDay()];
    const meta = [`${fmtDate(s.date)}（${wd}）`, s.durationMin ? `${s.durationMin} 分鐘` : '', `${x.sets} 組`, x.volume ? `${fmtNum(x.volume)} kg` : '', x.cardioMin ? `有氧 ${x.cardioMin} 分鐘` : ''].filter(Boolean).join('・');
    return `<div class="card log-item">
      <div class="log-head">
        <div><h3>${esc(s.title || '訓練')}</h3><div class="log-meta">${esc(meta)}</div></div>
        ${s.readonly ? '' : `<div class="btn-row">
          <button type="button" class="btn small" data-act="edit" data-id="${esc(s.id)}">${icon('edit')}編輯</button>
          <button type="button" class="btn small danger" data-act="delete" data-id="${esc(s.id)}">${icon('trash')}刪除</button>
        </div>`}
      </div>
      <div class="log-body">
        ${s.exercises.map((ex) => `<div><strong>${esc(ex.name)}</strong> <span class="muted">${esc(M()[ex.muscle] || '')}</span>　${esc(setText(ex))}</div>`).join('')}
        ${s.notes ? `<div class="muted">備註：${esc(s.notes)}</div>` : ''}
      </div>
    </div>`;
  }

  function muscleBars(st) {
    return MAJOR.map((m) => {
      const n = st.last7.byMuscle[m] || 0;
      const s = HS.grade('weeklySets', n);
      return `<div style="padding:8px 0">
        <div class="metric-row"><span>${esc(M()[m])}</span><span class="num">${n} 組 ${chip(s)}</span></div>
        ${HS.rangeBar('weeklySets', n)}
      </div>`;
    }).join('');
  }

  const STORAGE_NOTE = '紀錄會自動同步到你的私人 GitHub 數據倉庫，手機和電腦看到的是同一份；沒有網路時會先存在裝置，連線後自動補傳。';

  HS.views.training = {
    title: '訓練',
    render(root) {
      const st = stats();
      const ins = insights(st);
      root.innerHTML = `
        <header class="page-head">
          <div>
            <h1>訓練</h1>
            <div class="sub">${st.total ? `共 ${st.total} 筆・最近一次 ${esc(fmtDate(st.lastDate))}（${esc(HS.ago(st.lastDate))}）` : '尚無紀錄'}</div>
          </div>
          <button type="button" class="btn primary desktop-only" data-act="new">${icon('plus')}記錄訓練</button>
        </header>

        <section class="card hero">
          ${HS.sectionComment('training')}
          ${ins.length ? `<div class="section-head" style="margin:16px 0 8px"><h3>自動分析</h3><span class="sub">依紀錄即時計算</span></div>
            <ul class="mini-list">${ins.map((i) => `<li style="justify-content:flex-start;align-items:flex-start">${chip(i.s)}<span style="color:var(--ink)">${esc(i.text)}</span></li>`).join('')}</ul>` : ''}
          <p class="metric-meta" style="margin:12px 0 0">${STORAGE_NOTE}</p>
        </section>

        ${st.total ? `
        <section class="section grid g2">
          <div class="card">
            <div class="card-head"><h3>每週訓練次數</h3><span class="muted">近 8 週，目標 4–5 次</span></div>
            <div class="chart short"><canvas id="tr-weeks" role="img" aria-label="近 8 週每週訓練次數長條圖"></canvas></div>
          </div>
          <div class="card">
            <div class="card-head"><h3>近 7 天各肌群組數</h3><span class="muted">以主要肌群計算，目標 10–20 組</span></div>
            ${muscleBars(st)}
          </div>
        </section>
        ${st.liftSeries.length ? `<section class="section">
          <div class="section-head"><h2>主要動作進步</h2><span class="sub">估計 1RM（Epley 公式，採 12 下以內的組）</span></div>
          <div class="grid g2">${st.liftSeries.map(([name], i) => `<div class="card"><h3>${esc(name)}</h3><div class="chart short"><canvas data-lift="${i}" role="img" aria-label="${esc(name)}估計 1RM 趨勢"></canvas></div></div>`).join('')}</div>
        </section>` : ''}` : ''}

        <section class="section">
          <div class="section-head"><h2>紀錄</h2></div>
          ${st.total ? `<div class="log">${st.list.map(sessionCard).join('')}</div>` : `<div class="card empty">
            <h3>還沒有訓練紀錄</h3>
            <p>每次訓練後記下動作、重量與次數，這裡會自動統計每週頻率、各肌群組數與主要動作的進步，並一起納入整體分析。</p>
            <button type="button" class="btn primary" data-act="new">${icon('plus')}記錄第一次訓練</button>
          </div>`}
        </section>

        <button type="button" class="fab" data-act="new">${icon('plus')}記錄訓練</button>`;

      root.onclick = (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        if (b.dataset.act === 'new') HS.training.open();
        if (b.dataset.act === 'edit') HS.training.open(b.dataset.id);
        if (b.dataset.act === 'delete') {
          const s = HS.store.get('training', b.dataset.id);
          if (s && window.confirm(`刪除 ${fmtDate(s.date)} 的「${s.title || '訓練'}」紀錄？刪除後無法復原。`)) {
            HS.store.remove('training', s.id);
            HS.toast('已刪除');
          }
        }
      };

      if (!HS.charts.ok || !st.total) return;
      const c = HS.A.criteria.weeklySessions;
      HS.charts.bars(root.querySelector('#tr-weeks'), {
        labels: st.weeks.map((w) => `${HS.md(w.start)} 週`),
        values: st.weeks.map((w) => w.n),
        statuses: st.weeks.map((w) => HS.grade('weeklySessions', w.n)),
        zones: c.zones,
        format: (v) => `${v} 次`,
      });
      root.querySelectorAll('canvas[data-lift]').forEach((cv) => {
        const [name, pts] = st.liftSeries[Number(cv.dataset.lift)];
        HS.charts.trend(cv, { key: 'e1rm', label: `${name} 估計 1RM`, unit: 'kg', points: pts });
      });
    },
  };
})();
