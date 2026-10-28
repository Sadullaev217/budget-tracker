const STORAGE_PREFIX = 'ledger-data-v1';
const USERS_KEY = 'ledger-users';
const SESSION_KEY = 'ledger-current-user';
const EXPENSE_CATS = ['Food','Housing','Transport','Utilities','Entertainment','Health','Other'];
const INCOME_CATS = ['Salary','Freelance','Gift','Other'];

let state = { transactions: [], goals: [], recurring: [], recurringGenerated: {} };

function expenseCats(){
  const custom = (state.settings && state.settings.customExpenseCats) || [];
  return [...EXPENSE_CATS, ...custom.filter(c => !EXPENSE_CATS.includes(c))];
}
function incomeCats(){
  const custom = (state.settings && state.settings.customIncomeCats) || [];
  return [...INCOME_CATS, ...custom.filter(c => !INCOME_CATS.includes(c))];
}
let activeTab = 'overview';
let txType = 'expense';
let dailyType = 'expense';

let currentUser = null;
let authMode = 'signin';
let authError = '';

// localISO, toCents, fmt, escapeHtml, migrateData, sumTotals, sumDay and
// monthlyExpenseSeries live in lib.js (loaded first, and unit-tested).
function todayISO(){ return localISO(new Date()); }
let selectedDate = todayISO();
let calYear = new Date().getFullYear();
let calMonthIdx = new Date().getMonth();

const THEME_KEY = 'ledger-theme';
function toggleTheme(){
  const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try{ localStorage.setItem(THEME_KEY, next); }catch(e){}
  render();
}

const SUN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>';
const MOON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"></path></svg>';

function uid(){ return Math.random().toString(36).slice(2,10); }

function userCurrency(){
  const c = state.settings && state.settings.currency;
  return CURRENCIES.includes(c) ? c : DEFAULT_CURRENCY;
}
// All on-screen money goes through here so the currency setting applies everywhere.
function fmt(cents){ return formatMoney(cents, userCurrency()); }

// Local password hashing. Still a local demo (anyone with dev tools can read
// localStorage), but uses the right pattern: PBKDF2-SHA256 with a random
// per-user salt and OWASP's recommended iteration count.
const PBKDF2_ALGO = 'pbkdf2-sha256';
const PBKDF2_ITERATIONS = 600000;
const hasSubtle = () => !!(window.crypto && window.crypto.subtle);
const toHex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
const fromHex = hex => new Uint8Array(hex.match(/../g).map(h => parseInt(h, 16)));

async function pbkdf2Hex(pw, saltHex, iterations){
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations }, key, 256);
  return toHex(bits);
}

// Pre-PBKDF2 format: unsalted SHA-256 (or a non-crypto hash where Web Crypto
// is unavailable). Only used to verify, and then upgrade, old accounts.
async function legacyHash(pw){
  if(hasSubtle()){
    try{ return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw))); }
    catch(e){ /* fall through to non-crypto fallback below */ }
  }
  let h = 0;
  for(let i = 0; i < pw.length; i++){ h = (Math.imul(31, h) + pw.charCodeAt(i)) | 0; }
  return 'fallback:' + h.toString(16);
}

async function createPasswordRecord(pw){
  if(!hasSubtle()) return { passwordHash: await legacyHash(pw) };
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  return { algo: PBKDF2_ALGO, salt, iterations: PBKDF2_ITERATIONS, passwordHash: await pbkdf2Hex(pw, salt, PBKDF2_ITERATIONS) };
}

async function verifyPassword(pw, rec){
  if(rec.algo === PBKDF2_ALGO){
    if(!hasSubtle()) return false;
    return (await pbkdf2Hex(pw, rec.salt, rec.iterations)) === rec.passwordHash;
  }
  return (await legacyHash(pw)) === rec.passwordHash;
}

function getUsers(){
  try{ return JSON.parse(localStorage.getItem(USERS_KEY)) || {}; }catch(e){ return {}; }
}
function saveUsers(users){
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}
function userStorageKey(username){ return `${STORAGE_PREFIX}:${username}`; }

async function signIn(username, password){
  username = username.trim();
  authError = '';
  const users = getUsers();
  const rec = users[username];
  if(!username || !rec){ authError = 'No account found with that username.'; render(); return; }
  if(!(await verifyPassword(password, rec))){ authError = 'Incorrect password.'; render(); return; }
  // Upgrade old unsalted-SHA-256 records now that we know the password.
  if(rec.algo !== PBKDF2_ALGO && hasSubtle()){
    users[username] = await createPasswordRecord(password);
    saveUsers(users);
  }
  currentUser = username;
  localStorage.setItem(SESSION_KEY, username);
  loadUserData();
  render();
}

