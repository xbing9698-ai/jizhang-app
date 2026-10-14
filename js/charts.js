// 图表配色：按分类名固定映射（同一分类颜色恒定）
// 低饱和色与浅白界面协调；颜色只影响显示，不改变分类与金额。
const CATEGORY_COLOR_MAP = {
  '餐饮': '#bf8065',
  '交通': '#86a6a0',
  '购物': '#d5a074',
  '学习教育': '#83a7b9',
  '娱乐休闲': '#a29bbd',
  '话费通讯': '#97b4bf',
  '生活缴费': '#d6ae70',
  '医疗健康': '#98ad8e',
  '转账': '#aea1b4',
  '其他': '#b7b0a6',
};
const FALLBACK_COLOR = '#b7b0a6';
export const colorForCategory = (name) => Object.hasOwn(CATEGORY_COLOR_MAP, name) ? CATEGORY_COLOR_MAP[name] : FALLBACK_COLOR;

const INK = '#302b26', MUTE = '#8e847b', GRID = '#eee6dc';
let pie, trend;

export function renderCategoryPie(canvas, byCategory) {
  const labels = Object.keys(byCategory);
  const data = labels.map(k => byCategory[k]);
  const colors = labels.map(colorForCategory);
  if (pie) pie.destroy();
  pie = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{
      data,
      backgroundColor: colors,
      borderColor: '#fffdf9',
      borderWidth: 2,
      hoverOffset: 3,
    }] },
    options: {
      maintainAspectRatio: false,
      cutout: '64%',
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => {
              const total = data.reduce((a, b) => a + b, 0) || 1;
              const pct = (c.parsed / total * 100).toFixed(1);
              return ` ${c.label}：¥${c.parsed.toFixed(2)}（${pct}%）`;
            }
          }
        }
      }
    }
  });
}

export function renderTrend(canvas, byDay) {
  const labels = Object.keys(byDay).sort();
  const data = labels.map(k => byDay[k]);
  if (trend) trend.destroy();
  trend = new Chart(canvas, {
    type: 'bar',
    data: { labels: labels.map(d => d.slice(5)), datasets: [{
      label: '每日支出',
      data,
      backgroundColor: '#c1947d',
      hoverBackgroundColor: '#b15f45',
      borderRadius: 3,
      maxBarThickness: 18,
    }] },
    options: {
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ¥${c.parsed.y.toFixed(2)}` } }
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: MUTE, maxTicksLimit:7, font: { size: 10 } } },
        y: { beginAtZero: true, grid: { color: GRID }, border: { display: false },
          ticks: { color: MUTE, maxTicksLimit:4, font: { size: 10 } } }
      }
    }
  });
}
