// Overview tab rendering. Loaded after lib.js, chart.js, and app.js globals.

function renderOverview(){
  const now = new Date();
  let from, to;
  if(overviewRange === 'custom'){
    from = customRange.from || '';
    to = customRange.to || '';
  } else {
    ({ from, to } = dateRange(overviewRange, now));
  }
  const filtered = from
    ? state.transactions.filter(tx => (!from || tx.date >= from) && (!to || tx.date <= to))
    : state.transactions;
  const t = sumTotals(filtered);

  const balClass = t.balance < 0 ? 'negative' : 'positive';
  const budgets = (state.settings && state.settings.budgets) || {};
  const monthSpend = currentMonthByCategory(state.transactions, now);
  const catEntries = Object.entries(t.byCategory).sort((a,b)=>b[1]-a[1]);
  const maxCat = catEntries.length ? catEntries[0][1] : 1;

  const RANGES = [
    { key: 'month', label: 'This month' },
    { key: 'lastmonth', label: 'Last month' },
    { key: 'quarter', label: 'Quarter' },
    { key: 'year', label: 'Year' },
    { key: 'all', label: 'All time' },
    { key: 'custom', label: 'Custom' }
  ];
  const customInputs = overviewRange === 'custom' ? `
    <div class="custom-range-inputs">
      <div class="field">
        <label for="custom-range-from">From</label>
        <input type="date" id="custom-range-from" value="${customRange.from}">
      </div>
      <div class="field">
        <label for="custom-range-to">To</label>
        <input type="date" id="custom-range-to" value="${customRange.to}">
      </div>
    </div>` : '';
  const rangePicker = `<div class="range-picker" role="group" aria-label="Date range">${
    RANGES.map(r => `<button type="button" class="range-btn${overviewRange === r.key ? ' active' : ''}" data-range="${r.key}">${r.label}</button>`).join('')
  }</div>${customInputs}`;

  // Budget alerts (always current month, independent of date range)
  const ALERT_THRESHOLD = 0.8;
  const alertRows = [];
  Object.keys(budgets).forEach(cat => {
    const budget = budgets[cat];
    if(budget <= 0) return;
    const spent = monthSpend[cat] || 0;
    const pct = spent / budget;
    if(pct >= 1){
      alertRows.push(`<div class="budget-alert over"><span class="alert-cat">${escapeHtml(cat)}</span> over budget — ${fmt(spent)} of ${fmt(budget)} spent</div>`);
    } else if(pct >= ALERT_THRESHOLD){
      alertRows.push(`<div class="budget-alert warn"><span class="alert-cat">${escapeHtml(cat)}</span> at ${Math.round(pct * 100)}% — ${fmt(spent)} of ${fmt(budget)} spent</div>`);
    }
  });
  const alertsHtml = alertRows.length
    ? `<div class="budget-alerts"><h3>Monthly budget alerts (${alertRows.length}) <button type="button" class="alerts-toggle" id="alerts-toggle">${alertsCollapsed ? 'Show' : 'Hide'}</button></h3>${alertsCollapsed ? '' : alertRows.join('')}</div>`
    : '';

  const catRows = catEntries.length ? catEntries.map(([cat, amt]) => {
    const budget = budgets[cat];
    const spent = monthSpend[cat] || 0;
    const over = budget > 0 && spent > budget;
    const budgetInfo = budget > 0
      ? `<span class="budget-info${over ? ' over-budget' : ''}">${fmt(spent)} / ${fmt(budget)} this month${over ? ' — over budget!' : ''}</span>`
      : '';
    return `
    <div class="cat-row cat-link${over ? ' over-budget-row' : ''}" data-cat-link="${escapeHtml(cat)}" role="button" tabindex="0" aria-label="View ${escapeHtml(cat)} transactions">
      <div class="cat-top"><span>${escapeHtml(cat)}</span><span class="amt">${fmt(amt)}</span></div>
      ${budgetInfo}
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round((amt/maxCat)*100)}%;background:${categoryColor(cat)}"></div></div>
    </div>`;
  }).join('') : `<div class="empty">No expenses logged yet. Add one from the Transactions tab.</div>`;

  const goalsSummary = state.goals.length ? state.goals.map(g => {
    const autoContrib = g.linkedCategory ? state.transactions.filter(tx => tx.type === 'income' && tx.category === g.linkedCategory).reduce((s, tx) => s + tx.amount, 0) : 0;
    const totalSaved = g.saved + autoContrib;
    const pct = g.target > 0 ? Math.min(100, Math.round((totalSaved / g.target)*100)) : 0;
    return `
      <div class="cat-row">
        <div class="cat-top"><span>${escapeHtml(g.name)}</span><span class="amt">${fmt(totalSaved)} / ${fmt(g.target)} (${pct}%)</span></div>
        <div class="bar-track"><div class="bar-fill gold" style="width:${pct}%"></div></div>
      </div>`;
  }).join('') : `<div class="empty">No savings goals yet. Set one from the Savings Goals tab.</div>`;

  // Transaction statistics
  const expenses = filtered.filter(tx => tx.type === 'expense');
  const expDays = new Set(expenses.map(tx => tx.date));
  const dayCount = expDays.size || 1;
  const avgDaily = expenses.length ? Math.round(t.expense / dayCount) : 0;
  const topDay = expenses.length
    ? Array.from(expDays).map(d => ({ d, total: expenses.filter(tx => tx.date === d).reduce((s, tx) => s + tx.amount, 0) })).sort((a, b) => b.total - a.total)[0]
    : null;
  const txCount = filtered.length;

  // Spending trends — compare this month vs last month
  const thisMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthPrefix = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const thisMonthExp = state.transactions.filter(tx => tx.type === 'expense' && tx.date.startsWith(thisMonthPrefix)).reduce((s, tx) => s + tx.amount, 0);
  const lastMonthExp = state.transactions.filter(tx => tx.type === 'expense' && tx.date.startsWith(lastMonthPrefix)).reduce((s, tx) => s + tx.amount, 0);
  let trendText = '';
  if(lastMonthExp > 0 && thisMonthExp > 0){
    const change = Math.round(((thisMonthExp - lastMonthExp) / lastMonthExp) * 100);
    if(change > 0) trendText = `Spending is up ${change}% vs last month (${fmt(thisMonthExp)} vs ${fmt(lastMonthExp)}).`;
    else if(change < 0) trendText = `Spending is down ${Math.abs(change)}% vs last month (${fmt(thisMonthExp)} vs ${fmt(lastMonthExp)}).`;
    else trendText = `Spending is flat vs last month (${fmt(thisMonthExp)}).`;
  } else if(thisMonthExp > 0){
    trendText = `${fmt(thisMonthExp)} spent so far this month.`;
  }

  const chartSeries = monthlyExpenseSeries(filtered, now);
  const ieSeries = monthlyIncomeExpenseSeries(filtered, now);
  const balSeries = balanceOverTime(filtered, now);
  const hasBudgets = Object.keys(budgets).some(k => budgets[k] > 0);

  let rangeLabel = RANGES.find(r => r.key === overviewRange).label;
  if(overviewRange === 'custom' && customRange.from && customRange.to){
    rangeLabel = customRange.from + ' — ' + customRange.to;
  } else if(overviewRange === 'custom'){
    rangeLabel = customRange.from || customRange.to || 'Custom';
  }

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
      <div style="flex:1">${rangePicker}</div>
      <button type="button" class="btn ghost" id="download-report-btn" style="font-size:0.78rem;padding:6px 14px;">Download report</button>
    </div>
    ${alertsHtml}
    ${trendText ? `<div class="trend-insight">${trendText}</div>` : ''}
    <div class="bento-grid">
      <div class="tile tile-balance">
        <div class="tile-label">Balance <span class="tile-range">${escapeHtml(rangeLabel)}</span></div>
        <div class="tile-amount ${balClass}">${fmt(t.balance)}</div>
      </div>
      <div class="tile tile-income">
        <div class="tile-label">Income <span class="tile-range">${escapeHtml(rangeLabel)}</span></div>
        <div class="tile-amount">${fmt(t.income)}</div>
      </div>
      <div class="tile tile-expense">
        <div class="tile-label">Expenses <span class="tile-range">${escapeHtml(rangeLabel)}</span></div>
        <div class="tile-amount">${fmt(t.expense)}</div>
      </div>
      <div class="tile tile-stats">
        <h2>Quick stats</h2>
        <div class="stat-row"><span>Transactions</span><span>${txCount}</span></div>
        <div class="stat-row"><span>Avg daily spend</span><span>${fmt(avgDaily)}</span></div>
        ${topDay ? `<div class="stat-row"><span>Top spending day</span><span>${topDay.d} (${fmt(topDay.total)})</span></div>` : ''}
        <div class="stat-row"><span>Days with expenses</span><span>${expDays.size}</span></div>
      </div>
      <div class="tile tile-categories">
        <h2>Spending by category</h2>
        ${catRows}
      </div>
      <div class="tile tile-chart">
        ${renderChart(chartSeries)}
      </div>
      <div class="tile tile-ie-chart">
        ${renderIncomeExpenseChart(ieSeries)}
      </div>
      <div class="tile tile-cat-chart">
        <h2>Expenses by category</h2>
        ${renderCategoryChart(t.byCategory)}
      </div>
      ${hasBudgets ? `<div class="tile tile-burndown">${renderBudgetBurndown(budgets, monthSpend)}</div>` : ''}
      <div class="tile tile-trend">
        ${renderBalanceTrend(balSeries)}
      </div>
      <div class="tile tile-goals">
        <h2>Savings goals</h2>
        ${goalsSummary}
      </div>
    </div>
  `;
}
