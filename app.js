const STORAGE_PREFIX = 'ledger-data-v1';
const USERS_KEY = 'ledger-users';
const SESSION_KEY = 'ledger-current-user';
const EXPENSE_CATS = ['Food','Housing','Transport','Utilities','Entertainment','Health','Other'];
const INCOME_CATS = ['Salary','Freelance','Gift','Other'];

let state = { transactions: [], goals: [] };
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

async function hashPassword(pw){
  if(window.crypto && window.crypto.subtle){
    try{
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
    }catch(e){ /* fall through to non-crypto fallback below */ }
  }
  let h = 0;
  for(let i = 0; i < pw.length; i++){ h = (Math.imul(31, h) + pw.charCodeAt(i)) | 0; }
  return 'fallback:' + h.toString(16);
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
  const hash = await hashPassword(password);
  if(hash !== rec.passwordHash){ authError = 'Incorrect password.'; render(); return; }
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
  users[username] = { passwordHash: await hashPassword(password) };
  saveUsers(users);
  currentUser = username;
  localStorage.setItem(SESSION_KEY, username);
  loadUserData();
  render();
}

function signOut(){
  currentUser = null;
  localStorage.removeItem(SESSION_KEY);
  state = { transactions: [], goals: [] };
  activeTab = 'overview';
  authMode = 'signin';
  authError = '';
  backupStatus = { msg: '', isError: false };
  render();
}

function loadUserData(){
  state = { transactions: [], goals: [] };
  try{
    const raw = localStorage.getItem(userStorageKey(currentUser));
    if(raw){
      const { data, changed } = migrateData(JSON.parse(raw));
      state = data;
      if(changed) save();
    }
  }catch(e){
    // no existing data yet
  }
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
  state.transactions = state.transactions.filter(t => t.id !== id);
  save(); render();
}
function addGoal(data){
  state.goals.push({ id: uid(), saved: 0, ...data });
  save(); render();
}
function deleteGoal(id){
  state.goals = state.goals.filter(g => g.id !== id);
  save(); render();
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
  const shortAmt = cents => { const v = cents / 100; return v >= 1000 ? '$' + (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : '$' + Math.round(v); };

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

  const entryLines = selectedEntries.length ? selectedEntries.map(tx => `
    <div class="ledger-line">
      <div class="info">
        <span class="desc">${escapeHtml(tx.note || tx.category)}</span>
        <span class="cat-tag">${escapeHtml(tx.category)}</span>
      </div>
      <div class="right">
        <span class="amt ${tx.type}">${tx.type==='expense'?'-':'+'}${fmt(tx.amount)}</span>
        <button class="del" data-del="${tx.id}" aria-label="Delete ${escapeHtml(tx.note || tx.category)} entry, ${tx.type==='expense'?'expense':'income'} of ${fmt(tx.amount)}"><span aria-hidden="true">✕</span></button>
      </div>
    </div>
  `).join('') : `<div class="empty">No entries on this day yet.</div>`;

  const cats = dailyType === 'income' ? INCOME_CATS : EXPENSE_CATS;
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
function focusSelector(){
  const el = document.activeElement;
  if(!el || el === document.body) return null;
  if(el.id) return '#' + CSS.escape(el.id);
  if(el.hasAttribute('data-cal-today')) return '[data-cal-today]';
  for(const a of FOCUS_ATTRS){
    if(el.hasAttribute(a)) return `[${a}="${CSS.escape(el.getAttribute(a))}"]`;
  }
  return null;
}
function restoreFocus(sel){
  if(!sel) return;
  const el = document.querySelector(sel);
  if(el) el.focus({ preventScroll: true });
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
    btn.addEventListener('click', ()=>{ activeTab = btn.dataset.tab; render(); });
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
  const catEntries = Object.entries(t.byCategory).sort((a,b)=>b[1]-a[1]);
  const maxCat = catEntries.length ? catEntries[0][1] : 1;

  const catRows = catEntries.length ? catEntries.map(([cat, amt]) => `
    <div class="cat-row">
      <div class="cat-top"><span>${escapeHtml(cat)}</span><span class="amt">${fmt(amt)}</span></div>
      <div class="bar-track"><div class="bar-fill navy" style="width:${Math.round((amt/maxCat)*100)}%"></div></div>
    </div>
  `).join('') : `<div class="empty">No expenses logged yet. Add one from the Transactions tab.</div>`;

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

function renderTransactions(t){
  const cats = txType === 'income' ? INCOME_CATS : EXPENSE_CATS;
  const catOptions = cats.map(c => `<option value="${c}">${c}</option>`).join('');

  const grouped = {};
  state.transactions.forEach(tx => {
    const mk = monthKey(tx.date);
    grouped[mk] = grouped[mk] || [];
    grouped[mk].push(tx);
  });

  const lines = Object.keys(grouped).length ? Object.entries(grouped).map(([month, txs]) => `
    <div class="ledger-month">${month}</div>
    ${txs.map(tx => `
      <div class="ledger-line">
        <div class="info">
          <span class="desc">${escapeHtml(tx.note || tx.category)}</span>
          <span class="cat-tag">${escapeHtml(tx.category)}</span>
        </div>
        <div class="right">
          <span class="amt ${tx.type}">${tx.type==='expense'?'-':'+'}${fmt(tx.amount)}</span>
          <button class="del" data-del="${tx.id}" aria-label="Delete ${escapeHtml(tx.note || tx.category)} entry, ${tx.type==='expense'?'expense':'income'} of ${fmt(tx.amount)}"><span aria-hidden="true">✕</span></button>
        </div>
      </div>
    `).join('')}
  `).join('') : `<div class="empty">No entries yet. Log your first transaction above.</div>`;

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
      ${lines}
      ${state.transactions.length ? `
      <div class="total-line">
        <span>Net</span>
        <span>${fmt(t.balance)}</span>
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
  data.transactions.forEach(t => { if(!t.id) t.id = uid(); });
  data.goals.forEach(g => { if(!g.id) g.id = uid(); });
  state = data;
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
