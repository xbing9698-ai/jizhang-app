// 图表配色：按分类名固定映射（同一分类颜色恒定）
// The Ledger 刊物大地色系：低饱和、暖调、似印刷油墨，落在暖纸底上协调
const CATEGORY_COLOR_MAP = {
  '餐饮': '#8a2a33',      // 酒红（首要分类，呼应点缀）
  '交通': '#5a6b5a',      // 橄榄灰绿
  '购物': '#b0763f',      // 赭石焦糖
  '学习教育': '#4a5a6e',  // 黛蓝
  '娱乐休闲': '#c39a4e',  // 芥末金
  '话费通讯': '#6e8a82',  // 桉叶灰青
  '生活缴费': '#8a7a52',  // 卡其
  '医疗健康': '#a85a55',  // 陶土玫
  '转账': '#9a907c',      // 灰褐
  '其他': '#c8bca6',      // 浅灰褐
};
const FALLBACK_COLOR = '#c8bca6';
export const colorForCategory = (name) => Object.hasOwn(CATEGORY_COLOR_MAP, name) ? CATEGORY_COLOR_MAP[name] : FALLBACK_COLOR;

const INK = '#1c1a15', MUTE = '#9a907c', GRID = '#ddd4c2';
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
      borderColor: '#fbf9f2',
      borderWidth: 2,
      hoverOffset: 6,
    }] },
    options: {
      maintainAspectRatio: false,
      cutout: '64%',
      animation: { duration: 500 },
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
      backgroundColor: '#1c1a15',
      hoverBackgroundColor: '#8a2a33',
      borderRadius: 6,
      maxBarThickness: 28,
    }] },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ¥${c.parsed.y.toFixed(2)}` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: MUTE, font: { size: 11 } } },
        y: { beginAtZero: true, grid: { color: GRID }, border: { display: false },
          ticks: { color: MUTE, font: { size: 11 } } }
      }
    }
  });
}