async function signUp(username, password, confirm){
  username = username.trim();
  authError = '';
  if(!username){ authError = 'Enter a username.'; render(); return; }
  if(password.length < 4){ authError = 'Password must be at least 4 characters.'; render(); return; }
  if(password !== confirm){ authError = 'Passwords do not match.'; render(); return; }
  const users = getUsers();
  if(users[username]){ authError = 'That username is already taken.'; render(); return; }
  users[username] = await createPasswordRecord(password);
  saveUsers(users);
  currentUser = username;
  localStorage.setItem(SESSION_KEY, username);
  loadUserData();
  render();
}

function signOut(){
  currentUser = null;
  localStorage.removeItem(SESSION_KEY);
  state = { transactions: [], goals: [], recurring: [], recurringGenerated: {} };
  activeTab = 'overview';
  authMode = 'signin';
  authError = '';
  backupStatus = { msg: '', isError: false };
  editingId = null;
  txFilter = { query: '', type: 'all', category: 'all' };
  hideToast();
  render();
}

function loadUserData(){
  state = { transactions: [], goals: [], recurring: [], recurringGenerated: {} };
  try{
    const raw = localStorage.getItem(userStorageKey(currentUser));
    if(raw){
      const { data, changed } = migrateData(JSON.parse(raw));
      state = data;
      if(!state.recurring) state.recurring = [];
      if(!state.recurringGenerated) state.recurringGenerated = {};
      if(changed) save();
    }
  }catch(e){
    // no existing data yet
  }
  generateRecurring();
}

// Auto-generate transactions from recurring templates for the current month.
function generateRecurring(){
  if(!state.recurring || !state.recurring.length) return;
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let added = false;
  state.recurring.forEach(r => {
    const genKey = `${r.id}:${monthKey}`;
    if(state.recurringGenerated[genKey]) return;
    const day = Math.min(r.dayOfMonth || 1, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());
    const date = `${monthKey}-${String(day).padStart(2, '0')}`;
    state.transactions.push({
      id: uid(), type: r.type, amount: r.amount, category: r.category,
      date, note: r.note ? `${r.note} (recurring)` : '(recurring)'
    });
    state.recurringGenerated[genKey] = true;
    added = true;
  });
  if(added) save();
}

function restoreSession(){
  const saved = localStorage.getItem(SESSION_KEY);
  if(saved){
    currentUser = saved;
    loadUserData();
  }
  render();
}

function save(){
  if(!currentUser) return;
  try{
    state.v = DATA_VERSION;
    localStorage.setItem(userStorageKey(currentUser), JSON.stringify(state));
  }catch(e){
    console.error('Could not save ledger data', e);
  }
}

function addTransaction(data){
  state.transactions.unshift({ id: uid(), ...data });
  save(); render();
}
function deleteTransaction(id){
  const idx = state.transactions.findIndex(t => t.id === id);
  if(idx < 0) return;
  const [item] = state.transactions.splice(idx, 1);
  if(editingId === id) editingId = null;
  save(); render();
  showUndoToast(`Deleted "${item.note || item.category}".`, () => {
    state.transactions.splice(Math.min(idx, state.transactions.length), 0, item);
    save(); render();
  });
}
function addGoal(data){
  state.goals.push({ id: uid(), saved: 0, ...data });
  save(); render();
}
function deleteGoal(id){
  const idx = state.goals.findIndex(g => g.id === id);
  if(idx < 0) return;
  const [goal] = state.goals.splice(idx, 1);
  save(); render();
  showUndoToast(`Deleted goal "${goal.name}".`, () => {
    state.goals.splice(Math.min(idx, state.goals.length), 0, goal);
    save(); render();
  });
}

