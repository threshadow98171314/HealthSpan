/* Apple Watch 匯入：整理 iPhone 捷徑上傳到 imports/apple-health/ 的檔案，
   合併成 records/apple-health.json（每晚睡眠、靜止心率、HRV），整理完刪除原始檔 */
(() => {
  'use strict';

  const HS = window.HS;
  const R = window.HSRemote;
  const remote = window.HS_REMOTE;
  const DIR = 'imports/apple-health';
  const FILE = 'records/apple-health.json';
  const KEEP_DAYS = 21; // 原始樣本保留天數；捷徑每次上傳過去幾天，重疊部分靠原始樣本去重
  const MIN = 60000;

  const empty = () => ({ source: 'Apple Watch（iPhone 捷徑自動匯入）', lastImport: null, nights: [], restingHR: [], hrv: [], samples: [], rhrSamples: [], hrvSamples: [], problems: [] });
  let data = remote.records.appleHealth || empty();
  const status = { busy: false, error: '', lastRun: 0 };

  // ---------- 解析捷徑上傳的文字 ----------
  // 格式：以「##名稱」分段，每段一行一個值；stage/start/end/source 同一行號為同一筆樣本
  function stageOf(v) {
    const s = String(v).trim().toLowerCase();
    if (/^\d$/.test(s)) return ['inBed', 'asleep', 'awake', 'core', 'deep', 'rem'][Number(s)] || 'unknown';
    if (/deep|深/.test(s)) return 'deep';
    if (/rem|快速|動眼/.test(s)) return 'rem';
    if (/core|核心|淺/.test(s)) return 'core';
    if (/awake|清醒|醒/.test(s)) return 'awake';
    if (/bed|床/.test(s)) return 'inBed';
    if (/asleep|睡/.test(s)) return 'asleep';
    return 'unknown';
  }

  // 「+0800」補成「+08:00」，各瀏覽器都能解析
  const toTime = (s) => Date.parse(String(s).trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  const num = (v) => parseFloat(String(v).replace(',', '.').replace(/[^\d.-]/g, ''));

  function parse(text) {
    const sec = {};
    let cur = null;
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      const m = line.match(/^##\s*([a-z]+)/i);
      if (m) { cur = m[1].toLowerCase(); sec[cur] = []; continue; }
      if (cur && line) sec[cur].push(line);
    }
    const out = { samples: [], rhr: [], hrv: [], noTime: 0, total: (sec.stage || []).length };
    (sec.stage || []).forEach((label, i) => {
      const a = (sec.start || [])[i];
      const b = (sec.end || [])[i];
      if (!a || !b) return;
      if (!/\d:\d/.test(a)) { out.noTime++; return; }
      const s = toTime(a), e = toTime(b);
      if (!(e > s)) return;
      out.samples.push({ stage: stageOf(label), start: new Date(s).toISOString(), end: new Date(e).toISOString(), source: (sec.source || [])[i] || '' });
    });
    const series = (vals, dates) => (vals || []).map((v, i) => ({ t: toTime((dates || [])[i]), v: num(v) }))
      .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.v)).map((x) => ({ at: new Date(x.t).toISOString(), v: x.v }));
    out.rhr = series(sec.rhr, sec.rhrdate);
    out.hrv = series(sec.hrv, sec.hrvdate);
    return out;
  }

  // ---------- 每晚統計 ----------
  // 晚上 6 點到隔天下午 6 點算同一晚，日期記為起床那天
  const nightOf = (iso) => HS.dateStr(new Date(Date.parse(iso) + 6 * 3600e3));
  const dur = (x) => (Date.parse(x.end) - Date.parse(x.start)) / MIN;
  const SLEEP = ['core', 'deep', 'rem', 'asleep'];

  function summarize(date, list) {
    if (!list.length) return null;
    // 同一晚有多個來源時（例如 iPhone 與 Apple Watch），以有睡眠分期的來源為主，避免重複計算
    const bySource = {};
    for (const x of list) (bySource[x.source] = bySource[x.source] || []).push(x);
    const score = (arr) => arr.filter((x) => ['core', 'deep', 'rem'].includes(x.stage)).length * 1e6
      + arr.filter((x) => SLEEP.includes(x.stage) || x.stage === 'awake').reduce((a, x) => a + dur(x), 0);
    const primary = Object.values(bySource).sort((a, b) => score(b) - score(a))[0];
    const m = { core: 0, deep: 0, rem: 0, asleep: 0, awake: 0, inBed: 0 };
    for (const x of primary) if (x.stage in m) m[x.stage] += dur(x);
    const parts = primary.filter((x) => SLEEP.includes(x.stage) || x.stage === 'awake');
    if (!parts.length) return null;
    const asleep = m.core + m.deep + m.rem + m.asleep;
    if (asleep <= 0) return null;
    const r = (v) => Math.round(v);
    return {
      date,
      start: new Date(Math.min(...parts.map((x) => Date.parse(x.start)))).toISOString(),
      end: new Date(Math.max(...parts.map((x) => Date.parse(x.end)))).toISOString(),
      asleepMin: r(asleep), coreMin: r(m.core), deepMin: r(m.deep), remMin: r(m.rem), awakeMin: r(m.awake),
      staged: m.core + m.deep + m.rem > 0,
      source: primary[0].source,
    };
  }

  const dedupe = (arr, key) => [...new Map(arr.map((x) => [key(x), x])).values()];
  const dayAvg = (samples, dates, field) => [...dates].map((date) => {
    const v = samples.filter((x) => HS.dateStr(new Date(x.at)) === date).map((x) => x.v);
    return v.length ? { date, [field]: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10, n: v.length } : null;
  }).filter(Boolean);
  const upsert = (list, items) => {
    const map = new Map(list.map((x) => [x.date, x]));
    for (const x of items) map.set(x.date, x);
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  };

  function merge(base, parsedFiles) {
    const next = { ...empty(), ...base };
    const cutoff = Date.now() - KEEP_DAYS * 864e5;
    const recent = (x) => Date.parse(x.start || x.at) >= cutoff;
    const all = parsedFiles.flatMap((p) => p.samples);
    const pool = dedupe([...next.samples, ...all], (x) => `${x.start}|${x.end}|${x.stage}|${x.source}`);
    // 只重算這次有新樣本的晚上，其他晚上保留原本的統計
    const touched = new Set(all.map((x) => nightOf(x.start)));
    const nights = [...touched].map((date) => summarize(date, pool.filter((x) => nightOf(x.start) === date))).filter(Boolean);
    next.nights = upsert(next.nights, nights);
    next.samples = pool.filter(recent);

    const newRhr = parsedFiles.flatMap((p) => p.rhr);
    const newHrv = parsedFiles.flatMap((p) => p.hrv);
    const rhrPool = dedupe([...next.rhrSamples, ...newRhr], (x) => x.at);
    const hrvPool = dedupe([...next.hrvSamples, ...newHrv], (x) => x.at);
    next.restingHR = upsert(next.restingHR, dayAvg(rhrPool, new Set(newRhr.map((x) => HS.dateStr(new Date(x.at)))), 'bpm'));
    next.hrv = upsert(next.hrv, dayAvg(hrvPool, new Set(newHrv.map((x) => HS.dateStr(new Date(x.at)))), 'ms'));
    next.rhrSamples = rhrPool.filter(recent);
    next.hrvSamples = hrvPool.filter(recent);

    const noTime = parsedFiles.reduce((a, p) => a + p.noTime, 0);
    const problems = [];
    if (noTime) problems.push(`有 ${noTime} 筆睡眠樣本的日期沒有時間：請在捷徑的日期格式選「ISO 8601」並打開「包含時間」。`);
    if (parsedFiles.length && !all.length && !newRhr.length && !newHrv.length) problems.push('最近上傳的檔案沒有讀到任何數據：請確認捷徑有健康資料的讀取權限，並在 iPhone 解鎖時執行。');
    next.problems = problems;
    next.lastImport = { at: new Date().toISOString(), files: parsedFiles.length, samples: all.length };
    return next;
  }

  // ---------- 匯入流程 ----------
  async function ingest(force) {
    if (status.busy || (!force && Date.now() - status.lastRun < 120000)) return;
    status.busy = true;
    status.lastRun = Date.now();
    try {
      const files = (await R.listDir(remote.token, DIR)).filter((f) => f.type === 'file').sort((a, b) => a.name.localeCompare(b.name));
      if (!files.length) return;
      const parsed = [];
      for (const f of files) parsed.push(parse((await R.getText(remote.token, f.path)).text));
      for (let attempt = 0; ; attempt++) {
        const cur = await R.getFile(remote.token, FILE, { allowMissing: true });
        const next = merge(cur.json || empty(), parsed);
        try {
          await R.putFile(remote.token, FILE, next, cur.sha, `Apple Watch 匯入 ${files.length} 個檔案`);
          data = next;
          break;
        } catch (e) {
          if ((e.status === 409 || e.status === 422) && attempt < 3) continue;
          throw e;
        }
      }
      // 整理完才刪除原始檔；另一台裝置可能剛好已刪除，失敗就略過
      for (const f of files) {
        try { await R.deleteFile(remote.token, f.path, f.sha, '已整理的 Apple Watch 匯入檔'); } catch (e) { /* 略過 */ }
      }
      status.error = '';
    } catch (e) {
      status.error = `Apple Watch 匯入失敗：${e.message}`;
    } finally {
      status.busy = false;
      HS.store.refresh();
    }
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ingest(); });
  setTimeout(() => ingest(true), 0);

  HS.health = {
    data: () => data,
    status: () => status,
    ingest,
    parse,
  };
})();
