// Transactions tab: ledger rendering, inline edit, filters, settings,
// budgets, recurring, and backup.
// Globals used: state, editingId, txType, txFilter, backupStatus,
//   pendingFocus, escapeHtml, fmt, formatMoney, formatMoneyCompact,
//   userCurrency, toCents, amountError, filterTransactions, sumTotals,
//   transactionsToCSV, CURRENCIES, DATA_VERSION, EXPENSE_CATS, INCOME_CATS,
//   expenseCats, incomeCats, todayISO, uid, save, render, addTransaction,
//   validateFields, clearFields, hideToast, showUndoToast, generateRecurring,
//   currentUser, monthKey.

let editingId = null;
let editingRecurringId = null;
const EDIT_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

function renderLedgerLine(tx){
  if(tx.id === editingId) return renderEditForm(tx);
  const label = escapeHtml(tx.note || tx.category);
  const kind = tx.type === 'expense' ? 'expense' : 'income';
  return `
    <div class="ledger-line">
      <div class="info">
        <span class="desc">${label}</span>
        <span class="cat-tag">${escapeHtml(tx.category)}</span>
      </div>
      <div class="right">
        <span class="amt ${tx.type}">${tx.type==='expense'?'-':'+'}${fmt(tx.amount)}</span>
        <button type="button" class="del edit" data-edit="${tx.id}" aria-label="Edit ${label} entry, ${kind} of ${fmt(tx.amount)}">${EDIT_ICON}</button>
        <button type="button" class="del" data-del="${tx.id}" aria-label="Delete ${label} entry, ${kind} of ${fmt(tx.amount)}"><span aria-hidden="true">✕</span></button>
      </div>
    </div>
  `;
}

