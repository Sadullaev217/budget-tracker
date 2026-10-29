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
  const R = 70, cx = 90, cy = 90;
  let startAngle = -Math.PI / 2;
  const slices = entries.map(([cat, amt], i) => {
    const frac = amt / total;
    const angle = frac * Math.PI * 2;
    const endAngle = startAngle + angle;
    const large = angle > Math.PI ? 1 : 0;
    const x1 = cx + R * Math.cos(startAngle), y1 = cy + R * Math.sin(startAngle);
    const x2 = cx + R * Math.cos(endAngle), y2 = cy + R * Math.sin(endAngle);
    const color = categoryColor(cat);
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

function renderIncomeExpenseChart(series){
  const hasData = series.some(s => s.income > 0 || s.expense > 0);
  if(!hasData){
    return `<h2>Income vs. Expenses</h2><div class="empty">Not enough data yet. Add some transactions first.</div>`;
  }
  const W = Math.max(260, Math.min(900, window.innerWidth - 32) - 50), H = 210;
  const padTop = 32, padBottom = 28, padSide = 8;
  const plotW = W - padSide*2, plotH = H - padTop - padBottom;
  const max = Math.max(...series.map(s => Math.max(s.income, s.expense)), 1);
  const n = series.length;
  const slot = plotW / n;
  const barW = Math.min(14, slot * 0.28);
  const gap = Math.min(4, barW * 0.3);
  const baselineY = H - padBottom;
  const shortAmt = cents => formatMoneyCompact(cents, userCurrency());

  const bars = series.map((s, i) => {
    const cx = padSide + slot * i + slot / 2;
    const hInc = max > 0 ? (s.income / max) * plotH : 0;
    const hExp = max > 0 ? (s.expense / max) * plotH : 0;
    const rInc = Math.min(4, hInc), rExp = Math.min(4, hExp);
    const xInc = cx - barW - gap/2, xExp = cx + gap/2;
    const yInc = baselineY - hInc, yExp = baselineY - hExp;
    const pathInc = hInc > 0
      ? `M${xInc},${baselineY} L${xInc},${yInc+rInc} Q${xInc},${yInc} ${xInc+rInc},${yInc} L${xInc+barW-rInc},${yInc} Q${xInc+barW},${yInc} ${xInc+barW},${yInc+rInc} L${xInc+barW},${baselineY} Z`
      : `M${xInc},${baselineY} L${xInc+barW},${baselineY}`;
    const pathExp = hExp > 0
      ? `M${xExp},${baselineY} L${xExp},${yExp+rExp} Q${xExp},${yExp} ${xExp+rExp},${yExp} L${xExp+barW-rExp},${yExp} Q${xExp+barW},${yExp} ${xExp+barW},${yExp+rExp} L${xExp+barW},${baselineY} Z`
      : `M${xExp},${baselineY} L${xExp+barW},${baselineY}`;
    return `
      <g class="ie-bar-group" tabindex="0" role="img" aria-label="${s.label}: income ${fmt(s.income)}, expenses ${fmt(s.expense)}" data-month="${s.label}" data-income="${fmt(s.income)}" data-expense="${fmt(s.expense)}" data-cx="${cx}" data-top="${Math.min(yInc, yExp)}">
        <text class="chart-value-label" x="${xInc + barW/2}" y="${Math.max(yInc-4, 10)}" text-anchor="middle" fill="var(--income-text)" font-size="9">${s.income ? shortAmt(s.income) : ''}</text>
        <path class="chart-bar income-bar" d="${pathInc}" fill="var(--income-text)" opacity="0.75"></path>
        <text class="chart-value-label" x="${xExp + barW/2}" y="${Math.max(yExp-4, 10)}" text-anchor="middle" fill="var(--expense-text)" font-size="9">${s.expense ? shortAmt(s.expense) : ''}</text>
        <path class="chart-bar expense-bar" d="${pathExp}" fill="var(--expense-text)" opacity="0.75"></path>
        <text class="chart-axis-label" x="${cx}" y="${H-8}" text-anchor="middle" aria-hidden="true">${s.label}</text>
        <rect class="chart-hit" x="${padSide + slot*i}" y="${padTop}" width="${slot}" height="${plotH+padBottom}"></rect>
      </g>
    `;
  }).join('');

  return `
    <h2>Income vs. Expenses</h2>
    <div class="chart-legend-inline">
      <span class="legend-dot" style="background:var(--income-text)"></span> Income
      <span class="legend-dot" style="background:var(--expense-text);margin-left:12px;"></span> Expenses
    </div>
    <div class="chart-wrap ie-chart-wrap">
      <svg class="chart-svg ie-chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        <line class="chart-baseline" x1="${padSide}" y1="${baselineY}" x2="${W-padSide}" y2="${baselineY}"></line>
        ${bars}
      </svg>
      <div class="chart-tooltip" id="ie-chart-tooltip"></div>
    </div>
  `;
}

function renderBalanceTrend(series){
  const hasData = series.some(s => s.balance !== 0);
  if(!hasData){
    return `<h2>Balance trend</h2><div class="empty">Your running balance will appear here once you have transactions across multiple months.</div>`;
  }
  const W = Math.max(260, Math.min(900, window.innerWidth - 32) - 50), H = 180;
  const padTop = 28, padBottom = 28, padLeft = 8, padRight = 8;
  const plotW = W - padLeft - padRight, plotH = H - padTop - padBottom;
  const vals = series.map(s => s.balance);
  const minVal = Math.min(0, ...vals), maxVal = Math.max(0, ...vals);
  const range = maxVal - minVal || 1;
  const n = series.length;
  const slot = plotW / n;

  const toY = v => padTop + plotH - ((v - minVal) / range) * plotH;
  const zeroY = toY(0);

  const points = series.map((s, i) => ({
    x: padLeft + slot * i + slot / 2,
    y: toY(s.balance),
    ...s
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = `${linePath} L${points[points.length-1].x},${zeroY} L${points[0].x},${zeroY} Z`;

  const dots = points.map(p => {
    const cls = p.balance >= 0 ? 'net-positive' : 'net-negative';
    return `
      <g class="trend-point" tabindex="0" role="img" aria-label="${p.label}: ${fmt(Math.abs(p.balance))} ${p.balance >= 0 ? 'positive' : 'negative'}" data-month="${p.label}" data-value="${fmt(p.balance)}" data-cx="${p.x}" data-top="${p.y}">
        <circle cx="${p.x}" cy="${p.y}" r="4" fill="var(--accent)"></circle>
        <text class="chart-value-label" x="${p.x}" y="${p.y - 10}" text-anchor="middle" font-size="10">${formatMoneyCompact(p.balance, userCurrency())}</text>
        <rect class="chart-hit" x="${p.x - slot/2}" y="${padTop}" width="${slot}" height="${plotH + padBottom}"></rect>
      </g>
    `;
  }).join('');

  const labels = points.map(p =>
    `<text class="chart-axis-label" x="${p.x}" y="${H - 8}" text-anchor="middle">${p.label}</text>`
  ).join('');

  return `
    <h2>Balance trend</h2>
    <div class="chart-wrap trend-chart-wrap">
      <svg class="chart-svg trend-chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        <line class="chart-baseline" x1="${padLeft}" y1="${zeroY}" x2="${W-padRight}" y2="${zeroY}" stroke-dasharray="4 3"></line>
        <path d="${areaPath}" fill="var(--accent)" opacity="0.1"></path>
        <path d="${linePath}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
        ${dots}
        ${labels}
      </svg>
      <div class="chart-tooltip" id="trend-tooltip"></div>
    </div>
  `;
}

function renderBudgetBurndown(budgets, monthSpend){
  const entries = Object.entries(budgets).filter(([, b]) => b > 0);
  if(!entries.length) return '';
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const monthProgress = Math.round((dayOfMonth / daysInMonth) * 100);

  const rows = entries.map(([cat, budget]) => {
    const spent = monthSpend[cat] || 0;
    const pct = Math.min(100, Math.round((spent / budget) * 100));
    const over = spent > budget;
    const onTrack = pct <= monthProgress + 10;
    const statusCls = over ? 'burn-over' : onTrack ? 'burn-ok' : 'burn-warn';
    return `
      <div class="burn-row ${statusCls}">
        <div class="burn-header">
          <span class="burn-cat">${escapeHtml(cat)}</span>
          <span class="burn-nums">${fmt(spent)} / ${fmt(budget)}</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill ${over ? 'red' : onTrack ? 'green' : 'amber'}" style="width:${pct}%"></div>
          <div class="burn-marker" style="left:${monthProgress}%" aria-label="Day ${dayOfMonth} of ${daysInMonth}"></div>
        </div>
        <div class="burn-status">${over ? `Over by ${fmt(spent - budget)}` : `${fmt(budget - spent)} remaining`} · ${pct}% used, ${monthProgress}% through month</div>
      </div>
    `;
  }).join('');

  return `
    <h2>Budget burn-down</h2>
    <p class="card-help">Day ${dayOfMonth} of ${daysInMonth} (${monthProgress}% through the month). The marker shows where you should be.</p>
    ${rows}
  `;
}

function wireTooltip(wrapSel, tipId, groups, formatter){
  const wrap = document.querySelector(wrapSel);
  const tip = document.getElementById(tipId);
  if(!wrap || !tip || !groups.length) return;
  const svg = wrap.querySelector('svg');
  const showTip = (g) => {
    const svgRect = svg.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const scaleX = svgRect.width / vb.width;
    const scaleY = svgRect.height / vb.height;
    const px = (svgRect.left - wrapRect.left) + parseFloat(g.dataset.cx) * scaleX;
    const py = (svgRect.top - wrapRect.top) + parseFloat(g.dataset.top) * scaleY;
    tip.innerHTML = formatter(g);
    tip.style.left = px + 'px';
    tip.style.top = (py - 8) + 'px';
    tip.classList.add('visible');
  };
  const hideTip = () => tip.classList.remove('visible');
  groups.forEach(g => {
    g.addEventListener('pointerenter', () => showTip(g));
    g.addEventListener('pointerleave', hideTip);
    g.addEventListener('focus', () => showTip(g));
    g.addEventListener('blur', hideTip);
  });
}

function attachChartHandlers(){
  wireTooltip('.chart-wrap:not(.ie-chart-wrap):not(.trend-chart-wrap)', 'chart-tooltip',
    document.querySelectorAll('.chart-bar-group'),
    g => `${escapeHtml(g.dataset.month)} — <span class="val">${escapeHtml(g.dataset.value)}</span>`
  );
  wireTooltip('.ie-chart-wrap', 'ie-chart-tooltip',
    document.querySelectorAll('.ie-bar-group'),
    g => `${escapeHtml(g.dataset.month)}<br><span style="color:var(--income-text)">+${escapeHtml(g.dataset.income)}</span> · <span style="color:var(--expense-text)">-${escapeHtml(g.dataset.expense)}</span>`
  );
  wireTooltip('.trend-chart-wrap', 'trend-tooltip',
    document.querySelectorAll('.trend-point'),
    g => `${escapeHtml(g.dataset.month)} — <span class="val">${escapeHtml(g.dataset.value)}</span>`
  );
}
