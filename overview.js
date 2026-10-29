// Overview tab rendering. Loaded after lib.js, chart.js, and app.js globals.

function renderOverview(t){
  const balClass = t.balance < 0 ? 'negative' : 'positive';
  const budgets = (state.settings && state.settings.budgets) || {};
  const monthSpend = currentMonthByCategory(state.transactions, new Date());
  const catEntries = Object.entries(t.byCategory).sort((a,b)=>b[1]-a[1]);
  const maxCat = catEntries.length ? catEntries[0][1] : 1;

  const catRows = catEntries.length ? catEntries.map(([cat, amt]) => {
    const budget = budgets[cat];
    const spent = monthSpend[cat] || 0;
    const over = budget > 0 && spent > budget;
    const budgetInfo = budget > 0
      ? `<span class="budget-info${over ? ' over-budget' : ''}">${fmt(spent)} / ${fmt(budget)} this month${over ? ' — over budget!' : ''}</span>`
      : '';
    return `
    <div class="cat-row${over ? ' over-budget-row' : ''}">
      <div class="cat-top"><span>${escapeHtml(cat)}</span><span class="amt">${fmt(amt)}</span></div>
      ${budgetInfo}
      <div class="bar-track"><div class="bar-fill navy" style="width:${Math.round((amt/maxCat)*100)}%"></div></div>
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

  const chartSeries = monthlyExpenseSeries(state.transactions, new Date());
  const ieSeries = monthlyIncomeExpenseSeries(state.transactions, new Date());
  const balSeries = balanceOverTime(state.transactions, new Date());
  const hasBudgets = Object.keys(budgets).some(k => budgets[k] > 0);

  return `
    <div class="bento-grid">
      <div class="tile tile-balance">
        <div class="tile-label">Current Balance</div>
        <div class="tile-amount ${balClass}">${fmt(t.balance)}</div>
      </div>
      <div class="tile tile-income">
        <div class="tile-label">Income</div>
        <div class="tile-amount">${fmt(t.income)}</div>
      </div>
      <div class="tile tile-expense">
        <div class="tile-label">Expenses</div>
        <div class="tile-amount">${fmt(t.expense)}</div>
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