// Undo toast. It lives outside #app so render() doesn't wipe it. It stays up
// while it has keyboard focus, and is dismissed whenever the data is swapped
// (sign-out, import) so Undo can't write into a different user's data.
const TOAST_MS = 7000;
let toastTimer = null;
function showUndoToast(message, onUndo){
  const region = document.getElementById('toast-region');
  if(!region) return;
  hideToast();
  const toast = document.createElement('div');
  toast.className = 'toast';
  const text = document.createElement('span');
  text.textContent = message;
  const undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'toast-undo';
  undo.textContent = 'Undo';
  undo.addEventListener('click', () => { hideToast(); onUndo(); });
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss');
  close.innerHTML = '<span aria-hidden="true">✕</span>';
  close.addEventListener('click', hideToast);
  toast.append(text, undo, close);
  toast.addEventListener('focusin', () => clearTimeout(toastTimer));
  toast.addEventListener('focusout', (e) => { if(!toast.contains(e.relatedTarget)) armToastTimer(); });
  region.appendChild(toast);
  armToastTimer();
}
function armToastTimer(){
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    const toast = document.querySelector('#toast-region .toast');
    // Never yank the toast out from under keyboard focus; check again later.
    if(toast && toast.contains(document.activeElement)) armToastTimer();
    else hideToast();
  }, TOAST_MS);
}
function hideToast(){
  clearTimeout(toastTimer);
  const region = document.getElementById('toast-region');
  if(region) region.innerHTML = '';
}
function contributeToGoal(id, amount){
  const g = state.goals.find(g => g.id === id);
  if(g){ g.saved = Math.max(0, g.saved + amount); save(); render(); }
}

function totals(){ return sumTotals(state.transactions); }

