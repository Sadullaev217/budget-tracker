// Pure helpers with no DOM or storage access. Loaded as a classic script in the
// browser (functions become globals) and require()-able from Node for tests.

// Money is stored as integer cents (v2 data) so sums are exact: 10 + 20 === 30.
// With dollar floats, 0.1 + 0.2 is 0.30000000000000004.
const DATA_VERSION = 2;

function toCents(value){
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

// Validation message for a money input, or '' if it's a valid positive amount.
function amountError(raw, emptyMsg = 'Enter an amount.'){
  if(String(raw).trim() === '') return emptyMsg;
  const cents = toCents(raw);
  return Number.isFinite(cents) && cents > 0 ? '' : 'Enter an amount greater than 0.';
}

// Amounts are stored in cents, so only currencies with 2 minor digits are offered.
const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'INR', 'UZS'];
const DEFAULT_CURRENCY = 'USD';

const moneyFormatters = new Map();
function moneyFormatter(currency, locale, compact){
  const key = `${currency}|${locale || ''}|${compact ? 'c' : ''}`;
  if(!moneyFormatters.has(key)){
    moneyFormatters.set(key, new Intl.NumberFormat(locale, compact
      ? { style: 'currency', currency, currencyDisplay: 'narrowSymbol', notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 }
      : { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  }
  return moneyFormatters.get(key);
}
function formatMoney(cents, currency = DEFAULT_CURRENCY, locale){
  return moneyFormatter(currency, locale, false).format(cents / 100);
}
// Short form for tight spaces like chart labels: $2.2K, €950.
function formatMoneyCompact(cents, currency = DEFAULT_CURRENCY, locale){
  return moneyFormatter(currency, locale, true).format(cents / 100);
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

// Validate a parsed backup file. Returns { data } (migrated to the current
// version) or { error } with a message suitable for showing to the user.
function parseBackup(obj){
  if(!obj || typeof obj !== 'object' || Array.isArray(obj)) return { error: 'That file is not a Ledger backup.' };
  if(!Array.isArray(obj.transactions) || !Array.isArray(obj.goals)) return { error: 'That file is not a Ledger backup (no transactions or goals list).' };
  if(typeof obj.v === 'number' && obj.v > DATA_VERSION) return { error: 'This backup was made by a newer version of the app.' };
  const okTx = t => t && typeof t === 'object' && (t.type === 'income' || t.type === 'expense')
    && /^\d{4}-\d{2}-\d{2}$/.test(String(t.date)) && Number.isFinite(Number(t.amount));
  const okGoal = g => g && typeof g === 'object' && typeof g.name === 'string'
    && Number.isFinite(Number(g.target)) && Number.isFinite(Number(g.saved));
  const badTx = obj.transactions.findIndex(t => !okTx(t));
  if(badTx >= 0) return { error: `Transaction ${badTx + 1} in the file is invalid.` };
  const badGoal = obj.goals.findIndex(g => !okGoal(g));
  if(badGoal >= 0) return { error: `Goal ${badGoal + 1} in the file is invalid.` };
  const { data } = migrateData(obj);
  const settings = {};
  if(obj.settings && CURRENCIES.includes(obj.settings.currency)) settings.currency = obj.settings.currency;
  if(obj.settings && typeof obj.settings.budgets === 'object' && !Array.isArray(obj.settings.budgets)) settings.budgets = obj.settings.budgets;
  if(obj.settings && Array.isArray(obj.settings.customExpenseCats)) settings.customExpenseCats = obj.settings.customExpenseCats.map(String);
  if(obj.settings && Array.isArray(obj.settings.customIncomeCats)) settings.customIncomeCats = obj.settings.customIncomeCats.map(String);
  data.transactions = data.transactions.map(t => ({
    id: String(t.id || ''), type: t.type, amount: Math.round(Number(t.amount)),
    category: String(t.category || 'Other'), date: String(t.date), note: String(t.note || '')
  }));
  data.goals = data.goals.map(g => ({ id: String(g.id || ''), name: g.name, target: Math.round(Number(g.target)), saved: Math.round(Number(g.saved)) }));
  const recurring = Array.isArray(data.recurring) ? data.recurring : [];
  const recurringGenerated = (data.recurringGenerated && typeof data.recurringGenerated === 'object' && !Array.isArray(data.recurringGenerated)) ? data.recurringGenerated : {};
  return { data: { v: DATA_VERSION, transactions: data.transactions, goals: data.goals, settings, recurring, recurringGenerated } };
}

// CSV of transactions with amounts in dollars. Fields are quoted, and cells
// starting with = + - @ are prefixed with ' so spreadsheets don't run them as formulas.
function transactionsToCSV(transactions){
  const cell = v => {
    let s = String(v);
    if(/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const rows = [['date', 'type', 'category', 'amount', 'note']];
  transactions.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0).forEach(t => {
    rows.push([t.date, t.type, t.category, (t.amount / 100).toFixed(2), t.note || '']);
  });
  return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

// Case-insensitive text match on note and category, plus exact type/category filters.
function filterTransactions(transactions, { query = '', type = 'all', category = 'all', dateFrom = '', dateTo = '' } = {}){
  const q = String(query).trim().toLowerCase();
  const from = dateFrom || '';
  const to = dateTo || '';
  return transactions.filter(t =>
    (type === 'all' || t.type === type) &&
    (category === 'all' || t.category === category) &&
    (!from || String(t.date) >= from) &&
    (!to || String(t.date) <= to) &&
    (!q || String(t.note || '').toLowerCase().includes(q) || String(t.category || '').toLowerCase().includes(q))
  );
}

// Expenses for the current calendar month, grouped by category.
function currentMonthByCategory(transactions, now){
  const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const byCategory = {};
  transactions.forEach(t => {
    if(t.type === 'expense' && String(t.date).startsWith(prefix)){
      byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
    }
  });
  return byCategory;
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

function monthlyIncomeExpenseSeries(transactions, now, months = 6){
  const inc = {}, exp = {};
  transactions.forEach(tx => {
    const key = String(tx.date).slice(0, 7);
    if(tx.type === 'income') inc[key] = (inc[key] || 0) + tx.amount;
    else exp[key] = (exp[key] || 0) + tx.amount;
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
    income: inc[key] || 0,
    expense: exp[key] || 0
  }));
}

function balanceOverTime(transactions, now, months = 6){
  const byMonth = {};
  transactions.forEach(tx => {
    const key = String(tx.date).slice(0, 7);
    if(!byMonth[key]) byMonth[key] = 0;
    byMonth[key] += tx.type === 'income' ? tx.amount : -tx.amount;
  });
  const keys = [];
  for(let i = months - 1; i >= 0; i--){
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push({ d, key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` });
  }
  const spansYears = keys[0].d.getFullYear() !== keys[keys.length - 1].d.getFullYear();
  let running = 0;
  transactions.forEach(tx => {
    const key = String(tx.date).slice(0, 7);
    if(key < keys[0].key) running += tx.type === 'income' ? tx.amount : -tx.amount;
  });
  return keys.map(({ d, key }) => {
    running += byMonth[key] || 0;
    return {
      key,
      label: spansYears
        ? d.toLocaleString(undefined, { month: 'short', year: '2-digit' })
        : d.toLocaleString(undefined, { month: 'short' }),
      balance: running
    };
  });
}

function mergeCats(builtIn, custom){
  if(!custom || !custom.length) return builtIn;
  return [...builtIn, ...custom.filter(c => !builtIn.includes(c))];
}

function generateRecurringEntries(recurring, recurringGenerated, now, idFn){
  if(!recurring || !recurring.length) return { entries: [], generated: {} };
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const entries = [];
  const newGenerated = {};
  recurring.forEach(r => {
    const genKey = `${r.id}:${monthKey}`;
    if(recurringGenerated[genKey]) return;
    const day = Math.min(r.dayOfMonth || 1, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());
    const date = `${monthKey}-${String(day).padStart(2, '0')}`;
    entries.push({
      id: idFn(), type: r.type, amount: r.amount, category: r.category,
      date, note: r.note ? `${r.note} (recurring)` : '(recurring)'
    });
    newGenerated[genKey] = true;
  });
  return { entries, generated: newGenerated };
}

function isOverBudget(spent, budget){
  return budget > 0 && spent > budget;
}

if(typeof module !== 'undefined' && module.exports){
  module.exports = { DATA_VERSION, CURRENCIES, DEFAULT_CURRENCY, toCents, amountError, formatMoney, formatMoneyCompact, localISO, escapeHtml, migrateData, parseBackup, transactionsToCSV, filterTransactions, currentMonthByCategory, sumTotals, sumDay, monthlyExpenseSeries, monthlyIncomeExpenseSeries, balanceOverTime, mergeCats, generateRecurringEntries, isOverBudget };
}
