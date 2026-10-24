/* 匯出：產生可直接提供給其他 AI 的 Markdown／JSON；並可備份與匯入本機紀錄 */
(() => {
  'use strict';

  const HS = window.HS;
  const { D, A, esc, fmt, fmtKey, unitOf, labelOf, fmtDate } = HS;
  const SEG_ORDER = ['trunk', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
  const PARTS = [['body', '身體組成'], ['labs', '血液與健檢'], ['training', '訓練'], ['sleep', '睡眠'], ['analysis', 'AI 分析']];

  const dash = (v) => (v == null || v === '' ? '—' : String(v));
  const row = (cells) => `| ${cells.map((c) => String(c).replace(/\|/g, '／')).join(' | ')} |`;
  const table = (head, rows) => [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n');

  function rangeText(key, rg) {
    if (!rg) return '';
    if (rg.text) return rg.text;
    const d = HS.digitsOf(key);
    if (rg.min != null && rg.max != null) return `${fmt(rg.min, d)}–${fmt(rg.max, d)}`;
    if (rg.ref != null) return `參考值 ${fmt(rg.ref, d)}`;
    if (rg.below != null) return `< ${fmt(rg.below, d)}`;
    if (rg.above != null) return `> ${fmt(rg.above, d)}`;
    return '';
  }

  function bodyMd() {
    const recs = HS.bodyRecords();
    if (!recs.length) return '';
    const col = (r) => `${r.datetime.slice(0, 10)} ${r.location}`;
    const meta = [
      ['測量時間', '', (r) => r.datetime], ['機型', '', (r) => `${r.brand} ${r.model}`], ['測量時年齡', '歲', (r) => r.ageAtTest],
      ['身高', 'cm', (r) => fmt(r.heightCm, 1)], ['衣物扣重', 'kg', (r) => fmt(r.clothesDeductionKg, 1)], ['體型判定', '', (r) => r.bodyType],
    ].map(([l, u, f]) => [l, u, ...recs.map((r) => dash(f(r)))]);
    const metrics = D.metricDefinitions.filter((d) => recs.some((r) => r.metrics[d.key] != null)).map((d) => [d.zh, d.unit, ...recs.map((r) => {
      const v = fmtKey(d.key, r.metrics[d.key]);
      const rg = rangeText(d.key, r.idealRanges && r.idealRanges[d.key]);
      return v == null ? '—' : rg ? `${v}（理想 ${rg}）` : v;
    })]);
    const seg = (f) => SEG_ORDER.map((k) => [D.segmentLabels[k], ...recs.map((r) => f(r.segments, k))]);
    const sg = (n) => (n > 0 ? `+${n}` : n);
    return [
      `## 身體組成（共 ${recs.length} 筆）`,
      table(['項目', '單位', ...recs.map(col)], [...meta, ...metrics]),
      '### 各部位肌肉量（括號內為部位評分）',
      table(['部位', ...recs.map(col)], seg((s, k) => `${fmt(s.muscleKg[k], 1)} kg（${sg(s.muscleScore[k])}）`)),
      '### 各部位體脂肪（括號內為部位評分）',
      table(['部位', ...recs.map(col)], seg((s, k) => `${fmt(s.fatKg[k], 1)} kg / ${fmt(s.fatPercent[k], 1)}%（${sg(s.fatScore[k])}）`)),
      `部位評分說明：${D.segmentScoreScale}。`,
      ...recs.filter((r) => r.notes && r.notes.length).map((r) => `備註（${col(r)}）：${r.notes.join('；')}`),
    ].join('\n\n');
  }

  function labsMd() {
    return HS.checkups().map((c) => [
      `## ${c.kind}：${fmtDate(c.date)} ${c.location}`,
      c.dateNote ? `日期說明：${c.dateNote}` : '',
      c.purpose ? `目的：${c.purpose}` : '',
      table(['類別', '項目', '結果', '單位', '參考值'], D.labGroups.flatMap((g) => c.results
        .filter((x) => (HS.DEF[x.key] && HS.DEF[x.key].group === g.key) || (g.key === 'vitals' && ['bmi', 'weightKg'].includes(x.key)))
        .map((x) => [g.zh, labelOf(x.key), x.text != null ? x.text : `${x.qualifier || ''}${fmtKey(x.key, x.value)}${x.printed ? `（列印 ${x.printed} ${x.printedUnit}）` : ''}`, unitOf(x.key), dash(x.ref)]))),
      c.doctorSummary ? `醫師總評：${c.doctorSummary}` : '',
      c.notes && c.notes.length ? `備註：${c.notes.join('；')}` : '',
    ].filter(Boolean).join('\n\n')).join('\n\n');
  }

  function trainingMd() {
    const list = HS.store.list('training');
    if (!list.length) return '## 訓練紀錄\n\n尚無資料。';
    const M = HS.training.MUSCLES;
    return ['## 訓練紀錄（新到舊）', ...list.map((s) => [
      `### ${s.date}　${s.title || '訓練'}${s.durationMin ? `（${s.durationMin} 分鐘）` : ''}`,
      ...s.exercises.map((ex) => `- ${ex.name}（${M[ex.muscle] || ex.muscle}）：${ex.muscle === 'cardio'
        ? ex.sets.map((x) => `${x.min || 0} 分鐘${x.km ? ` ${x.km} km` : ''}`).join('、')
        : ex.sets.map((x) => `${x.kg ? `${x.kg} kg` : '自體重'} × ${x.reps || 0}`).join('、')}`),
      s.notes ? `- 備註：${s.notes}` : '',
    ].filter(Boolean).join('\n'))].join('\n\n');
  }

  function sleepMd() {
    const list = HS.store.list('sleep');
    if (!list.length) return '## 睡眠紀錄\n\n尚無資料。';
    return ['## 睡眠紀錄（新到舊）', table(['日期（起床）', '就寢', '起床', '時數', '品質 1–5', '夜醒', '備註'],
      list.map((e) => [e.date, e.bedtime, e.wake, HS.sleep.hoursOf(e).toFixed(1), dash(e.quality), dash(e.awakenings), dash(e.notes)]))].join('\n\n');
  }

  function analysisMd() {
    const o = A.overall;
    return [
      `## AI 分析（Claude，${A.asOf}）`,
      `${o.headline}\n\n${o.summary}`,
      o.pillars.map((p) => `- ${p.title}（${HS.STATUS[p.status].label}）：${p.text}`).join('\n'),
      ...A.recommendations.map((r) => `### 建議：${r.title}\n${r.items.map((i) => `- ${i}`).join('\n')}`),
      `### 規劃\n${A.plan.map((s) => `- ${s.period}｜${s.phase}：${s.focus}（目標：${s.targets.join('、')}）`).join('\n')}`,
      `判讀標準說明：${A.statusScale}`,
    ].join('\n\n');
  }

  function markdown(opts) {
    const p = D.profile;
    const parts = [
      '# 個人健康數據',
      `匯出日期：${HS.todayStr()}｜資料更新：${D.updatedAt}`,
      '說明：數值依原始報告逐字抄錄；「—」代表該報告未提供；「理想」為該份報告列印的理想範圍。',
      `## 個人檔案\n\n- 性別：${p.sex}\n- 出生日期：${p.birthDate}（目前 ${HS.ageOn(p.birthDate, new Date())} 歲）\n- 身高：${p.heightCm} cm\n- 族裔：${p.ethnicity}\n- 健康狀態：${p.healthStatus}\n- 目標：${p.goal}${(p.notes || []).map((n) => `\n- 備註：${n}`).join('')}`,
    ];
    if (opts.body) parts.push(bodyMd());
    if (opts.labs) parts.push(labsMd());
    if (opts.training) parts.push(trainingMd());
    if (opts.sleep) parts.push(sleepMd());
    if (opts.analysis) parts.push(analysisMd());
    return `${parts.filter(Boolean).join('\n\n')}\n`;
  }

  function json(opts) {
    const data = JSON.parse(JSON.stringify(D));
    data.training = HS.store.list('training').map(({ readonly, ...x }) => x);
    data.sleep = HS.store.list('sleep').map(({ readonly, ...x }) => x);
    if (!opts.body) delete data.bodyComposition;
    if (!opts.labs) delete data.checkups;
    if (!opts.training) delete data.training;
    if (!opts.sleep) delete data.sleep;
    return `${JSON.stringify({ exportedAt: HS.todayStr(), data, analysis: opts.analysis ? A : undefined }, null, 2)}\n`;
  }

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function open() {
    const sheet = HS.openSheet({
      title: '匯出與備份',
      body: `
        <h3 style="margin-bottom:8px">給其他 AI 分析</h3>
        <div class="btn-row" style="margin-bottom:10px">
          <label class="tag"><input type="radio" name="fmt" value="md" checked style="width:auto;min-height:0"> Markdown（貼進對話框）</label>
          <label class="tag"><input type="radio" name="fmt" value="json" style="width:auto;min-height:0"> JSON（上傳檔案）</label>
        </div>
        <div class="btn-row" style="margin-bottom:10px">${PARTS.map(([k, l]) => `<label class="tag"><input type="checkbox" name="part" value="${k}" checked style="width:auto;min-height:0"> ${l}</label>`).join('')}</div>
        <textarea class="preview" readonly aria-label="匯出內容預覽"></textarea>
        <div class="btn-row" style="margin-top:10px">
          <button type="button" class="btn primary" data-act="copy">複製</button>
          <button type="button" class="btn" data-act="download">下載檔案</button>
          <span class="metric-meta" data-size></span>
        </div>
        <h3 style="margin:22px 0 6px">備份紀錄</h3>
        <p class="metric-meta" style="margin:0 0 10px">訓練與睡眠紀錄會自動同步到私人數據倉庫；這裡可以另外下載一份備份。匯入備份會合併進雲端紀錄。</p>
        <div class="btn-row">
          <button type="button" class="btn" data-act="backup">下載備份</button>
          <label class="btn">匯入備份<input type="file" accept="application/json,.json" data-act="restore" hidden></label>
        </div>`,
    });
    const root = sheet.el;
    const preview = root.querySelector('.preview');
    let text = '';
    const opts = () => {
      const o = { format: root.querySelector('input[name="fmt"]:checked').value };
      root.querySelectorAll('input[name="part"]').forEach((c) => { o[c.value] = c.checked; });
      return o;
    };
    const update = () => {
      const o = opts();
      text = o.format === 'md' ? markdown(o) : json(o);
      preview.value = text;
      root.querySelector('[data-size]').textContent = `共 ${text.length.toLocaleString()} 字元`;
    };
    root.addEventListener('change', async (e) => {
      if (e.target.dataset.act === 'restore') {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const r = HS.store.restore(JSON.parse(await file.text()));
          HS.toast(`已匯入：新增 ${r.added} 筆、更新 ${r.updated} 筆`);
          update();
        } catch (err) {
          HS.toast('匯入失敗：檔案不是有效的備份');
        }
        e.target.value = '';
        return;
      }
      update();
    });
    root.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]') && e.target.closest('[data-act]').dataset.act;
      if (act === 'copy') {
        try { await navigator.clipboard.writeText(text); } catch (err) { preview.select(); document.execCommand('copy'); }
        HS.toast('已複製');
      } else if (act === 'download') {
        const md = opts().format === 'md';
        download(`healthspan-${HS.todayStr()}.${md ? 'md' : 'json'}`, text, md ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8');
      } else if (act === 'backup') {
        download(`healthspan-backup-${HS.todayStr()}.json`, `${JSON.stringify(HS.store.dump(), null, 2)}\n`, 'application/json;charset=utf-8');
      }
    });
    update();
  }

  HS.exporter = { open, markdown, json };
})();
