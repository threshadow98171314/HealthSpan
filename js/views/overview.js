/* 總覽：整體評估、三大目標、需要注意的項目、近期紀錄、建議、規劃、資料來源 */
(() => {
  'use strict';

  const HS = window.HS;
  const { D, A, DEF, RANK, esc, fmtKey, unitOf, labelOf, chip } = HS;

  // 任一指標的最新數值（身體組成與健檢合併，依日期取最新）
  function latestOf(key) {
    const num = HS.bodySeries(key, true);
    if (num.length) return { ...num[num.length - 1], prev: num.length > 1 ? num[num.length - 2] : null };
    const txt = HS.labSeries(key).filter((x) => x.text != null);
    if (txt.length) {
      const x = txt[txt.length - 1];
      return { date: x.date, text: x.text, s: HS.gradeText(key, x.text), source: `${x.report.location}・${x.report.kind}` };
    }
    return null;
  }
  HS.latestOf = latestOf;

  const valueText = (key, l) => (l.text != null ? esc(l.text) : `${esc(fmtKey(key, l.v))}${unitOf(key) ? ` ${esc(unitOf(key))}` : ''}`);

  function pillarCard(p) {
    const rows = p.metrics.map((k) => {
      const l = latestOf(k);
      if (!l) return '';
      return `<li><span>${esc(labelOf(k))}</span><span class="num">${valueText(k, l)} ${chip(l.s)}</span></li>`;
    }).join('');
    return `<div class="card pillar s-${p.status}">
      <div class="card-head"><h3>${esc(p.title)}</h3>${chip(p.status)}</div>
      <p>${esc(p.text)}</p>
      <ul class="mini-list">${rows}</ul>
    </div>`;
  }

  // 自動篩出「留意」以上的項目，依嚴重程度排序
  function watchItems() {
    const items = [];
    for (const key of Object.keys(DEF)) {
      if (A.pendingKeys.includes(key)) continue;
      const l = latestOf(key);
      if (!l || !l.s || RANK[l.s] < RANK.fair) continue;
      items.push({ key, l });
    }
    items.sort((a, b) => RANK[b.l.s] - RANK[a.l.s]);
    return items.map(({ key, l }) => `<div class="watch s-${l.s}">
      <div class="metric-row"><strong>${esc(labelOf(key))}</strong>${chip(l.s)}</div>
      <div class="metric-meta">${valueText(key, l)}・${esc(HS.fmtDate(l.date))}（${esc(HS.ago(l.date))}）・${esc(l.source || '')}</div>
      ${HS.comment(key)}
    </div>`).join('');
  }

  function pendingItems() {
    return A.pendingKeys.map((key) => {
      const l = latestOf(key);
      if (!l) return '';
      return `<div class="watch s-info">
        <div class="metric-row"><strong>${esc(labelOf(key))}</strong>${chip('info', '待確認')}</div>
        ${HS.comment(key)}
      </div>`;
    }).join('');
  }

  function recordCards() {
    const t = HS.trainingStats ? HS.trainingStats() : null;
    const s = HS.sleepStats ? HS.sleepStats() : null;
    const card = (title, href, stat, emptyText) => `<a class="card" href="${href}" style="text-decoration:none;color:inherit">
      <div class="card-head"><h3>${title}</h3>${stat ? chip(stat.status) : ''}</div>
      ${stat ? `<div class="metric-value"><b>${esc(stat.value)}</b><span class="unit">${esc(stat.unit)}</span></div>
        <div class="metric-meta">${esc(stat.meta)}</div>` : `<p class="muted" style="margin:0">${esc(emptyText)}</p>`}
    </a>`;
    return card('訓練（近 7 天）', '#/training', t && t.total ? { status: t.weekStatus, value: t.week, unit: '次', meta: `共 ${t.total} 筆紀錄・最近一次 ${HS.fmtDate(t.lastDate)}` } : null, '還沒有訓練紀錄，到「訓練」頁新增第一筆。')
      + card('睡眠（近 7 晚平均）', '#/sleep', s && s.total ? { status: s.avgStatus, value: s.avg7 == null ? '—' : s.avg7.toFixed(1), unit: '小時', meta: `共 ${s.total} 晚紀錄` } : null, '還沒有睡眠紀錄，到「睡眠」頁新增。');
  }

  function sources() {
    const all = [
      ...D.bodyComposition.map((r) => ({ id: r.id, date: r.datetime.slice(0, 10), name: `${r.brand} ${r.model}・${r.location}` })),
      ...D.checkups.map((c) => ({ id: c.id, date: c.date, name: `${c.kind}・${c.location}` })),
    ];
    return A.sources.map((src) => {
      const r = all.find((x) => x.id === src.id);
      if (!r) return '';
      const f = HS.freshness(r.date);
      return `<div class="source-row">
        <span><strong class="num">${esc(HS.fmtDate(r.date))}</strong>　${esc(r.name)}</span>
        <span class="btn-row"><span class="tag">${esc(f.label)}・${esc(HS.ago(r.date))}</span><span class="tag">${esc(src.role)}</span></span>
        <span class="why">${esc(src.why)}</span>
      </div>`;
    }).join('');
  }

  HS.views.overview = {
    title: '總覽',
    render(root) {
      const p = D.profile;
      const o = A.overall;
      const watch = watchItems();
      root.innerHTML = `
        <header class="page-head">
          <div>
            <h1>總覽</h1>
            <div class="sub">${esc(p.sex)}・${HS.ageOn(p.birthDate, new Date())} 歲・目標：${esc(p.goal)}｜AI 分析日期 ${esc(HS.fmtDate(A.asOf))}</div>
          </div>
        </header>

        <section class="card hero">
          <h2>${esc(o.headline)}</h2>
          <p>${esc(o.summary)}</p>
        </section>

        <section class="section">
          <div class="section-head"><h2>三大目標</h2><span class="sub">健康・壯碩・健美</span></div>
          <div class="grid g3">${o.pillars.map(pillarCard).join('')}</div>
        </section>

        <section class="section">
          <div class="section-head"><h2>需要注意</h2><span class="sub">依每項指標的最新數值自動篩選</span></div>
          <div class="grid g2">${watch || '<div class="card muted">目前沒有需要注意的項目。</div>'}${pendingItems()}</div>
        </section>

        <section class="section">
          <div class="section-head"><h2>近期紀錄</h2></div>
          <div class="grid g2">${recordCards()}</div>
        </section>

        <section class="section">
          <div class="section-head"><h2>建議</h2></div>
          <div class="grid g2">${A.recommendations.map((r) => `<div class="card reco"><h3>${esc(r.title)}</h3><ul>${r.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('')}</div>
        </section>

        <section class="section">
          <div class="section-head"><h2>規劃</h2><span class="sub">以 10 月的數據為起點</span></div>
          <div class="card plan">${A.plan.map((s) => `<div class="plan-step">
            <div class="when num">${esc(s.period)}</div>
            <div><h3>${esc(s.phase)}</h3><p>${esc(s.focus)}</p><div class="tags">${s.targets.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div></div>
          </div>`).join('')}</div>
        </section>

        <section class="section">
          <div class="section-head"><h2>資料來源與權重</h2><span class="sub">越舊的資料在判讀中權重越低</span></div>
          <div class="card">${sources()}</div>
        </section>

        <p class="disclaimer">${esc(A.disclaimer)}　${esc(A.statusScale)}</p>`;
    },
  };
})();