function monthKey(dateStr){
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

function pad2(n){ return String(n).padStart(2, '0'); }

function transactionsForDate(dateStr){
  return state.transactions.filter(tx => tx.date === dateStr);
}

function dayTotals(dateStr){ return sumDay(state.transactions, dateStr); }

function shiftCalendar(delta){
  calMonthIdx += delta;
  if(calMonthIdx < 0){ calMonthIdx = 11; calYear--; }
  if(calMonthIdx > 11){ calMonthIdx = 0; calYear++; }
  render();
}

function goToToday(){
  const d = new Date();
  calYear = d.getFullYear();
  calMonthIdx = d.getMonth();
  selectedDate = todayISO();
  render();
}

function renderChart(series){
  if(series.every(s => s.total === 0)){
    const anyExpenses = state.transactions.some(t => t.type === 'expense');
    return `<h2>Expenses by month</h2><div class="empty">${anyExpenses
      ? 'No expenses in the last 6 months.'
      : 'No expenses logged yet. Add one from the Transactions tab.'}</div>`;
  }
  // Size the viewBox to the real container width so SVG text renders 1:1
  // (a fixed 640px viewBox shrinks labels to ~4px on phones).
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

function renderDaily(){
  const monthLabel = new Date(calYear, calMonthIdx, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const firstWeekday = new Date(calYear, calMonthIdx, 1).getDay();
  const numDays = new Date(calYear, calMonthIdx + 1, 0).getDate();
  const weekdayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const weekdayHeaders = weekdayNames.map(w => `<div class="cal-weekday">${w}</div>`).join('');
  const leadingBlanks = Array.from({ length: firstWeekday }, () => `<div class="day-cell empty"></div>`).join('');

  const dayCells = Array.from({ length: numDays }, (_, i) => {
    const day = i + 1;
    const dateStr = `${calYear}-${pad2(calMonthIdx + 1)}-${pad2(day)}`;
    const dt = dayTotals(dateStr);
    const isToday = dateStr === todayISO();
    const isSelected = dateStr === selectedDate;
    const dots = (dt.income > 0 ? '<span class="day-dot income"></span>' : '') +
                 (dt.expense > 0 ? '<span class="day-dot expense"></span>' : '');
    const dayLabel = new Date(calYear, calMonthIdx, day).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const entryCount = transactionsForDate(dateStr).length;
    const summary = entryCount
      ? `${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}: income ${fmt(dt.income)}, expenses ${fmt(dt.expense)}`
      : 'no entries';
    return `
      <button type="button" class="day-cell ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}" data-date="${dateStr}" aria-pressed="${isSelected}"${isToday ? ' aria-current="date"' : ''} aria-label="${dayLabel}, ${summary}">
        <span class="day-num">${day}</span>
        <span class="day-dots" aria-hidden="true">${dots}</span>
      </button>
    `;
  }).join('');

  const selectedEntries = transactionsForDate(selectedDate).slice().sort((a,b) => a.id < b.id ? 1 : -1);
  const selDt = dayTotals(selectedDate);
  const selLabel = new Date(selectedDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const netClass = selDt.net > 0 ? 'net-positive' : (selDt.net < 0 ? 'net-negative' : '');

  const entryLines = selectedEntries.length
    ? selectedEntries.map(renderLedgerLine).join('')
    : `<div class="empty">No entries on this day yet.</div>`;

  const cats = dailyType === 'income' ? incomeCats() : expenseCats();
  const catOptions = cats.map(c => `<option value="${c}">${c}</option>`).join('');

  return `
    <div class="card">
      <div class="cal-nav">
        <div class="cal-label">${monthLabel}</div>
        <div class="cal-nav-btns">
          <button type="button" class="cal-today-btn" data-cal-today aria-label="Jump to today">Today</button>
          <button type="button" data-cal-nav="-1" aria-label="Previous month">‹</button>
          <button type="button" data-cal-nav="1" aria-label="Next month">›</button>
        </div>
      </div>
      <div class="calendar-grid">
        ${weekdayHeaders}
        ${leadingBlanks}
        ${dayCells}
      </div>
    </div>
    <div class="card">
      <div class="day-detail-title">${selLabel}</div>
      <div class="day-detail-sub">Income ${fmt(selDt.income)} &nbsp;·&nbsp; Expenses ${fmt(selDt.expense)} &nbsp;·&nbsp; Net <span class="${netClass}">${fmt(selDt.net)}</span></div>
      ${entryLines}
    </div>
    <div class="card">
      <h2>Add entry for this day</h2>
      <div class="form-row">
        <div class="field" style="flex: 0 0 160px;">
          <span class="field-label" id="daily-type-label">Type</span>
          <div class="toggle-group" role="group" aria-labelledby="daily-type-label">
            <button type="button" class="toggle-btn expense ${dailyType==='expense'?'active':''}" data-dtype="expense" aria-pressed="${dailyType==='expense'}">Expense</button>
            <button type="button" class="toggle-btn income ${dailyType==='income'?'active':''}" data-dtype="income" aria-pressed="${dailyType==='income'}">Income</button>
          </div>
        </div>
        <div class="field">
          <label for="daily-amount">Amount</label>
          <input type="number" id="daily-amount" step="0.01" min="0" placeholder="0.00" inputmode="decimal">
        </div>
        <div class="field">
          <label for="daily-category">Category</label>
          <select id="daily-category">${catOptions}</select>
        </div>
      </div>
      <div class="form-row">
        <div class="field" style="flex: 3;">
          <label for="daily-note">Note (optional)</label>
          <input type="text" id="daily-note" placeholder="e.g. groceries at the market">
        </div>
      </div>
      <button class="btn" id="add-daily-tx-btn">Add entry</button>
    </div>
  `;
}

function renderAuthScreen(){
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const isSignup = authMode === 'signup';
  return `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-card-top">
          <button type="button" class="theme-toggle" id="theme-toggle" aria-label="${isDark ? 'Switch to light mode' : 'Switch to dark mode'}">${isDark ? SUN_ICON : MOON_ICON}</button>
        </div>
        <h1 class="auth-title">The Ledger</h1>
        <div class="auth-tagline">income, expenses & savings, kept in order</div>
        <div class="tabs auth-tabs" role="group" aria-label="Account mode">
          <button type="button" class="tab ${!isSignup?'active':''}" data-authmode="signin" aria-pressed="${!isSignup}">Sign in</button>
          <button type="button" class="tab ${isSignup?'active':''}" data-authmode="signup" aria-pressed="${isSignup}">Create account</button>
        </div>
        <form id="auth-form" novalidate>
          <div class="field" style="margin-bottom:14px;">
            <label for="auth-username">Username</label>
            <input type="text" id="auth-username" autocomplete="username" placeholder="e.g. jordan"${authError ? ' aria-invalid="true" aria-describedby="auth-error"' : ''}>
          </div>
          <div class="field" style="margin-bottom:14px;">
            <label for="auth-password">Password</label>
            <input type="password" id="auth-password" autocomplete="${isSignup ? 'new-password' : 'current-password'}" placeholder="••••••••"${authError ? ' aria-invalid="true" aria-describedby="auth-error"' : ''}>
          </div>
          ${isSignup ? `
          <div class="field" style="margin-bottom:14px;">
            <label for="auth-password-confirm">Confirm password</label>
            <input type="password" id="auth-password-confirm" autocomplete="new-password" placeholder="••••••••">
          </div>` : ''}
          ${authError ? `<div class="auth-error" id="auth-error" role="alert">${escapeHtml(authError)}</div>` : ''}
          <button type="submit" id="auth-submit" class="btn" style="width:100%;">${isSignup ? 'Create account' : 'Sign in'}</button>
        </form>
        <div class="auth-note">Stored locally in this browser only — not a real account system.</div>
      </div>
    </div>
  `;
}

function attachAuthHandlers(){
  const themeBtn = document.getElementById('theme-toggle');
  if(themeBtn) themeBtn.addEventListener('click', toggleTheme);

  document.querySelectorAll('[data-authmode]').forEach(btn => {
    btn.addEventListener('click', () => { authMode = btn.dataset.authmode; authError = ''; render(); });
  });

  const form = document.getElementById('auth-form');
  if(form){
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const username = document.getElementById('auth-username').value;
      const password = document.getElementById('auth-password').value;
      if(authMode === 'signup'){
        const confirm = document.getElementById('auth-password-confirm').value;
        signUp(username, password, confirm);
      } else {
        signIn(username, password);
      }
    });
  }
}

// render() rebuilds the DOM, which drops keyboard focus; remember which control
// had it and put focus back afterwards.
const FOCUS_ATTRS = ['data-tab','data-date','data-type','data-dtype','data-cal-nav','data-authmode','data-del','data-delgoal','data-contribute'];
// Caret position in a focused text field, so typing in the search box
// (which re-renders on every keystroke) doesn't jump the caret to the end.
let savedSelection = null;
function focusSelector(){
  const el = document.activeElement;
  savedSelection = null;
  if(!el || el === document.body) return null;
  try{ if(typeof el.selectionStart === 'number') savedSelection = [el.selectionStart, el.selectionEnd]; }catch(e){}
  if(el.id) return '#' + CSS.escape(el.id);
  if(el.hasAttribute('data-cal-today')) return '[data-cal-today]';
  for(const a of FOCUS_ATTRS){
    if(el.hasAttribute(a)) return `[${a}="${CSS.escape(el.getAttribute(a))}"]`;
  }
  return null;
}
// Set by actions that know where focus should land after the next render
// (e.g. back on the Edit button after saving); wins over restoreFocus.
let pendingFocus = null;
function restoreFocus(sel){
  let keepCaret = true;
  if(pendingFocus){ sel = pendingFocus; pendingFocus = null; keepCaret = false; }
  if(!sel) return;
  const el = document.querySelector(sel);
  if(!el) return;
  el.focus({ preventScroll: true });
  if(keepCaret && savedSelection){
    try{ el.setSelectionRange(savedSelection[0], savedSelection[1]); }catch(e){ /* not a text field */ }
  }
}

// Same problem for typed-but-unsubmitted text: keep it across re-renders
// (type toggle, theme toggle, failed sign-in). Passwords are never kept.
function captureDrafts(){
  const drafts = {};
  document.querySelectorAll('#app input[id], #app select[id]').forEach(el => {
    if(el.type === 'password' || !el.value) return;
    drafts[el.id] = el.value;
  });
  return drafts;
}
function restoreDrafts(drafts){
  Object.keys(drafts).forEach(id => {
    const el = document.getElementById(id);
    if(!el) return;
    // A <select> whose options changed (e.g. expense -> income categories) keeps its default.
    if(el.tagName === 'SELECT' && !Array.from(el.options).some(o => o.value === drafts[id])) return;
    el.value = drafts[id];
  });
}
// Inline field errors. Inserted straight into the DOM (no re-render) and
// removed as soon as the user edits the field. role="alert" announces them.
function setFieldError(input, msg, anchor){
  clearFieldError(input);
  const err = document.createElement('div');
  err.className = 'field-error';
  err.id = input.id + '-error';
  err.setAttribute('role', 'alert');
  err.textContent = msg;
  (anchor || input).insertAdjacentElement('afterend', err);
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', err.id);
  input.addEventListener('input', () => clearFieldError(input), { once: true });
}
function clearFieldError(input){
  input.removeAttribute('aria-invalid');
  input.removeAttribute('aria-describedby');
  const err = document.getElementById(input.id + '-error');
  if(err) err.remove();
}
// Shows each [input, message, anchor?] that has a message; focuses the first.
// Returns true when everything is valid.
function validateFields(checks){
  const failed = checks.filter(([input, msg, anchor]) => {
    if(msg){ setFieldError(input, msg, anchor); return true; }
    clearFieldError(input);
    return false;
  });
  if(failed.length) failed[0][0].focus();
  return failed.length === 0;
}

// Called after a successful submit so the form comes back empty rather than restored.
function clearFields(ids){
  ids.forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
}

function render(){
  const app = document.getElementById('app');
  const focusSel = focusSelector();
  const drafts = captureDrafts();

  if(!currentUser){
    app.innerHTML = renderAuthScreen();
    attachAuthHandlers();
    restoreDrafts(drafts);
    restoreFocus(focusSel);
    return;
  }

  const t = totals();
  const today = new Date().toLocaleDateString(undefined, { weekday:'short', year:'numeric', month:'short', day:'numeric' });
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  app.innerHTML = `
    <div class="header">
      <div>
        <h1>The Ledger</h1>
        <div class="tagline">income, expenses & savings, kept in order</div>
      </div>
      <div class="header-actions">
        <div>
          <div class="today">${today}</div>
          <div class="signed-in-as">signed in as <strong>${escapeHtml(currentUser)}</strong></div>
        </div>
        <button type="button" class="theme-toggle" id="theme-toggle" aria-label="${isDark ? 'Switch to light mode' : 'Switch to dark mode'}">${isDark ? SUN_ICON : MOON_ICON}</button>
        <button type="button" class="btn ghost" id="sign-out-btn" style="padding:9px 16px; font-size:0.78rem;">Sign out</button>
      </div>
    </div>
    <nav class="tabs" aria-label="Sections">
      <button type="button" class="tab ${activeTab==='overview'?'active':''}" data-tab="overview" ${activeTab==='overview'?'aria-current="page"':''}>Overview</button>
      <button type="button" class="tab ${activeTab==='transactions'?'active':''}" data-tab="transactions" ${activeTab==='transactions'?'aria-current="page"':''}>Transactions</button>
      <button type="button" class="tab ${activeTab==='daily'?'active':''}" data-tab="daily" ${activeTab==='daily'?'aria-current="page"':''}>Daily</button>
      <button type="button" class="tab ${activeTab==='goals'?'active':''}" data-tab="goals" ${activeTab==='goals'?'aria-current="page"':''}>Savings Goals</button>
    </nav>
    <main id="panels"></main>
  `;

  document.querySelectorAll('.tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{ activeTab = btn.dataset.tab; editingId = null; render(); });
  });
  const themeBtn = document.getElementById('theme-toggle');
  if(themeBtn) themeBtn.addEventListener('click', toggleTheme);
  const signOutBtn = document.getElementById('sign-out-btn');
  if(signOutBtn) signOutBtn.addEventListener('click', signOut);

  const panels = document.getElementById('panels');
  if(activeTab === 'overview') panels.innerHTML = renderOverview(t);
  else if(activeTab === 'transactions') panels.innerHTML = renderTransactions(t);
  else if(activeTab === 'daily') panels.innerHTML = renderDaily();
  else panels.innerHTML = renderGoals();

  attachPanelHandlers(t);
  restoreDrafts(drafts);
  restoreFocus(focusSel);
}

// Chart geometry depends on viewport width, so redraw when the width changes.
let lastViewportW = window.innerWidth;
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if(window.innerWidth === lastViewportW) return;
    lastViewportW = window.innerWidth;
    if(currentUser && activeTab === 'overview') render();
  }, 150);
});

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
    const pct = g.target > 0 ? Math.min(100, Math.round((g.saved / g.target)*100)) : 0;
    return `
      <div class="cat-row">
        <div class="cat-top"><span>${escapeHtml(g.name)}</span><span class="amt">${fmt(g.saved)} / ${fmt(g.target)}</span></div>
        <div class="bar-track"><div class="bar-fill gold" style="width:${pct}%"></div></div>
      </div>`;
  }).join('') : `<div class="empty">No savings goals yet. Set one from the Savings Goals tab.</div>`;

  const chartSeries = monthlyExpenseSeries(state.transactions, new Date());

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
      <div class="tile tile-goals">
        <h2>Savings goals</h2>
        ${goalsSummary}
      </div>
    </div>
  `;
}

// One transaction row, shared by the Transactions and Daily tabs. The row
// being edited renders as an inline form instead.
let editingId = null;
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
  const list = cats.includes(selected) || !selected ? cats : [selected, ...cats];   // keep a stored category not in the list
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
  clearFields(EDIT_FIELDS);   // don't carry another row's half-edited values over
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

// Transactions-tab search and filters; kept while switching tabs, reset on sign-out.
let txFilter = { query: '', type: 'all', category: 'all' };
function isFiltering(){ return !!txFilter.query.trim() || txFilter.type !== 'all' || txFilter.category !== 'all'; }

function renderTransactions(t){
  const cats = txType === 'income' ? incomeCats() : expenseCats();
  const catOptions = cats.map(c => `<option value="${c}">${c}</option>`).join('');
  const budgets = (state.settings && state.settings.budgets) || {};

  // Newest date first (stable sort keeps same-day entries in insertion order),
  // so month groups appear in date order even after back-dated or edited entries.
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
    </div>
    <div class="filter-summary">
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
        ${state.recurring.map(r => `
          <div class="ledger-line">
            <div class="info">
              <span class="desc">${escapeHtml(r.note || r.category)}</span>
              <span class="cat-tag">${escapeHtml(r.category)}</span>
              <span class="cat-tag">Day ${r.dayOfMonth || 1}</span>
            </div>
            <div class="right">
              <span class="amt ${r.type}">${r.type==='expense'?'-':'+'}${fmt(r.amount)}</span>
              <button type="button" class="del" data-del-recurring="${r.id}" aria-label="Remove recurring ${escapeHtml(r.note || r.category)}"><span aria-hidden="true">✕</span></button>
            </div>
          </div>
        `).join('')}
      </div>` : ''}
    </div>
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

