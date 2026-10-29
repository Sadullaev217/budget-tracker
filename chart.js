// Charts: bar chart (monthly expenses) and donut chart (category breakdown).
// Globals used: state, userCurrency, fmt, formatMoneyCompact, escapeHtml.

function renderChart(series){
  if(series.every(s => s.total === 0)){
    const anyExpenses = state.transactions.some(t => t.type === 'expense');
    return `<h2>Expenses by month</h2><div class="empty">${anyExpenses
      ? 'No expenses in the last 6 months.'
      : 'No expenses logged yet. Add one from the Transactions tab.'}</div>`;
  }
  const W = Math.max(260, Math.min(900, window.innerWidth - 32) - 50), H = 190;
  const padTop = 28, padBottom = 28, padSide = 8;
  const plotW = W - padSide*2;
  const plotH = H - padTop - padBottom;
  const max = Math.max(...series.map(s => s.total), 1);
  const n = series.length;
  const slot = plotW / n;
  const barW = Math.min(28, slot * 0.5);
  const baselineY = H - padBottom;
  const compact = slot < 72;
  const shortAmt = cents => formatMoneyCompact(cents, userCurrency());

  const bars = series.map((s, i) => {
    const cx = padSide + slot * i + slot / 2;
    const x = cx - barW / 2;
    const h = max > 0 ? (s.total / max) * plotH : 0;
    const y = baselineY - h;
    const r = Math.min(4, h);
    const path = h > 0
      ? `M${x},${baselineY} L${x},${y+r} Q${x},${y} ${x+r},${y} L${x+barW-r},${y} Q${x+barW},${y} ${x+barW},${y+r} L${x+barW},${baselineY} Z`
      : `M${x},${baselineY} L${x+barW},${baselineY}`;
    const valueText = fmt(s.total);
    return `
      <g class="chart-bar-group" tabindex="0" role="img" aria-label="${s.label}: ${valueText}" data-month="${s.label}" data-value="${valueText}" data-cx="${cx}" data-top="${y}">
        <text class="chart-value-label" x="${cx}" y="${Math.max(y-6, 12)}" text-anchor="middle">${compact ? shortAmt(s.total) : valueText}</text>
        <path class="chart-bar" d="${path}"></path>
        <text class="chart-axis-label" x="${cx}" y="${H-8}" text-anchor="middle" aria-hidden="true">${s.label}</text>
        <rect class="chart-hit" x="${padSide + slot*i}" y="${padTop}" width="${slot}" height="${plotH+padBottom}"></rect>
      </g>
    `;
  }).join('');

  return `
    <h2>Expenses by month</h2>
    <div class="chart-wrap">
      <svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        <line class="chart-baseline" x1="${padSide}" y1="${baselineY}" x2="${W-padSide}" y2="${baselineY}"></line>
        ${bars}
      </svg>
      <div class="chart-tooltip" id="chart-tooltip"></div>
    </div>
  `;
}

function renderCategoryChart(byCategory){
  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  if(!entries.length) return '<div class="empty">No expenses to chart yet.</div>';
  const total = entries.reduce((s, [, v]) => s + v, 0);
  const colors = ['#f87171','#60a5fa','#34d399','#fbbf24','#a78bfa','#fb923c','#f472b6','#38bdf8','#4ade80','#facc15'];
  const R = 70, cx = 90, cy = 90;
  let startAngle = -Math.PI / 2;
  const slices = entries.map(([cat, amt], i) => {
    const frac = amt / total;
    const angle = frac * Math.PI * 2;
    const endAngle = startAngle + angle;
    const large = angle > Math.PI ? 1 : 0;
    const x1 = cx + R * Math.cos(startAngle), y1 = cy + R * Math.sin(startAngle);
    const x2 = cx + R * Math.cos(endAngle), y2 = cy + R * Math.sin(endAngle);
    const color = colors[i % colors.length];
    const path = entries.length === 1
      ? `<circle cx="${cx}" cy="${cy}" r="${R}" fill="${color}" opacity="0.85"/>`
      : `<path d="M${cx},${cy} L${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} Z" fill="${color}" opacity="0.85"/>`;
    startAngle = endAngle;
    return { path, cat, amt, pct: Math.round(frac * 100), color };
  });
  const legend = slices.map(s =>
    `<div class="chart-legend-item"><span class="legend-dot" style="background:${s.color}"></span>${escapeHtml(s.cat)} <span class="legend-pct">${s.pct}%</span></div>`
  ).join('');
  return `
    <div class="cat-chart-wrap">
      <svg viewBox="0 0 180 180" class="cat-chart-svg">${slices.map(s => s.path).join('')}<circle cx="${cx}" cy="${cy}" r="40" fill="var(--card-bg)"/><text x="${cx}" y="${cy + 5}" text-anchor="middle" fill="var(--fg)" font-size="13" font-weight="600">${formatMoneyCompact(total, userCurrency())}</text></svg>
      <div class="chart-legend">${legend}</div>
    </div>`;
}

function attachChartHandlers(){
  const barGroups = document.querySelectorAll('.chart-bar-group');
  if(!barGroups.length) return;
  const svg = document.querySelector('.chart-svg');
  const wrap = document.querySelector('.chart-wrap');
  const tooltip = document.getElementById('chart-tooltip');
  const showTip = (g) => {
    const svgRect = svg.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const scaleX = svgRect.width / vb.width;
    const scaleY = svgRect.height / vb.height;
    const px = (svgRect.left - wrapRect.left) + parseFloat(g.dataset.cx) * scaleX;
    const py = (svgRect.top - wrapRect.top) + parseFloat(g.dataset.top) * scaleY;
    tooltip.innerHTML = '';
    tooltip.appendChild(document.createTextNode(g.dataset.month + ' — '));
    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = g.dataset.value;
    tooltip.appendChild(val);
    tooltip.style.left = px + 'px';
    tooltip.style.top = (py - 8) + 'px';
    tooltip.classList.add('visible');
  };
  const hideTip = () => tooltip.classList.remove('visible');
  barGroups.forEach(g => {
    g.addEventListener('pointerenter', () => showTip(g));
    g.addEventListener('pointerleave', hideTip);
    g.addEventListener('focus', () => showTip(g));
    g.addEventListener('blur', hideTip);
  });
}
