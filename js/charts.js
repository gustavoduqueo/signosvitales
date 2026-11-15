'use strict';
/* Chart.js helpers: indicator line charts with normal / watch range bands. */

const STATUS_COLOR = { green: '#34d399', yellow: '#fbbf24', red: '#f87171', unknown: '#64748b' };
let bandPluginRegistered = false;

const bandPlugin = {
  id: 'bands',
  beforeDatasetsDraw(chart, _args, opts) {
    if (!opts || !opts.ranges) return;
    const { ctx, chartArea, scales } = chart;
    const y = scales.y;
    const draw = (rg, color) => {
      const lo = Math.max(rg[0], y.min);
      const hi = Math.min(rg[1], y.max);
      if (hi <= lo) return;
      const y1 = y.getPixelForValue(hi);
      const y2 = y.getPixelForValue(lo);
      ctx.save();
      ctx.fillStyle = color;
      ctx.fillRect(chartArea.left, y1, chartArea.right - chartArea.left, y2 - y1);
      ctx.restore();
    };
    draw(opts.ranges.yellow, 'rgba(251, 191, 36, 0.13)');
    draw(opts.ranges.green, 'rgba(52, 211, 153, 0.14)');
  },
};

function chartsAvailable() { return typeof window.Chart !== 'undefined'; }

function drawIndicatorChart(canvas, id, days, mini = false) {
  if (!canvas) return;
  if (!chartsAvailable()) {
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = 'Charts need an internet connection the first time (Chart.js is loaded from a CDN).';
    canvas.replaceWith(p);
    return;
  }
  if (!bandPluginRegistered) { Chart.register(bandPlugin); bandPluginRegistered = true; }
  const prev = Chart.getChart(canvas);
  if (prev) prev.destroy();

  const ind = IND[id];
  const pts = series(id, days);
  const rg = rangesFor(id);
  const vals = pts.map((p) => p.value);
  const data = vals.filter((v) => v != null);
  const bounds = [rg.green[0], rg.green[1], rg.yellow[0], rg.yellow[1]].filter(Number.isFinite);
  let lo = Math.min(...data, ...bounds);
  let hi = Math.max(...data, ...bounds);
  const pad = (hi - lo) * 0.1 || 1;
  lo = Math.max(ind.input.min, lo - pad);
  hi = hi + pad;
  if (id === 'mood') { lo = 0.5; hi = 5.5; }
  const pointColors = vals.map((v) => STATUS_COLOR[statusOf(id, v)]);
  const grid = 'rgba(148, 163, 184, 0.10)';
  const tick = '#94a3b8';

  new Chart(canvas, {
    type: 'line',
    data: {
      labels: pts.map((p) => p.date.slice(5)),
      datasets: [{
        data: vals,
        borderColor: '#7dd3fc',
        borderWidth: mini ? 1.6 : 2,
        tension: 0.3,
        spanGaps: true,
        pointRadius: mini ? vals.map((_, i) => (i === vals.length - 1 || i === vals.length - 2 ? 2.5 : 0)) : 3.5,
        pointHoverRadius: 6,
        pointBackgroundColor: pointColors,
        pointBorderColor: pointColors,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: mini ? false : { duration: 350 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        bands: { ranges: rg },
        tooltip: {
          enabled: !mini,
          callbacks: {
            label: (c) => `${fmtVal(id, c.parsed.y)} · ${STATUS_LABEL[statusOf(id, c.parsed.y)]}`,
          },
        },
      },
      scales: {
        x: { display: !mini, ticks: { color: tick, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { color: grid } },
        y: { display: !mini, min: lo, max: hi, ticks: { color: tick, maxTicksLimit: 6 }, grid: { color: grid } },
      },
    },
  });
}