// Last export/import outcome, shown under the Backup buttons.
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

function renderGoals(){
  const goalCards = state.goals.length ? state.goals.map(g => {
    const pct = g.target > 0 ? Math.min(100, Math.round((g.saved / g.target)*100)) : 0;
    return `
      <div class="goal-card">
        <div class="goal-top">
          <span class="goal-name">${escapeHtml(g.name)}</span>
          <button class="del" data-delgoal="${g.id}" aria-label="Delete goal ${escapeHtml(g.name)}"><span aria-hidden="true">✕</span></button>
        </div>
        <div class="goal-nums">${fmt(g.saved)} <span class="target">of ${fmt(g.target)}</span></div>
        <div class="bar-track" style="margin-top:10px;"><div class="bar-fill gold" style="width:${pct}%"></div></div>
        <div class="goal-pct">${pct}% funded</div>
        <div class="goal-actions">
          <input type="number" min="0" step="0.01" placeholder="Amount" inputmode="decimal" id="contrib-${g.id}" aria-label="Amount to add to ${escapeHtml(g.name)}">
          <button class="btn ghost" data-contribute="${g.id}">Add funds</button>
        </div>
      </div>
    `;
  }).join('') : `<div class="empty">No savings goals yet. Create one below — a vacation fund, an emergency cushion, whatever you're working toward.</div>`;

  return `
    <div class="card">
      <h2>Your goals</h2>
      <div class="goal-grid">${goalCards}</div>
    </div>
    <div class="card">
      <h2>New goal</h2>
      <div class="form-row">
        <div class="field" style="flex:2;">
          <label for="goal-name">Goal name</label>
          <input type="text" id="goal-name" placeholder="e.g. Emergency fund">
        </div>
        <div class="field">
          <label for="goal-target">Target amount</label>
          <input type="number" min="0" step="0.01" id="goal-target" placeholder="0.00" inputmode="decimal">
        </div>
      </div>
      <button class="btn" id="add-goal-btn">Create goal</button>
    </div>
  `;
}

