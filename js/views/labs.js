/* 血液與健檢：依檢驗類別分組，每項含狀態、範圍條、前次比較與 AI 評語 */
(() => {
  'use strict';

  const HS = window.HS;
  const { D, esc, fmtKey, unitOf, labelOf, chip, fmtDate } = HS;
  // 健檢報告裡的體重、BMI 沿用身體組成的欄位定義，歸在生命徵象
  const EXTRA = { vitals: ['bmi', 'weightKg'] };

  function latestPair(key) {
    const series = HS.labSeries(key);
    if (!series.length) return null;
    const last = series[series.length - 1];
    const prev = series.length > 1 ? series[series.length - 2] : null;
    const isText = last.text != null;
    const s = isText ? HS.gradeText(key, last.text) : HS.grade(key, last.value);
    return { last, prev, isText, s };
  }

  function labRow(key) {
    const p = latestPair(key);
    if (!p) return '';
    const { last, prev, isText, s } = p;
    const value = isText ? esc(last.text) : `${last.qualifier ? `${esc(last.qualifier)} ` : ''}${esc(fmtKey(key, last.value))}`;
    const printed = last.printed ? `，報告列印 ${esc(last.printed)} ${esc(last.printedUnit)}` : '';
    const where = `${fmtDate(last.date)}・${esc(last.report.location.split('（')[0])}`;
    const prevText = prev && !isText && prev.value != null ? `前次 ${esc(fmtKey(key, prev.value))}（${fmtDate(prev.date)}）` : '';
    return `<div class="lab-row">
      <div>
        <div class="lab-name">${esc(labelOf(key))}${chip(s, s === 'info' ? '待確認' : null)}</div>
        <div class="lab-val"><b class="num"${isText && last.text.length > 8 ? ' style="font-size:15px;font-weight:600"' : ''}>${value}</b><span class="unit">${esc(unitOf(key))}</span></div>
        <div class="lab-ref">${last.ref ? `參考值 ${esc(last.ref)}${printed}｜` : ''}${where}</div>
      </div>
      <div>${isText ? '' : HS.rangeBar(key, last.value, prev ? prev.value : null)}${prevText ? `<div class="lab-ref" style="margin-top:6px">${prevText}</div>` : ''}</div>
      ${HS.comment(key)}
    </div>`;
  }

  function groupKeys(group) {
    const keys = D.labDefinitions.filter((d) => d.group === group).map((d) => d.key).concat(EXTRA[group] || []);
    return keys.filter((k) => HS.labSeries(k).length);
  }

  function counts() {
    const c = { good: 0, fair: 0, warn: 0, bad: 0, info: 0 };
    for (const g of D.labGroups) for (const k of groupKeys(g.key)) { const p = latestPair(k); if (p && p.s) c[p.s]++; }
    return c;
  }

  function reportCard(r) {
    const f = HS.freshness(r.date);
    return `<div class="card">
      <div class="card-head"><h3>${esc(r.kind)}・${esc(r.location)}</h3><span class="tag">${esc(f.label)}・${esc(HS.ago(r.date))}</span></div>
      <div class="metric-meta">${esc(fmtDate(r.date))}${r.dateNote ? `（${esc(r.dateNote)}）` : ''}・${r.results.length} 項・${esc(r.source)}</div>
      ${r.purpose ? `<div class="metric-meta">目的：${esc(r.purpose)}</div>` : ''}
      ${r.doctorSummary ? `<div class="ai" style="margin-top:10px">醫師總評：${esc(r.doctorSummary)}</div>` : ''}
      ${r.notes && r.notes.length ? `<details style="margin-top:10px"><summary>報告備註</summary><ul class="metric-meta" style="margin:0;padding-left:18px">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></details>` : ''}
    </div>`;
  }

  HS.views.labs = {
    title: '血液與健檢',
    render(root) {
      const reports = HS.checkups();
      const c = counts();
      const latest = reports[reports.length - 1];
      root.innerHTML = `
        <header class="page-head">
          <div>
            <h1>血液與健檢</h1>
            <div class="sub">共 ${reports.length} 份報告・最新 ${esc(fmtDate(latest.date))}（${esc(HS.ago(latest.date))}）・同一項目有兩次檢驗時以較新的為準</div>
          </div>
          <div class="btn-row">${['good', 'fair', 'warn', 'bad'].map((s) => `${chip(s, `${HS.STATUS[s].label} ${c[s]}`)}`).join('')}${c.info ? chip('info', `待確認 ${c.info}`) : ''}</div>
        </header>

        <section class="grid g2">${reports.slice().reverse().map(reportCard).join('')}</section>

        ${D.labGroups.map((g) => {
          const keys = groupKeys(g.key);
          if (!keys.length) return '';
          return `<section class="section">
            <div class="section-head"><h2>${esc(g.zh)}</h2><span class="sub">${keys.length} 項</span></div>
            <div class="card">
              ${HS.sectionComment(g.key)}
              ${keys.map(labRow).join('')}
            </div>
          </section>`;
        }).join('')}

        <p class="disclaimer">${esc(HS.A.disclaimer)}　範圍條：三角形為最新數值，空心圓為前次；色帶為判讀區間，可能比檢驗參考值嚴格。</p>`;
    },
  };
})();