function categoryOptions(type, selected){
  const cats = type === 'income' ? incomeCats() : expenseCats();
  const list = cats.includes(selected) || !selected ? cats : [selected, ...cats];
  return list.map(c => `<option value="${escapeHtml(c)}"${c === selected ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
}

function renderEditForm(tx){
  return `
    <form class="ledger-line editing" id="edit-form" data-edit-form="${tx.id}" aria-label="Edit entry" novalidate>
      <div class="form-row">
        <div class="field">
          <label for="edit-type">Type</label>
          <select id="edit-type">
            <option value="expense"${tx.type === 'expense' ? ' selected' : ''}>Expense</option>
            <option value="income"${tx.type === 'income' ? ' selected' : ''}>Income</option>
          </select>
        </div>
        <div class="field">
          <label for="edit-amount">Amount</label>
          <input type="number" id="edit-amount" step="0.01" min="0" inputmode="decimal" value="${(tx.amount / 100).toFixed(2)}">
        </div>
        <div class="field">
          <label for="edit-category">Category</label>
          <select id="edit-category">${categoryOptions(tx.type, tx.category)}</select>
        </div>
        <div class="field">
          <label for="edit-date">Date</label>
          <input type="date" id="edit-date" value="${tx.date}">
        </div>
      </div>
      <div class="form-row">
        <div class="field" style="flex: 3;">
          <label for="edit-note">Note (optional)</label>
          <input type="text" id="edit-note" value="${escapeHtml(tx.note || '')}">
        </div>
      </div>
      <div class="edit-actions">
        <button type="submit" class="btn">Save</button>
        <button type="button" class="btn ghost" id="edit-cancel">Cancel</button>
      </div>
    </form>
  `;
}

const EDIT_FIELDS = ['edit-type', 'edit-amount', 'edit-category', 'edit-date', 'edit-note'];
function startEdit(id){
  clearFields(EDIT_FIELDS);
  editingId = id;
  pendingFocus = '#edit-amount';
  render();
}
function stopEdit(){
  const id = editingId;
  clearFields(EDIT_FIELDS);
  editingId = null;
  pendingFocus = id ? `[data-edit="${CSS.escape(id)}"]` : null;
  render();
}
function saveEdit(){
  const tx = state.transactions.find(t => t.id === editingId);
  if(!tx){ stopEdit(); return; }
  const amountEl = document.getElementById('edit-amount');
  const dateEl = document.getElementById('edit-date');
  const ok = validateFields([
    [amountEl, amountError(amountEl.value)],
    [dateEl, /^\d{4}-\d{2}-\d{2}$/.test(dateEl.value) ? '' : 'Choose a date.']
  ]);
  if(!ok) return;
  tx.type = document.getElementById('edit-type').value === 'income' ? 'income' : 'expense';
  tx.amount = toCents(amountEl.value);
  tx.category = document.getElementById('edit-category').value;
  tx.date = dateEl.value;
  tx.note = document.getElementById('edit-note').value.trim();
  save();
  stopEdit();
}

function renderRecurringEditForm(r){
  const cats = r.type === 'income' ? incomeCats() : expenseCats();
  const catOpts = cats.map(c => `<option value="${escapeHtml(c)}"${c === r.category ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
  return `
    <form class="ledger-line editing" id="rec-edit-form">
      <div class="form-row">
        <div class="field" style="flex: 0 0 110px;">
          <label for="rec-edit-type">Type</label>
          <select id="rec-edit-type">
            <option value="expense"${r.type==='expense'?' selected':''}>Expense</option>
            <option value="income"${r.type==='income'?' selected':''}>Income</option>
          </select>
        </div>
        <div class="field">
          <label for="rec-edit-amount">Amount</label>
          <input type="number" id="rec-edit-amount" step="0.01" min="0" value="${(r.amount/100).toFixed(2)}" inputmode="decimal">
        </div>
        <div class="field">
          <label for="rec-edit-category">Category</label>
          <select id="rec-edit-category">${catOpts}</select>
        </div>
        <div class="field" style="flex: 0 0 90px;">
          <label for="rec-edit-day">Day</label>
          <input type="number" id="rec-edit-day" min="1" max="31" value="${r.dayOfMonth || 1}">
        </div>
      </div>
      <div class="form-row">
        <div class="field" style="flex: 3;">
          <label for="rec-edit-note">Note (optional)</label>
          <input type="text" id="rec-edit-note" value="${escapeHtml(r.note || '')}">
        </div>
      </div>
      <div class="edit-actions">
        <button type="submit" class="btn">Save</button>
        <button type="button" class="btn ghost" id="rec-edit-cancel">Cancel</button>
      </div>
    </form>
  `;
}

function startRecurringEdit(id){
  editingRecurringId = id;
  pendingFocus = '#rec-edit-amount';
  render();
}
function stopRecurringEdit(){
  const id = editingRecurringId;
  editingRecurringId = null;
  pendingFocus = id ? `[data-edit-recurring="${CSS.escape(id)}"]` : null;
  render();
}
function saveRecurringEdit(){
  const r = (state.recurring || []).find(x => x.id === editingRecurringId);
  if(!r){ stopRecurringEdit(); return; }
  const amountEl = document.getElementById('rec-edit-amount');
  if(!validateFields([[amountEl, amountError(amountEl.value)]])) return;
  r.type = document.getElementById('rec-edit-type').value === 'income' ? 'income' : 'expense';
  r.amount = toCents(amountEl.value);
  r.category = document.getElementById('rec-edit-category').value;
  r.dayOfMonth = Math.max(1, Math.min(31, parseInt(document.getElementById('rec-edit-day').value, 10) || 1));
  r.note = document.getElementById('rec-edit-note').value.trim();
  save();
  stopRecurringEdit();
}

function renderRecurringPreview(){
  if(!state.recurring || !state.recurring.length) return '';
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthLabel = nextMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const daysInMonth = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
  const entries = state.recurring.map(r => {
    const day = Math.min(r.dayOfMonth || 1, daysInMonth);
    const date = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    return { ...r, previewDate: date };
  }).sort((a, b) => a.previewDate < b.previewDate ? -1 : 1);
  const total = entries.reduce((s, r) => s + (r.type === 'expense' ? -r.amount : r.amount), 0);
  return `
    <div class="card">
      <h2>Next month preview</h2>
      <p class="card-help">These entries will be auto-generated for ${monthLabel}.</p>
      <div class="recurring-list">
        ${entries.map(r => `
          <div class="ledger-line">
            <div class="info">
              <span class="desc">${escapeHtml(r.note || r.category)}</span>
              <span class="cat-tag">${escapeHtml(r.category)}</span>
              <span class="cat-tag">${r.previewDate}</span>
            </div>
            <div class="right">
              <span class="amt ${r.type}">${r.type==='expense'?'-':'+'}${fmt(r.amount)}</span>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="preview-total" style="text-align:right;padding:8px 0;font-weight:600;">
        Net impact: <span class="${total > 0 ? 'net-positive' : total < 0 ? 'net-negative' : ''}">${total > 0 ? '+' : total < 0 ? '-' : ''}${fmt(Math.abs(total))}</span>
      </div>
    </div>
  `;
}

let txFilter = { query: '', type: 'all', category: 'all', dateFrom: '', dateTo: '' };
function isFiltering(){ return !!txFilter.query.trim() || txFilter.type !== 'all' || txFilter.category !== 'all' || !!txFilter.dateFrom || !!txFilter.dateTo; }

function renderTransactions(t){
  const cats = txType === 'income' ? incomeCats() : expenseCats();
  const catOptions = cats.map(c => `<option value="${c}">${c}</option>`).join('');
  const budgets = (state.settings && state.settings.budgets) || {};

  const filtered = filterTransactions(state.transactions, txFilter);
  const filtering = isFiltering();
  const sorted = filtered.slice().sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  const grouped = {};
  sorted.forEach(tx => {
    const mk = monthKey(tx.date);
    grouped[mk] = grouped[mk] || [];
    grouped[mk].push(tx);
  });
  const shownTotals = sumTotals(filtered);

  const emptyMsg = !state.transactions.length
    ? 'No entries yet. Log your first transaction above.'
    : 'No entries match these filters.';
  const lines = Object.keys(grouped).length ? Object.entries(grouped).map(([month, txs]) => `
    <div class="ledger-month">${month}</div>
    ${txs.map(renderLedgerLine).join('')}
  `).join('') : `<div class="empty">${emptyMsg}</div>`;

  const allCats = Array.from(new Set([...expenseCats(), ...incomeCats(), ...state.transactions.map(t => t.category)]));
  const filterBar = state.transactions.length ? `
    <div class="filter-bar" role="search" aria-label="Filter entries">
      <div class="field filter-query">
        <label for="filter-query">Search</label>
        <input type="search" id="filter-query" placeholder="Note or category" value="${escapeHtml(txFilter.query)}" autocomplete="off">
      </div>
      <div class="field">
        <label for="filter-type">Type</label>
        <select id="filter-type">
          <option value="all"${txFilter.type === 'all' ? ' selected' : ''}>All</option>
          <option value="expense"${txFilter.type === 'expense' ? ' selected' : ''}>Expenses</option>
          <option value="income"${txFilter.type === 'income' ? ' selected' : ''}>Income</option>
        </select>
      </div>
      <div class="field">
        <label for="filter-category">Category</label>
        <select id="filter-category">
          <option value="all">All</option>
          ${allCats.map(c => `<option value="${escapeHtml(c)}"${txFilter.category === c ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="filter-date-from">From</label>
        <input type="date" id="filter-date-from" value="${txFilter.dateFrom}">
      </div>
      <div class="field">
        <label for="filter-date-to">To</label>
        <input type="date" id="filter-date-to" value="${txFilter.dateTo}">
      </div>
    </div>
    <div class="filter-summary" role="status" aria-live="polite">
      <span id="filter-count">${filtering ? `Showing ${filtered.length} of ${state.transactions.length} entries` : `${state.transactions.length} entries`}</span>
      ${filtering ? '<button type="button" class="link-btn" id="filter-clear">Clear filters</button>' : ''}
    </div>` : '';

  return `
    <div class="card">
      <h2>New entry</h2>
      <div class="form-row">
        <div class="field" style="flex: 0 0 160px;">
          <span class="field-label" id="tx-type-label">Type</span>
          <div class="toggle-group" role="group" aria-labelledby="tx-type-label">
            <button type="button" class="toggle-btn expense ${txType==='expense'?'active':''}" data-type="expense" aria-pressed="${txType==='expense'}">Expense</button>
            <button type="button" class="toggle-btn income ${txType==='income'?'active':''}" data-type="income" aria-pressed="${txType==='income'}">Income</button>
          </div>
        </div>
        <div class="field">
          <label for="tx-amount">Amount</label>
          <input type="number" id="tx-amount" step="0.01" min="0" placeholder="0.00" inputmode="decimal">
        </div>
        <div class="field">
          <label for="tx-category">Category</label>
          <select id="tx-category">${catOptions}</select>
        </div>
        <div class="field">
          <label for="tx-date">Date</label>
          <input type="date" id="tx-date" value="${todayISO()}">
        </div>
      </div>
      <div class="form-row">
        <div class="field" style="flex: 3;">
          <label for="tx-note">Note (optional)</label>
          <input type="text" id="tx-note" placeholder="e.g. groceries at the market">
        </div>
      </div>
      <button class="btn" id="add-tx-btn">Add entry</button>
    </div>
    <div class="card">
      <h2>Entries</h2>
      ${filterBar}
      ${lines}
      ${filtered.length ? `
      <div class="total-line">
        <span>${filtering ? 'Net of shown entries' : 'Net'}</span>
        <span>${fmt(shownTotals.balance)}</span>
      </div>` : ''}
    </div>
    <div class="card">
      <h2>Settings</h2>
      <div class="field settings-field">
        <label for="currency-select">Currency</label>
        <select id="currency-select">
          ${CURRENCIES.map(c => `<option value="${c}"${c === userCurrency() ? ' selected' : ''}>${c} (${formatMoney(123456, c)})</option>`).join('')}
        </select>
      </div>
      <div class="custom-cats-section">
        <h3>Custom categories</h3>
        <div class="custom-cats-row">
          <input type="text" id="new-expense-cat" placeholder="New expense category" maxlength="30">
          <button type="button" class="btn ghost" id="add-expense-cat-btn">Add</button>
        </div>
        ${((state.settings && state.settings.customExpenseCats) || []).length ? `
        <div class="custom-cat-tags">Expense: ${((state.settings && state.settings.customExpenseCats) || []).map(c =>
          `<span class="cat-chip">${escapeHtml(c)} <button type="button" class="chip-remove" data-remove-ecat="${escapeHtml(c)}" aria-label="Remove ${escapeHtml(c)}">✕</button></span>`
        ).join('')}</div>` : ''}
        <div class="custom-cats-row">
          <input type="text" id="new-income-cat" placeholder="New income category" maxlength="30">
          <button type="button" class="btn ghost" id="add-income-cat-btn">Add</button>
        </div>
        ${((state.settings && state.settings.customIncomeCats) || []).length ? `
        <div class="custom-cat-tags">Income: ${((state.settings && state.settings.customIncomeCats) || []).map(c =>
          `<span class="cat-chip">${escapeHtml(c)} <button type="button" class="chip-remove" data-remove-icat="${escapeHtml(c)}" aria-label="Remove ${escapeHtml(c)}">✕</button></span>`
        ).join('')}</div>` : ''}
      </div>
    </div>
    <div class="card">
      <h2>Monthly Budgets</h2>
      <p class="card-help">Set a monthly spending limit per category. Leave blank or 0 to remove.</p>
      <div class="budget-grid">
        ${expenseCats().map(cat => {
          const val = budgets[cat] ? (budgets[cat] / 100).toFixed(2) : '';
          return `
          <div class="budget-row">
            <label for="budget-${escapeHtml(cat)}">${escapeHtml(cat)}</label>
            <input type="number" id="budget-${escapeHtml(cat)}" class="budget-input" data-budget-cat="${escapeHtml(cat)}" min="0" step="0.01" placeholder="0.00" value="${val}">
          </div>`;
        }).join('')}
      </div>
      <button type="button" class="btn ghost" id="save-budgets-btn">Save budgets</button>
    </div>
    <div class="card">
      <h2>Recurring Entries</h2>
      <p class="card-help">Entries added here are auto-generated once at the start of each month.</p>
      <div class="recurring-form">
        <div class="filter-bar">
          <div class="field">
            <label for="rec-type">Type</label>
            <select id="rec-type">
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </div>
          <div class="field">
            <label for="rec-amount">Amount</label>
            <input type="number" id="rec-amount" placeholder="0.00" min="0" step="0.01">
          </div>
          <div class="field">
            <label for="rec-category">Category</label>
            <select id="rec-category">
              ${expenseCats().map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="rec-day">Day of month</label>
            <input type="number" id="rec-day" placeholder="1" min="1" max="31" value="1">
          </div>
        </div>
        <div class="field" style="margin-bottom:8px">
          <label for="rec-note">Note (optional)</label>
          <input type="text" id="rec-note" placeholder="e.g. Monthly rent">
        </div>
        <button type="button" class="btn ghost" id="add-recurring-btn">Add recurring entry</button>
      </div>
      ${state.recurring && state.recurring.length ? `
      <div class="recurring-list">
        ${state.recurring.map(r => {
          if(r.id === editingRecurringId) return renderRecurringEditForm(r);
          const label = escapeHtml(r.note || r.category);
          return `
          <div class="ledger-line">
            <div class="info">
              <span class="desc">${label}</span>
              <span class="cat-tag">${escapeHtml(r.category)}</span>
              <span class="cat-tag">Day ${r.dayOfMonth || 1}</span>
            </div>
            <div class="right">
              <span class="amt ${r.type}">${r.type==='expense'?'-':'+'}${fmt(r.amount)}</span>
              <button type="button" class="del edit" data-edit-recurring="${r.id}" aria-label="Edit recurring ${label}">${EDIT_ICON}</button>
              <button type="button" class="del" data-del-recurring="${r.id}" aria-label="Remove recurring ${label}"><span aria-hidden="true">✕</span></button>
            </div>
          </div>`;
        }).join('')}
      </div>` : ''}
    </div>
    ${renderRecurringPreview()}
    <div class="card">
      <h2>Backup</h2>
      <p class="card-help">Your data lives only in this browser. Export a backup so clearing browser data can't wipe it.</p>
      <div class="backup-actions">
        <button type="button" class="btn ghost" id="export-json-btn">Export backup (JSON)</button>
        <button type="button" class="btn ghost" id="export-csv-btn">Export transactions (CSV)</button>
        <button type="button" class="btn ghost" id="import-json-btn">Import backup</button>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
      </div>
      <div class="backup-status" id="backup-status" role="status" aria-live="polite">${escapeHtml(backupStatus.msg)}</div>
    </div>
  `;
}

let backupStatus = { msg: '', isError: false };

function downloadFile(filename, text, type){
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function backupFilename(ext){
  const safeUser = String(currentUser).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'user';
  return `ledger-${safeUser}-${todayISO()}.${ext}`;
}
function setBackupStatus(msg, isError){
  backupStatus = { msg, isError };
  const el = document.getElementById('backup-status');
  if(el){ el.textContent = msg; el.classList.toggle('error', isError); }
}

async function importBackupFile(file){
  let parsed;
  try{
    parsed = JSON.parse(await file.text());
  }catch(e){
    setBackupStatus('That file is not valid JSON.', true);
    return;
  }
  const { data, error } = parseBackup(parsed);
  if(error){ setBackupStatus(error, true); return; }
  const hasData = state.transactions.length || state.goals.length;
  if(hasData && !window.confirm(
    `Replace your current ${state.transactions.length} transactions and ${state.goals.length} goals ` +
    `with the ${data.transactions.length} transactions and ${data.goals.length} goals in this file? This can't be undone.`
  )){
    setBackupStatus('Import cancelled.', false);
    return;
  }
  if(!data.settings.currency && state.settings && state.settings.currency) data.settings.currency = state.settings.currency;
  data.transactions.forEach(t => { if(!t.id) t.id = uid(); });
  data.goals.forEach(g => { if(!g.id) g.id = uid(); });
  state = data;
  editingId = null;
  hideToast();
  backupStatus = { msg: `Imported ${data.transactions.length} transactions and ${data.goals.length} goals.`, isError: false };
  save();
  render();
}

function attachTransactionHandlers(t){
  // Transactions panel
  document.querySelectorAll('.toggle-btn[data-type]').forEach(btn => {
    btn.addEventListener('click', () => { txType = btn.dataset.type; render(); });
  });
  const addTxBtn = document.getElementById('add-tx-btn');
  if(addTxBtn){
    addTxBtn.addEventListener('click', () => {
      const amountEl = document.getElementById('tx-amount');
      if(!validateFields([[amountEl, amountError(amountEl.value)]])) return;
      const amount = toCents(amountEl.value);
      const category = document.getElementById('tx-category').value;
      const date = document.getElementById('tx-date').value || todayISO();
      const note = document.getElementById('tx-note').value.trim();
      clearFields(['tx-amount', 'tx-category', 'tx-date', 'tx-note']);
      addTransaction({ type: txType, amount, category, date, note });
      pendingFocus = '#tx-amount';
    });
  }
  // Search and filters
  const filterQuery = document.getElementById('filter-query');
  if(filterQuery){
    filterQuery.addEventListener('input', () => { txFilter.query = filterQuery.value; render(); });
    document.getElementById('filter-type').addEventListener('change', (e) => { txFilter.type = e.target.value; render(); });
    document.getElementById('filter-category').addEventListener('change', (e) => { txFilter.category = e.target.value; render(); });
    const dateFromEl = document.getElementById('filter-date-from');
    const dateToEl = document.getElementById('filter-date-to');
    if(dateFromEl) dateFromEl.addEventListener('change', (e) => { txFilter.dateFrom = e.target.value; render(); });
    if(dateToEl) dateToEl.addEventListener('change', (e) => { txFilter.dateTo = e.target.value; render(); });
    const clearBtn = document.getElementById('filter-clear');
    if(clearBtn) clearBtn.addEventListener('click', () => {
      txFilter = { query: '', type: 'all', category: 'all', dateFrom: '', dateTo: '' };
      clearFields(['filter-query', 'filter-type', 'filter-category', 'filter-date-from', 'filter-date-to']);
      pendingFocus = '#filter-query';
      render();
    });
  }

  const currencySel = document.getElementById('currency-select');
  if(currencySel){
    currencySel.addEventListener('change', () => {
      state.settings = { ...(state.settings || {}), currency: currencySel.value };
      save(); render();
    });
  }

  // Custom categories
  function addCustomCat(key, inputId){
    const inp = document.getElementById(inputId);
    if(!inp) return;
    const name = inp.value.trim();
    if(!name) return;
    const settings = { ...(state.settings || {}) };
    const list = [...(settings[key] || [])];
    const allBuiltIn = [...EXPENSE_CATS, ...INCOME_CATS];
    if(allBuiltIn.includes(name) || list.includes(name)) return;
    list.push(name);
    settings[key] = list;
    state.settings = settings;
    save(); render();
  }
  const addExpCatBtn = document.getElementById('add-expense-cat-btn');
  if(addExpCatBtn) addExpCatBtn.addEventListener('click', () => addCustomCat('customExpenseCats', 'new-expense-cat'));
  const addIncCatBtn = document.getElementById('add-income-cat-btn');
  if(addIncCatBtn) addIncCatBtn.addEventListener('click', () => addCustomCat('customIncomeCats', 'new-income-cat'));

  document.querySelectorAll('.chip-remove[data-remove-ecat]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.removeEcat;
      const settings = { ...(state.settings || {}) };
      settings.customExpenseCats = (settings.customExpenseCats || []).filter(c => c !== cat);
      state.settings = settings;
      save(); render();
    });
  });
  document.querySelectorAll('.chip-remove[data-remove-icat]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.removeIcat;
      const settings = { ...(state.settings || {}) };
      settings.customIncomeCats = (settings.customIncomeCats || []).filter(c => c !== cat);
      state.settings = settings;
      save(); render();
    });
  });

  // Monthly budgets
  const saveBudgetsBtn = document.getElementById('save-budgets-btn');
  if(saveBudgetsBtn){
    saveBudgetsBtn.addEventListener('click', () => {
      const budgets = {};
      document.querySelectorAll('.budget-input').forEach(inp => {
        const cat = inp.dataset.budgetCat;
        const cents = toCents(inp.value);
        if(Number.isFinite(cents) && cents > 0) budgets[cat] = cents;
      });
      state.settings = { ...(state.settings || {}), budgets };
      save(); render();
    });
  }

  // Recurring entries
  const addRecBtn = document.getElementById('add-recurring-btn');
  if(addRecBtn){
    const recTypeSel = document.getElementById('rec-type');
    const recCatSel = document.getElementById('rec-category');
    if(recTypeSel && recCatSel){
      recTypeSel.addEventListener('change', () => {
        const list = recTypeSel.value === 'income' ? incomeCats() : expenseCats();
        recCatSel.innerHTML = list.map(c => `<option value="${c}">${c}</option>`).join('');
      });
    }
    addRecBtn.addEventListener('click', () => {
      const amountEl = document.getElementById('rec-amount');
      if(!validateFields([[amountEl, amountError(amountEl.value)]])) return;
      const type = document.getElementById('rec-type').value;
      const amount = toCents(amountEl.value);
      const category = document.getElementById('rec-category').value;
      const dayOfMonth = Math.max(1, Math.min(31, parseInt(document.getElementById('rec-day').value, 10) || 1));
      const note = document.getElementById('rec-note').value.trim();
      if(!state.recurring) state.recurring = [];
      state.recurring.push({ id: uid(), type, amount, category, dayOfMonth, note });
      save();
      generateRecurring();
      render();
    });
  }
  document.querySelectorAll('[data-del-recurring]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.delRecurring;
      const idx = (state.recurring || []).findIndex(r => r.id === id);
      if(idx < 0) return;
      const [item] = state.recurring.splice(idx, 1);
      save(); render();
      showUndoToast(`Deleted recurring "${item.note || item.category}".`, () => {
        state.recurring.splice(Math.min(idx, state.recurring.length), 0, item);
        save(); render();
      });
    });
  });
  document.querySelectorAll('[data-edit-recurring]').forEach(btn => {
    btn.addEventListener('click', () => startRecurringEdit(btn.dataset.editRecurring));
  });
  const recEditForm = document.getElementById('rec-edit-form');
  if(recEditForm){
    recEditForm.addEventListener('submit', (e) => { e.preventDefault(); saveRecurringEdit(); });
    document.getElementById('rec-edit-cancel').addEventListener('click', stopRecurringEdit);
    recEditForm.addEventListener('keydown', (e) => { if(e.key === 'Escape'){ e.preventDefault(); stopRecurringEdit(); } });
    const recEditTypeSel = document.getElementById('rec-edit-type');
    recEditTypeSel.addEventListener('change', () => {
      const catSel = document.getElementById('rec-edit-category');
      const list = recEditTypeSel.value === 'income' ? incomeCats() : expenseCats();
      catSel.innerHTML = list.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    });
  }

  const exportJsonBtn = document.getElementById('export-json-btn');
  if(exportJsonBtn){
    exportJsonBtn.addEventListener('click', () => {
      downloadFile(backupFilename('json'), JSON.stringify({ ...state, v: DATA_VERSION, exportedAt: new Date().toISOString() }, null, 2), 'application/json');
      const parts = [`${state.transactions.length} transactions`, `${state.goals.length} goals`];
      if(state.recurring && state.recurring.length) parts.push(`${state.recurring.length} recurring entries`);
      setBackupStatus(`Exported ${parts.join(', ')}.`, false);
    });
    document.getElementById('export-csv-btn').addEventListener('click', () => {
      downloadFile(backupFilename('csv'), transactionsToCSV(state.transactions), 'text/csv');
      setBackupStatus(`Exported ${state.transactions.length} transactions as CSV.`, false);
    });
    const fileInput = document.getElementById('import-file');
    document.getElementById('import-json-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if(file) importBackupFile(file);
    });
    document.getElementById('backup-status').classList.toggle('error', backupStatus.isError);
  }

  document.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => deleteTransaction(btn.dataset.del));
  });

  // Inline edit (Transactions and Daily tabs)
  document.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => startEdit(btn.dataset.edit));
  });
  const editForm = document.getElementById('edit-form');
  if(editForm){
    editForm.addEventListener('submit', (e) => { e.preventDefault(); saveEdit(); });
    document.getElementById('edit-cancel').addEventListener('click', stopEdit);
    editForm.addEventListener('keydown', (e) => { if(e.key === 'Escape'){ e.preventDefault(); stopEdit(); } });
    const typeSel = document.getElementById('edit-type');
    typeSel.addEventListener('change', () => {
      const catSel = document.getElementById('edit-category');
      const list = typeSel.value === 'income' ? incomeCats() : expenseCats();
      catSel.innerHTML = categoryOptions(typeSel.value, list.includes(catSel.value) ? catSel.value : null);
    });
  }
}
