/* 圖表：Chart.js 包裝；依主題取色，依判讀標準在背景畫 良好／留意／警戒／不佳 色帶 */
(() => {
  'use strict';

  const HS = window.HS;
  const ok = typeof window.Chart !== 'undefined';
  const live = [];

  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function rgba(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  function colors() {
    return {
      ink: css('--ink'), ink2: css('--ink-2'), ink3: css('--ink-3'), grid: css('--line-2'), axis: css('--line'),
      surface: css('--surface'), series: css('--series'),
      good: css('--good'), fair: css('--fair'), warn: css('--warn'), bad: css('--bad'), info: css('--info'),
      dark: document.documentElement.dataset.theme === 'dark',
    };
  }

  const zoneBands = {
    id: 'zoneBands',
    beforeDatasetsDraw(chart, _args, opts) {
      if (!opts || !opts.zones) return;
      const { ctx, chartArea: area, scales: { y } } = chart;
      const c = colors();
      const z = opts.zones;
      let from = -Infinity;
      ctx.save();
      for (let i = 0; i < z.length; i += 2) {
        const to = i + 1 < z.length ? z[i + 1] : Infinity;
        const top = to === Infinity ? area.top : Math.max(area.top, y.getPixelForValue(to));
        const bottom = from === -Infinity ? area.bottom : Math.min(area.bottom, y.getPixelForValue(from));
        if (bottom > top) {
          ctx.fillStyle = rgba(c[z[i]], c.dark ? 0.11 : 0.10);
          ctx.fillRect(area.left, top, area.right - area.left, bottom - top);
        }
        from = to;
      }
      ctx.restore();
    },
  };

  if (ok) {
    Chart.register(zoneBands);
    Chart.defaults.animation = false;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  }

  function prep() {
    const c = colors();
    Chart.defaults.color = c.ink2;
    return c;
  }
  const track = (ch) => { live.push(ch); return ch; };

  // 趨勢折線：points = [{ t, v, s, date, source, shape }]，x 軸依實際日期間距
  function trend(canvas, { key, points, zones, label, unit }) {
    if (!ok || !canvas || !points.length) return null;
    const c = prep();
    const xs = points.map((p) => p.t);
    const lo = Math.min(...xs), hi = Math.max(...xs);
    const pad = Math.max((hi - lo) * 0.08, 10 * 864e5);
    const multiYear = new Date(lo).getFullYear() !== new Date(hi).getFullYear();
    return track(new Chart(canvas, {
      type: 'line',
      data: {
        datasets: [{
          data: points.map((p) => ({ x: p.t, y: p.v, p })),
          borderColor: c.series, borderWidth: 2,
          pointRadius: 6, pointHoverRadius: 8, pointHitRadius: 16,
          pointBorderWidth: 2, pointBorderColor: c.surface,
          pointBackgroundColor: points.map((p) => c[p.s] || c.series),
          pointStyle: points.map((p) => p.shape || 'circle'),
        }],
      },
      options: {
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: { display: false },
          zoneBands: { zones: zones || null },
          tooltip: {
            callbacks: {
              title: (items) => `${HS.fmtDate(items[0].raw.p.date)}・${items[0].raw.p.source || ''}`,
              label: (item) => {
                const p = item.raw.p;
                return `${label || HS.labelOf(key)} ${HS.fmtKey(key, p.v)} ${unit != null ? unit : HS.unitOf(key)}${p.s ? `（${HS.STATUS[p.s].label}）` : ''}`;
              },
            },
          },
        },
        scales: {
          x: {
            type: 'linear', min: lo - pad, max: hi + pad,
            // 每個資料點一個刻度；太靠近的日期只留較新的，避免標籤重疊
            afterBuildTicks: (axis) => {
              const minGap = (hi - lo) * 0.12;
              const kept = [];
              for (const v of [...new Set(xs)].sort((a, b) => b - a)) if (!kept.length || kept[kept.length - 1] - v >= minGap) kept.push(v);
              axis.ticks = kept.reverse().map((value) => ({ value }));
            },
            ticks: {
              color: c.ink3, maxRotation: 0, autoSkipPadding: 8,
              callback: (v) => (multiYear ? `${String(new Date(v).getFullYear()).slice(2)}/` : '') + HS.md(v),
            },
            grid: { display: false }, border: { color: c.axis },
          },
          y: { grace: '25%', ticks: { color: c.ink3, maxTicksLimit: 5 }, grid: { color: c.grid }, border: { display: false } },
        },
      },
    }));
  }

  // 長條圖：每根依狀態上色；zones 會畫在背景
  function bars(canvas, { labels, values, statuses, zones, format, horizontal }) {
    if (!ok || !canvas) return null;
    const c = prep();
    const valueAxis = horizontal ? 'x' : 'y';
    const catAxis = horizontal ? 'y' : 'x';
    return track(new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: statuses.map((s) => c[s] || c.series),
          borderRadius: 4, maxBarThickness: 30,
        }],
      },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        plugins: {
          legend: { display: false },
          zoneBands: { zones: horizontal ? null : zones || null },
          tooltip: {
            callbacks: {
              label: (item) => `${format ? format(item.raw) : item.raw}${statuses[item.dataIndex] ? `（${HS.STATUS[statuses[item.dataIndex]].label}）` : ''}`,
            },
          },
        },
        scales: {
          [catAxis]: { grid: { display: false }, border: { color: c.axis }, ticks: { color: c.ink2, autoSkip: !horizontal } },
          [valueAxis]: { beginAtZero: true, grace: '10%', ticks: { color: c.ink3, maxTicksLimit: 5 }, grid: { color: c.grid }, border: { display: false } },
        },
      },
    }));
  }

  // 部位評分雷達圖：sets[0] 為最新一筆
  function radar(canvas, { labels, sets }) {
    if (!ok || !canvas) return null;
    const c = prep();
    return track(new Chart(canvas, {
      type: 'radar',
      data: {
        labels,
        datasets: sets.map((s, i) => ({
          label: s.label, data: s.data, fill: false,
          borderColor: i === 0 ? c.series : c.ink3, backgroundColor: i === 0 ? c.series : c.ink3,
          borderWidth: i === 0 ? 2 : 1.5, pointRadius: 4, pointHitRadius: 12, pointBorderColor: c.surface, pointBorderWidth: 2,
        })),
      },
      options: {
        plugins: {
          legend: { position: 'bottom', labels: { color: c.ink2, boxWidth: 12, boxHeight: 12 } },
          tooltip: { callbacks: { label: (it) => `${it.dataset.label}：${it.raw > 0 ? '+' : ''}${it.raw}` } },
        },
        scales: {
          r: {
            min: -4, max: 4,
            ticks: { stepSize: 1, color: c.ink3, backdropColor: 'transparent', callback: (v) => (v % 2 === 0 ? (v > 0 ? `+${v}` : String(v)) : '') },
            grid: { color: c.grid }, angleLines: { color: c.grid }, pointLabels: { color: c.ink, font: { size: 13 } },
          },
        },
      },
    }));
  }

  // 身體組成堆疊長條：肌肉量 + 推定骨量 + 體脂肪量 = 體重
  function composition(canvas, records) {
    if (!ok || !canvas) return null;
    const c = prep();
    // 體脂肪量用中性的第二色，避免和「警戒」橘色混淆
    const stack = [['肌肉量', 'muscleMassKg', c.series], ['推定骨量', 'boneMassKg', c.ink3], ['體脂肪量', 'fatMassKg', css('--series-2')]];
    const totals = {
      id: 'totals',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        ctx.save();
        ctx.fillStyle = c.ink;
        ctx.font = `700 12px ${Chart.defaults.font.family}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        chart.getDatasetMeta(stack.length - 1).data.forEach((bar, i) => ctx.fillText(`${HS.fmtKey('weightKg', records[i].metrics.weightKg)} kg`, bar.x, bar.y - 4));
        ctx.restore();
      },
    };
    return track(new Chart(canvas, {
      type: 'bar',
      data: {
        labels: records.map((r) => [HS.fmtDate(r.datetime), r.location]),
        datasets: stack.map(([label, key, color], i) => ({
          label, data: records.map((r) => r.metrics[key]), backgroundColor: color,
          borderColor: c.surface, borderWidth: { top: 2 }, borderSkipped: false,
          borderRadius: i === stack.length - 1 ? { topLeft: 5, topRight: 5 } : 0, maxBarThickness: 56,
        })),
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', align: 'start', labels: { color: c.ink2, boxWidth: 12, boxHeight: 12 } },
          tooltip: { callbacks: { label: (it) => `${it.dataset.label} ${HS.fmt(it.raw, 1)} kg` } },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, border: { color: c.axis }, ticks: { color: c.ink2 } },
          y: { stacked: true, beginAtZero: true, grace: '10%', ticks: { color: c.ink3 }, grid: { color: c.grid }, border: { display: false } },
        },
      },
      plugins: [totals],
    }));
  }

  // 堆疊長條（例如睡眠分期）：sets = [{ label, data, color }]；zones 畫在背景，對照總高度
  function stack(canvas, { labels, sets, zones, unit }) {
    if (!ok || !canvas) return null;
    const c = prep();
    return track(new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: sets.map((s, i) => ({
          label: s.label, data: s.data, backgroundColor: css(s.color) || s.color,
          borderColor: c.surface, borderWidth: { top: 1 }, borderSkipped: false,
          borderRadius: i === sets.length - 1 ? { topLeft: 4, topRight: 4 } : 0, maxBarThickness: 30,
        })),
      },
      options: {
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', align: 'start', labels: { color: c.ink2, boxWidth: 12, boxHeight: 12 } },
          zoneBands: { zones: zones || null },
          tooltip: {
            callbacks: {
              label: (it) => `${it.dataset.label} ${it.raw} ${unit || ''}`,
              footer: (items) => `合計 ${Math.round(items.reduce((a, it) => a + (it.dataset.label === '清醒' ? 0 : it.raw), 0) * 10) / 10} ${unit || ''}（不含清醒）`,
            },
          },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, border: { color: c.axis }, ticks: { color: c.ink2 } },
          y: { stacked: true, beginAtZero: true, grace: '8%', ticks: { color: c.ink3, maxTicksLimit: 6 }, grid: { color: c.grid }, border: { display: false } },
        },
      },
    }));
  }

  function destroyAll() {
    live.splice(0).forEach((ch) => ch.destroy());
  }

  HS.charts = { ok, trend, bars, radar, composition, stack, destroyAll };
})();