function attachPanelHandlers(t){
  // Enter submits the card's primary button (these cards aren't <form>s)
  document.querySelectorAll('.card input, .goal-card input').forEach(inp => {
    if(inp.form) return;   // real <form>s (inline edit) submit on Enter natively
    if(inp.type === 'search') return;   // the filter box has no submit action
    inp.addEventListener('keydown', (e) => {
      if(e.key !== 'Enter') return;
      e.preventDefault();
      const scope = inp.closest('.goal-card, .card');
      const primary = scope && scope.querySelector('button.btn');
      if(primary) primary.click();
    });
  });

  // Monthly expense chart
  const barGroups = document.querySelectorAll('.chart-bar-group');
  if(barGroups.length){
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

  // Daily calendar panel
  document.querySelectorAll('[data-cal-nav]').forEach(btn => {
    btn.addEventListener('click', () => shiftCalendar(parseInt(btn.dataset.calNav, 10)));
  });
  const calTodayBtn = document.querySelector('[data-cal-today]');
  if(calTodayBtn) calTodayBtn.addEventListener('click', goToToday);
  document.querySelectorAll('.day-cell[data-date]').forEach(btn => {
    btn.addEventListener('click', () => { selectedDate = btn.dataset.date; render(); });
  });
  document.querySelectorAll('.toggle-btn[data-dtype]').forEach(btn => {
    btn.addEventListener('click', () => { dailyType = btn.dataset.dtype; render(); });
  });
  const addDailyTxBtn = document.getElementById('add-daily-tx-btn');
  if(addDailyTxBtn){
    addDailyTxBtn.addEventListener('click', () => {
      const amountEl = document.getElementById('daily-amount');
      if(!validateFields([[amountEl, amountError(amountEl.value)]])) return;
      const amount = toCents(amountEl.value);
      const category = document.getElementById('daily-category').value;
      const note = document.getElementById('daily-note').value.trim();
      clearFields(['daily-amount', 'daily-category', 'daily-note']);
      addTransaction({ type: dailyType, amount, category, date: selectedDate, note });
    });
  }

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
    });
  }
  // Search and filters
  const filterQuery = document.getElementById('filter-query');
  if(filterQuery){
    filterQuery.addEventListener('input', () => { txFilter.query = filterQuery.value; render(); });
    document.getElementById('filter-type').addEventListener('change', (e) => { txFilter.type = e.target.value; render(); });
    document.getElementById('filter-category').addEventListener('change', (e) => { txFilter.category = e.target.value; render(); });
    const clearBtn = document.getElementById('filter-clear');
    if(clearBtn) clearBtn.addEventListener('click', () => {
      txFilter = { query: '', type: 'all', category: 'all' };
      clearFields(['filter-query', 'filter-type', 'filter-category']);   // else the draft restorer puts the old values back
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
    if(allBuiltIn.includes(name) || list.includes(name)) return;   // duplicate
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
    // Sync the category dropdown when type changes
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
      generateRecurring();   // generate for current month if not yet done
      render();
    });
  }
  document.querySelectorAll('[data-del-recurring]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.delRecurring;
      state.recurring = (state.recurring || []).filter(r => r.id !== id);
      save(); render();
    });
  });

  const exportJsonBtn = document.getElementById('export-json-btn');
  if(exportJsonBtn){
    exportJsonBtn.addEventListener('click', () => {
      downloadFile(backupFilename('json'), JSON.stringify({ ...state, v: DATA_VERSION, exportedAt: new Date().toISOString() }, null, 2), 'application/json');
      setBackupStatus(`Exported ${state.transactions.length} transactions and ${state.goals.length} goals.`, false);
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
    // Changing type swaps the category list in place (no re-render, so other edits survive).
    const typeSel = document.getElementById('edit-type');
    typeSel.addEventListener('change', () => {
      const catSel = document.getElementById('edit-category');
      const list = typeSel.value === 'income' ? incomeCats() : expenseCats();
      catSel.innerHTML = categoryOptions(typeSel.value, list.includes(catSel.value) ? catSel.value : null);
    });
  }

  // Goals panel
  const addGoalBtn = document.getElementById('add-goal-btn');
  if(addGoalBtn){
    addGoalBtn.addEventListener('click', () => {
      const nameEl = document.getElementById('goal-name');
      const targetEl = document.getElementById('goal-target');
      const name = nameEl.value.trim();
      const ok = validateFields([
        [nameEl, name ? '' : 'Give the goal a name.'],
        [targetEl, amountError(targetEl.value, 'Enter a target amount.')]
      ]);
      if(!ok) return;
      const target = toCents(targetEl.value);
      clearFields(['goal-name', 'goal-target']);
      addGoal({ name, target });
    });
  }
  document.querySelectorAll('[data-delgoal]').forEach(btn => {
    btn.addEventListener('click', () => deleteGoal(btn.dataset.delgoal));
  });
  document.querySelectorAll('[data-contribute]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.contribute;
      const input = document.getElementById(`contrib-${id}`);
      // The input sits in a flex row with its button, so the error goes after the row.
      if(!validateFields([[input, amountError(input.value), input.closest('.goal-actions')]])) return;
      const amount = toCents(input.value);
      clearFields([`contrib-${id}`]);
      contributeToGoal(id, amount);
    });
  });
}

restoreSession();
