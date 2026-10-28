// Pure helpers with no DOM or storage access. Loaded as a classic script in the
// browser (functions become globals) and require()-able from Node for tests.

// Money is stored as integer cents (v2 data) so sums are exact: 10 + 20 === 30.
// With dollar floats, 0.1 + 0.2 is 0.30000000000000004.
const DATA_VERSION = 2;

function toCents(value){
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

function fmt(cents){
  const neg = cents < 0;
  const v = (Math.abs(cents) / 100).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
  return (neg ? '-' : '') + '$' + v;
}

// Local calendar date as YYYY-MM-DD. (toISOString() is UTC, which flips to
// "tomorrow" in the evening for anyone west of Greenwich.)
function localISO(d){
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Bring stored data up to DATA_VERSION. v1 stored dollar floats; v2 stores cents.
// Returns { data, changed } and never converts twice.
function migrateData(data){
  const out = {
    ...data,
    transactions: Array.isArray(data && data.transactions) ? data.transactions : [],
    goals: Array.isArray(data && data.goals) ? data.goals : []
  };
  if(out.v === DATA_VERSION) return { data: out, changed: false };
  const c = x => Math.round((Number(x) || 0) * 100);
  out.transactions = out.transactions.map(t => ({ ...t, amount: c(t.amount) }));
  out.goals = out.goals.map(g => ({ ...g, target: c(g.target), saved: c(g.saved) }));
  out.v = DATA_VERSION;
  return { data: out, changed: true };
}

function sumTotals(transactions){
  let income = 0, expense = 0;
  const byCategory = {};
  transactions.forEach(t => {
    if(t.type === 'income') income += t.amount;
    else {
      expense += t.amount;
      byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
    }
  });
  return { income, expense, balance: income - expense, byCategory };
}

function sumDay(transactions, dateStr){
  let income = 0, expense = 0;
  transactions.forEach(tx => {
    if(tx.date !== dateStr) return;
    if(tx.type === 'income') income += tx.amount; else expense += tx.amount;
  });
  return { income, expense, net: income - expense };
}

// Expenses for the `months` consecutive calendar months ending with `now`'s month.
// Months with no expenses are included as 0 so gaps are visible on the chart.
function monthlyExpenseSeries(transactions, now, months = 6){
  const buckets = {};
  transactions.forEach(tx => {
    if(tx.type !== 'expense') return;
    const key = String(tx.date).slice(0, 7);
    buckets[key] = (buckets[key] || 0) + tx.amount;
  });
  const keys = [];
  for(let i = months - 1; i >= 0; i--){
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push({ d, key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` });
  }
  const spansYears = keys[0].d.getFullYear() !== keys[keys.length - 1].d.getFullYear();
  return keys.map(({ d, key }) => ({
    key,
    label: spansYears
      ? d.toLocaleString(undefined, { month: 'short', year: '2-digit' })
      : d.toLocaleString(undefined, { month: 'short' }),
    total: buckets[key] || 0
  }));
}

if(typeof module !== 'undefined' && module.exports){
  module.exports = { DATA_VERSION, toCents, fmt, localISO, escapeHtml, migrateData, sumTotals, sumDay, monthlyExpenseSeries };
}
