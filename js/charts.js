// 图表配色：按分类名固定映射（同一分类颜色恒定）
// 低饱和色与浅白界面协调；颜色只影响显示，不改变分类与金额。
const CATEGORY_COLOR_MAP = {
  '餐饮': '#91686a',
  '交通': '#8a998e',
  '购物': '#b5a18c',
  '学习教育': '#919ba8',
  '娱乐休闲': '#b3a18e',
  '话费通讯': '#9ca9a5',
  '生活缴费': '#ada795',
  '医疗健康': '#aa8889',
  '转账': '#a5a0a5',
  '其他': '#cbc5bd',
};
const FALLBACK_COLOR = '#cbc5bd';
export const colorForCategory = (name) => Object.hasOwn(CATEGORY_COLOR_MAP, name) ? CATEGORY_COLOR_MAP[name] : FALLBACK_COLOR;

const INK = '#383531', MUTE = '#87817a', GRID = '#efeeeb';
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
      borderColor: '#ffffff',
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
      backgroundColor: '#948d84',
      hoverBackgroundColor: '#865456',
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
