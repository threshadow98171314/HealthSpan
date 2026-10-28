/* Apple Watch 匯入：整理 iPhone 捷徑送進私人倉庫的數據（Issue 或 imports/apple-health/ 的檔案），
   合併成 records/apple-health.json（每晚睡眠、靜止心率、HRV），整理完關閉 Issue、刪除檔案 */
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

  // ---------- 解析捷徑送來的文字 ----------
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

  // 日期可以是 ISO 8601，或手機預設格式（例如「2026年10月24日 上午12:30」「2026/10/24 13:05」）
  function toTime(raw) {
    const s = String(raw).trim();
    if (/\d{4}-\d{2}-\d{2}T\d/.test(s)) return Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    const m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D+?(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      let h = Number(m[4]);
      const mark = (s.match(/上午|下午|中午|凌晨|早上|晚上|\bAM\b|\bPM\b/i) || [''])[0].toUpperCase();
      if (/下午|中午|晚上|PM/.test(mark) && h < 12) h += 12;
      if (/上午|凌晨|早上|AM/.test(mark) && h === 12) h = 0;
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, Number(m[5]), Number(m[6] || 0)).getTime();
    }
    return Date.parse(s.replace(/\s+at\s+/i, ' '));
  }
  const num = (v) => parseFloat(String(v).replace(',', '.').replace(/[^\d.-]/g, ''));

  // 格式：第一行「HEALTHSPAN sleep／rhr／hrv」，之後以「##名稱」分段，每段一行一個值，同一行號為同一筆。
  // 段落：value（睡眠階段或數值）、start（開始時間）、end（結束時間）、source（來源，可省略）。
  // 也相容舊格式（stage／start／end／source／rhr／rhrdate／hrv／hrvdate）。
  function parse(text) {
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim());
    const head = (lines.find((l) => /^healthspan/i.test(l)) || '').split(/\s+/)[1] || '';
    const sec = {};
    let cur = null;
    for (const line of lines) {
      const m = line.match(/^##\s*([a-z]+)/i);
      if (m) { cur = m[1].toLowerCase(); sec[cur] = []; continue; }
      if (cur && line) sec[cur].push(line);
    }
    const type = head.toLowerCase();
    const out = { samples: [], rhr: [], hrv: [], noTime: 0 };
    const labels = sec.stage || (type === 'sleep' ? sec.value : null) || [];
    labels.forEach((label, i) => {
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
    if (type === 'rhr') out.rhr = series(sec.value, sec.start);
    if (type === 'hrv') out.hrv = series(sec.value, sec.start);
    if (sec.rhr) out.rhr = out.rhr.concat(series(sec.rhr, sec.rhrdate));
    if (sec.hrv) out.hrv = out.hrv.concat(series(sec.hrv, sec.hrvdate));
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

  function merge(base, parsed) {
    const next = { ...empty(), ...base };
    const cutoff = Date.now() - KEEP_DAYS * 864e5;
    const recent = (x) => Date.parse(x.start || x.at) >= cutoff;
    const all = parsed.flatMap((p) => p.samples);
    const pool = dedupe([...next.samples, ...all], (x) => `${x.start}|${x.end}|${x.stage}|${x.source}`);
    // 只重算這次有新樣本的晚上，其他晚上保留原本的統計
    const touched = new Set(all.map((x) => nightOf(x.start)));
    next.nights = upsert(next.nights, [...touched].map((date) => summarize(date, pool.filter((x) => nightOf(x.start) === date))).filter(Boolean));
    next.samples = pool.filter(recent);

    const newRhr = parsed.flatMap((p) => p.rhr);
    const newHrv = parsed.flatMap((p) => p.hrv);
    const rhrPool = dedupe([...next.rhrSamples, ...newRhr], (x) => x.at);
    const hrvPool = dedupe([...next.hrvSamples, ...newHrv], (x) => x.at);
    next.restingHR = upsert(next.restingHR, dayAvg(rhrPool, new Set(newRhr.map((x) => HS.dateStr(new Date(x.at)))), 'bpm'));
    next.hrv = upsert(next.hrv, dayAvg(hrvPool, new Set(newHrv.map((x) => HS.dateStr(new Date(x.at)))), 'ms'));
    next.rhrSamples = rhrPool.filter(recent);
    next.hrvSamples = hrvPool.filter(recent);

    const noTime = parsed.reduce((a, p) => a + p.noTime, 0);
    const problems = [];
    if (noTime) problems.push(`有 ${noTime} 筆睡眠數據的日期沒有時間：請在捷徑「文字」動作中，點「開始日期」「結束日期」，把日期格式改成有時間的格式（例如 ISO 8601 並打開時間）。`);
    if (parsed.length && !all.length && !newRhr.length && !newHrv.length) problems.push('最近上傳的內容沒有讀到任何數據：請確認捷徑有讀取健康資料的權限，並在 iPhone 解鎖時執行。');
    next.problems = problems;
    next.lastImport = { at: new Date().toISOString(), uploads: parsed.length, samples: all.length };
    return next;
  }

  // ---------- 匯入流程 ----------
  const isUpload = (issue) => /healthspan|apple\s*watch/i.test(issue.title || '') || /^\s*healthspan/i.test(issue.body || '');

  async function ingest(force) {
    if (status.busy || (!force && Date.now() - status.lastRun < 120000)) return;
    status.busy = true;
    status.lastRun = Date.now();
    let issueError = null;
    try {
      const [files, issues] = await Promise.all([
        R.listDir(remote.token, DIR).then((list) => list.filter((f) => f.type === 'file').sort((a, b) => a.name.localeCompare(b.name))),
        R.listIssues(remote.token).then((list) => list.filter(isUpload)).catch((e) => { issueError = e; return []; }),
      ]);
      if (files.length || issues.length) {
        const parsed = [];
        for (const f of files) parsed.push(parse((await R.getText(remote.token, f.path)).text));
        for (const x of issues) parsed.push(parse(x.body));
        for (let attempt = 0; ; attempt++) {
          const cur = await R.getFile(remote.token, FILE, { allowMissing: true });
          const next = merge(cur.json || empty(), parsed);
          try {
            await R.putFile(remote.token, FILE, next, cur.sha, `Apple Watch 匯入 ${parsed.length} 筆上傳`);
            data = next;
            break;
          } catch (e) {
            if ((e.status === 409 || e.status === 422) && attempt < 3) continue;
            throw e;
          }
        }
        // 整理完才刪除檔案、關閉 Issue；另一台裝置可能剛好已處理，失敗就略過
        for (const f of files) {
          try { await R.deleteFile(remote.token, f.path, f.sha, '已整理的 Apple Watch 匯入檔'); } catch (e) { /* 略過 */ }
        }
        for (const x of issues) {
          try { await R.closeIssue(remote.token, x.number); } catch (e) { /* 略過 */ }
        }
      }
      status.error = !issueError ? ''
        : issueError.status === 403 || issueError.status === 404
          ? '讀不到捷徑上傳的數據：GitHub 權杖需要加上「Issues：Read and write」權限（見設定教學第 1 步）。'
          : `讀取捷徑上傳的數據失敗：${issueError.message}`;
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
    toTime,
  };
})();
