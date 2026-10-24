/* 身體組成：趨勢圖、各項指標卡（含 AI 評語）、部位分析、完整數據表 */
(() => {
  'use strict';

  const HS = window.HS;
  const { D, A, DEF, esc, fmt, fmtKey, unitOf, labelOf, chip } = HS;
  const SEG = D.segmentLabels;
  const SEG_ORDER = ['trunk', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
  const RADAR_ORDER = ['trunk', 'rightArm', 'rightLeg', 'leftLeg', 'leftArm'];
  const GROUPS = [
    ['體重與體脂', ['bodyFatPercent', 'visceralFat', 'weightKg', 'bmi', 'fatMassKg']],
    ['肌肉與骨骼', ['muscleMassKg', 'smmKg', 'smi', 'legMuscleScore', 'fatFreeMassKg', 'proteinKg', 'boneMassKg', 'smmPercent']],
    ['水分與細胞', ['phaseAngle', 'tbwPercent', 'ecwPercent', 'tbwKg', 'icwKg', 'ecwKg']],
    ['代謝', ['metabolicAge', 'bmrKcal', 'bmrKj', 'fatDistribution']],
  ];
  const TRENDS = ['bodyFatPercent', 'visceralFat', 'muscleMassKg', 'weightKg'];
  const WITH_CHECKUP = ['weightKg', 'bmi'];
  const signed = (n) => (n > 0 ? `+${n}` : String(n));

  // 點的形狀代表量測地點（依數據自動對應），健康檢查固定為菱形
  const SHAPES = [['circle', '●'], ['triangle', '▲'], ['rect', '■'], ['star', '★']];
  const places = () => [...new Set(HS.bodyRecords().map((r) => `${r.location}・${r.brand}`))];
  function shapeOf(p) {
    if (p.kind === 'checkup') return 'rectRot';
    return SHAPES[Math.max(0, places().indexOf(p.source)) % SHAPES.length][0];
  }
  const shapeLegend = () => `${places().map((s, i) => `${SHAPES[i % SHAPES.length][1]} ${esc(s.replace('・', ' '))}`).join('　')}　◆ 健康檢查`;

  function fmtRange(key, rg) {
    if (!rg) return null;
    if (rg.text) return rg.text;
    const d = HS.digitsOf(key);
    if (rg.min != null && rg.max != null) return `${fmt(rg.min, d)}–${fmt(rg.max, d)}`;
    if (rg.ref != null) return `參考值 ${fmt(rg.ref, d)}`;
    if (rg.above != null) return `> ${fmt(rg.above, d)}`;
    if (rg.below != null) return `< ${fmt(rg.below, d)}`;
    if (rg.min != null) return `≥ ${fmt(rg.min, d)}`;
    return null;
  }

  function deltaText(key, last, prev) {
    if (!prev) return '';
    const d = last.v - prev.v;
    if (Math.abs(d) < 1e-9) return `與 ${HS.md(prev.t)} 相同`;
    const digits = Math.max(HS.decimals(last.v), HS.decimals(prev.v), HS.digitsOf(key));
    const unit = unitOf(key) === '%' ? ' 個百分點' : unitOf(key) ? ` ${unitOf(key)}` : '';
    return `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(digits)}${unit}　較 ${HS.md(prev.t)}`;
  }

  function metricCard(key) {
    const series = HS.bodySeries(key, WITH_CHECKUP.includes(key));
    if (!series.length) return '';
    const last = series[series.length - 1];
    const prev = series.length > 1 ? series[series.length - 2] : null;
    const rec = HS.bodyRecords().filter((r) => r.idealRanges && r.idealRanges[key]).pop();
    const ideal = rec ? fmtRange(key, rec.idealRanges[key]) : null;
    const target = A.criteria[key] && A.criteria[key].target;
    let extra = '';
    if (key === 'metabolicAge') {
      const r = HS.bodyRecords().pop();
      const diff = r.ageAtTest - last.v;
      extra = diff > 0 ? `比實際年齡年輕 ${diff} 歲` : diff < 0 ? `比實際年齡大 ${-diff} 歲` : '與實際年齡相同';
    }
    return `<div class="card metric">
      <div class="metric-top"><span class="metric-name">${esc(labelOf(key))}</span>${chip(last.s)}</div>
      <div class="metric-row">
        <div>
          <div class="metric-value"><b class="num">${esc(fmtKey(key, last.v))}</b><span class="unit">${esc(unitOf(key))}</span></div>
          <div class="delta">${esc(extra || deltaText(key, last, prev))}</div>
        </div>
        ${HS.spark(series.map((p) => ({ t: p.t, v: p.v, s: p.s })))}
      </div>
      ${HS.rangeBar(key, last.v, prev ? prev.v : null)}
      <div class="metric-meta">${esc(HS.fmtDate(last.date))}・${esc(last.source)}${ideal ? `｜報告理想 ${esc(ideal)}` : ''}${target ? `｜目標 ${esc(target)}` : ''}</div>
      ${HS.comment(key)}
    </div>`;
  }

  function trendCard(key) {
    const series = HS.bodySeries(key, WITH_CHECKUP.includes(key));
    const last = series[series.length - 1];
    return `<div class="card">
      <div class="card-head"><h3>${esc(labelOf(key))} <span class="muted">${esc(unitOf(key))}</span></h3>${chip(last.s)}</div>
      <div class="chart"><canvas data-trend="${key}" role="img" aria-label="${esc(labelOf(key))}趨勢，數值見下方指標卡與完整數據表"></canvas></div>
    </div>`;
  }

  function segmentTable(records) {
    const head = records.map((r) => `<th scope="col">${esc(HS.fmtDate(r.datetime))}<span class="rg">${esc(r.location)}</span></th>`).join('');
    const rows = (field) => SEG_ORDER.map((k) => `<tr><th scope="row">${esc(SEG[k])}</th>${records.map((r) => {
      const s = r.segments;
      const score = field === 'muscle' ? s.muscleScore[k] : s.fatScore[k];
      const st = HS.grade(field === 'muscle' ? 'muscleScore' : 'fatScore', score);
      const val = field === 'muscle' ? `${fmt(s.muscleKg[k], 1)} kg` : `${fmt(s.fatKg[k], 1)} kg・${fmt(s.fatPercent[k], 1)}%`;
      return `<td>${val} ${chip(st, signed(score))}</td>`;
    }).join('')}</tr>`).join('');
    return `<div class="grid g2">
      <div class="card"><h3>各部位肌肉量</h3><div class="table-wrap"><table><thead><tr><th scope="col">部位</th>${head}</tr></thead><tbody>${rows('muscle')}</tbody></table></div></div>
      <div class="card"><h3>各部位體脂肪</h3><div class="table-wrap"><table><thead><tr><th scope="col">部位</th>${head}</tr></thead><tbody>${rows('fat')}</tbody></table></div></div>
    </div>`;
  }

  function fullTable(records) {
    const head = records.map((r) => `<th scope="col">${esc(HS.fmtDate(r.datetime))}<span class="rg">${esc(r.location)}・${esc(r.model)}</span></th>`).join('');
    const meta = [
      ['測量時間', (r) => esc(r.datetime)],
      ['測量時年齡', (r) => `${r.ageAtTest} 歲`],
      ['身高', (r) => `${fmt(r.heightCm, 1)} cm`],
      ['衣物扣重', (r) => `${fmt(r.clothesDeductionKg, 1)} kg`],
      ['體型判定', (r) => esc(r.bodyType || '—')],
    ].map(([label, f]) => `<tr><th scope="row">${label}</th>${records.map((r) => `<td>${f(r)}</td>`).join('')}</tr>`).join('');
    const metrics = D.metricDefinitions.filter((d) => records.some((r) => r.metrics[d.key] != null)).map((d) => `<tr>
      <th scope="row">${esc(d.zh)} <span class="muted">${esc(d.unit)}</span></th>
      ${records.map((r) => {
        const v = r.metrics[d.key];
        const rg = fmtRange(d.key, r.idealRanges && r.idealRanges[d.key]);
        return `<td>${v == null ? '<span class="muted">—</span>' : esc(fmtKey(d.key, v))}${rg ? `<span class="rg">${esc(rg)}</span>` : ''}</td>`;
      }).join('')}
    </tr>`).join('');
    return `<div class="table-wrap"><table><thead><tr><th scope="col">項目</th>${head}</tr></thead><tbody>${meta}${metrics}</tbody></table></div>`;
  }

  function biaTables(records) {
    return records.map((r) => {
      const f = r.bia.frequenciesKHz;
      const rows = r.bia.rows.map((x) => `<tr><th scope="row">${esc(x.site)}</th>${f.map((_, i) => `<td>${fmt(x.r[i], 1)}</td><td>${fmt(x.x[i], 1)}</td>`).join('')}<td>${fmt(x.phaseAngle, 1)}</td></tr>`).join('');
      return `<h3 style="margin:14px 0 6px">${esc(HS.fmtDate(r.datetime))}・${esc(r.location)}</h3>
        <div class="table-wrap"><table><thead><tr><th scope="col">部位</th>${f.map((k) => `<th scope="col">${k}kHz R</th><th scope="col">${k}kHz X</th>`).join('')}<th scope="col">相位角</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="metric-meta">${esc(r.bia.note)}</p>`;
    }).join('');
  }

  function notes(records) {
    return records.map((r) => (r.notes && r.notes.length
      ? `<h3 style="margin:14px 0 6px">${esc(HS.fmtDate(r.datetime))}・${esc(r.location)}</h3><ul class="metric-meta" style="margin:0;padding-left:18px">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
      : '')).join('');
  }

  HS.views.body = {
    title: '身體組成',
    render(root) {
      const records = HS.bodyRecords();
      const latest = records[records.length - 1];
      const prev = records[records.length - 2];
      root.innerHTML = `
        <header class="page-head">
          <div>
            <h1>身體組成</h1>
            <div class="sub">最新：${esc(HS.fmtDate(latest.datetime))}・${esc(latest.location)}・${esc(latest.brand)} ${esc(latest.model)}（${esc(HS.ago(latest.datetime))}）｜共 ${records.length} 筆</div>
          </div>
        </header>

        <section class="card hero">${HS.sectionComment('bodyTrend')}</section>

        <section class="section">
          <div class="section-head"><h2>主要趨勢</h2><span class="sub">背景色帶為判讀區間（綠＝良好、黃＝留意、橘＝警戒、紅＝不佳）</span></div>
          <div class="grid g2">${TRENDS.map(trendCard).join('')}</div>
          <p class="legend">${shapeLegend()}</p>
          <div class="card" style="margin-top:14px">
            <div class="card-head"><h3>身體組成變化</h3><span class="muted">體重 = 肌肉量 + 推定骨量 + 體脂肪量</span></div>
            <div class="chart tall"><canvas id="body-composition" role="img" aria-label="身體組成堆疊長條圖，數值見完整數據表"></canvas></div>
          </div>
        </section>

        ${GROUPS.map(([title, keys]) => `<section class="section">
          <div class="section-head"><h2>${esc(title)}</h2></div>
          <div class="grid gauto">${keys.map(metricCard).join('')}</div>
        </section>`).join('')}

        <section class="section">
          <div class="section-head"><h2>部位分析</h2><span class="sub">${esc(D.segmentScoreScale)}</span></div>
          <div class="card" style="margin-bottom:14px">${HS.sectionComment('segments')}</div>
          <div class="grid g2" style="margin-bottom:14px">
            <div class="card"><h3>肌肉量評分</h3><div class="chart tall"><canvas id="radar-muscle" role="img" aria-label="各部位肌肉量評分雷達圖"></canvas></div></div>
            <div class="card"><h3>體脂肪評分</h3><div class="chart tall"><canvas id="radar-fat" role="img" aria-label="各部位體脂肪評分雷達圖"></canvas></div></div>
          </div>
          ${segmentTable(records)}
        </section>

        <section class="section">
          <details class="card"><summary>完整數據表（可對照紙本核對）</summary>${fullTable(records)}</details>
          <details class="card" style="margin-top:12px"><summary>BIA 阻抗原始數據</summary>${biaTables(records)}</details>
          <details class="card" style="margin-top:12px"><summary>報告備註</summary>${notes(records)}</details>
        </section>`;

      if (!HS.charts.ok) return;
      root.querySelectorAll('canvas[data-trend]').forEach((cv) => {
        const key = cv.dataset.trend;
        const c = A.criteria[key];
        const points = HS.bodySeries(key, WITH_CHECKUP.includes(key)).map((p) => ({ ...p, shape: shapeOf(p) }));
        HS.charts.trend(cv, { key, points, zones: c && !c.relativeTo ? c.zones : null });
      });
      HS.charts.composition(root.querySelector('#body-composition'), records);
      const sets = (field) => [latest, prev].filter(Boolean).map((r) => ({ label: `${HS.fmtDate(r.datetime)} ${r.location}`, data: RADAR_ORDER.map((k) => r.segments[field][k]) }));
      const labels = RADAR_ORDER.map((k) => SEG[k]);
      HS.charts.radar(root.querySelector('#radar-muscle'), { labels, sets: sets('muscleScore') });
      HS.charts.radar(root.querySelector('#radar-fat'), { labels, sets: sets('fatScore') });
    },
  };
})();
