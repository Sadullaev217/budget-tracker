const STORAGE_PREFIX = 'ledger-data-v1';
function userStorageKey(id){ return STORAGE_PREFIX + ':' + id; }
const EXPENSE_CATS = ['Food','Housing','Transport','Utilities','Entertainment','Health','Other'];
const INCOME_CATS = ['Salary','Freelance','Gift','Other'];

const DEFAULT_ACCOUNTS = ['Cash','Bank','Credit card'];
let state = { transactions: [], goals: [], recurring: [], recurringGenerated: {}, trash: [] };
function accounts(){
  const custom = (state.settings && state.settings.accounts) || [];
  return custom.length ? custom : DEFAULT_ACCOUNTS;
}
let activeAccount = 'all';

function expenseCats(){
  return mergeCats(EXPENSE_CATS, state.settings && state.settings.customExpenseCats);
}
function incomeCats(){
  return mergeCats(INCOME_CATS, state.settings && state.settings.customIncomeCats);
}
let activeTab = 'overview';
let overviewRange = 'month';
let customRange = { from: '', to: '' };
let alertsCollapsed = false;
let txType = 'expense';
let dailyType = 'expense';

let currentUser = null;
let currentUserId = null;
let authMode = 'signin';
let authError = '';
let authMessage = '';
let syncStatus = 'synced';

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
  if(currentUser){
    if(!state.settings) state.settings = {};
    state.settings.theme = next;
    save();
  }
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

// Auth (Supabase signIn, signUp, renderAuthScreen, attachAuthHandlers) → auth.js

async function signOut(){
  await sb.auth.signOut();
  currentUser = null;
  currentUserId = null;
  state = { transactions: [], goals: [], recurring: [], recurringGenerated: {}, trash: [] };
  activeTab = 'overview';
  authMode = 'signin';
  authError = '';
  authMessage = '';
  backupStatus = { msg: '', isError: false };
  editingId = null;
  txFilter = { query: '', type: 'all', category: 'all', dateFrom: '', dateTo: '', tag: '' };
  activeAccount = 'all';
  hideToast();
  render();
}

async function loadUserData(){
  state = { transactions: [], goals: [], recurring: [], recurringGenerated: {} };
  try {
    if(currentUserId){
      const { data } = await sb.from('user_data').select('data').eq('user_id', currentUserId).maybeSingle();
      if(data && data.data){
        const { data: migrated, changed } = migrateData(data.data);
        state = migrated;
        if(!state.recurring) state.recurring = [];
        if(!state.recurringGenerated) state.recurringGenerated = {};
        if(!state.trash) state.trash = [];
        try{ localStorage.setItem(userStorageKey(currentUserId), JSON.stringify(state)); }catch(e){}
        if(changed) save();
        generateRecurring();
        purgeOldTrash();
        checkBillReminders();
        return;
      }
    }
  } catch(e) {}
  try{
    const raw = localStorage.getItem(userStorageKey(currentUserId));
    if(raw){
      const { data: migrated, changed } = migrateData(JSON.parse(raw));
      state = migrated;
      if(!state.recurring) state.recurring = [];
      if(!state.recurringGenerated) state.recurringGenerated = {};
      if(!state.trash) state.trash = [];
      if(changed) save();
    }
  }catch(e){}
  generateRecurring();
  purgeOldTrash();
  checkBillReminders();
  if(state.settings && state.settings.theme){
    document.documentElement.setAttribute('data-theme', state.settings.theme);
    try{ localStorage.setItem(THEME_KEY, state.settings.theme); }catch(e){}
  }
}

// Auto-generate transactions from recurring templates for the current month.
function generateRecurring(){
  const { entries, generated } = generateRecurringEntries(state.recurring, state.recurringGenerated || {}, new Date(), uid);
  if(!entries.length) return;
  entries.forEach(e => state.transactions.push(e));
  Object.assign(state.recurringGenerated, generated);
  save();
}

function checkBillReminders(){
  if(!state.recurring || !state.recurring.length) return;
  if(!(state.settings && state.settings.billReminders)) return;
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date();
  const today = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  state.recurring.forEach(r => {
    const day = Math.min(r.dayOfMonth || 1, daysInMonth);
    let diff = day - today;
    if(diff < 0) diff += daysInMonth;
    if(diff >= 0 && diff <= 3){
      const label = r.note || r.category;
      const when = diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : `in ${diff} days`;
      new Notification('Bill reminder', { body: `${label}: ${fmt(r.amount)} due ${when}`, icon: 'icon-192.png' });
    }
  });
}

async function restoreSession(){
  sb.auth.onAuthStateChange((event) => {
    if(event === 'PASSWORD_RECOVERY'){
      authMode = 'newpassword';
      currentUser = null;
      currentUserId = null;
      render();
    }
  });
  try {
    const { data: { session } } = await sb.auth.getSession();
    if(session && authMode !== 'newpassword'){
      currentUser = session.user.email;
      currentUserId = session.user.id;
      await loadUserData();
    }
  } catch(e) {}
  render();
}

async function save(){
  if(!currentUser) return;
  state.v = DATA_VERSION;
  try{ localStorage.setItem(userStorageKey(currentUserId), JSON.stringify(state)); }catch(e){}
  syncStatus = 'syncing';
  updateSyncDot();
  try {
    if(currentUserId){
      await sb.from('user_data').upsert({
        user_id: currentUserId,
        data: state,
        updated_at: new Date().toISOString()
      });
      syncStatus = 'synced';
    }
  } catch(e) {
    syncStatus = 'offline';
  }
  updateSyncDot();
}
function updateSyncDot(){
  const el = document.getElementById('sync-dot');
  if(!el) return;
  el.className = 'sync-dot ' + syncStatus;
  el.setAttribute('aria-label', syncStatus === 'synced' ? 'Data synced' : syncStatus === 'syncing' ? 'Syncing…' : 'Offline — saved locally');
  el.title = el.getAttribute('aria-label');
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
  item._deletedAt = new Date().toISOString();
  if(!state.trash) state.trash = [];
  state.trash.push(item);
  save(); render();
  showUndoToast(`Moved "${item.note || item.category}" to trash.`, () => {
    state.trash = (state.trash || []).filter(t => t.id !== item.id);
    delete item._deletedAt;
    state.transactions.splice(Math.min(idx, state.transactions.length), 0, item);
    save(); render();
  });
}
function restoreFromTrash(id){
  if(!state.trash) return;
  const idx = state.trash.findIndex(t => t.id === id);
  if(idx < 0) return;
  const [item] = state.trash.splice(idx, 1);
  delete item._deletedAt;
  state.transactions.push(item);
  save(); render();
}
function permanentDelete(id){
  if(!state.trash) return;
  state.trash = state.trash.filter(t => t.id !== id);
  save(); render();
}
function emptyTrash(){
  state.trash = [];
  save(); render();
}
function purgeOldTrash(){
  if(!state.trash || !state.trash.length) return;
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  state.trash = state.trash.filter(t => t._deletedAt > cutoff);
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
  if(g){
    g.saved = Math.max(0, g.saved + amount);
    if(!g.contributions) g.contributions = [];
    g.contributions.push({ date: todayISO(), amount });
    save(); render();
  }
}

function totals(){ return sumTotals(state.transactions); }

function monthKey(dateStr){
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

// Calendar (pad2, transactionsForDate, dayTotals, shiftCalendar, goToToday, renderDaily) → calendar.js
// Charts (renderChart, renderCategoryChart, attachChartHandlers) → chart.js

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
          <div class="signed-in-as">signed in as <strong>${escapeHtml(currentUser)}</strong> <span class="sync-dot ${syncStatus}" id="sync-dot" aria-label="${syncStatus === 'synced' ? 'Data synced' : syncStatus === 'syncing' ? 'Syncing…' : 'Offline — saved locally'}" title="${syncStatus === 'synced' ? 'Data synced' : syncStatus === 'syncing' ? 'Syncing…' : 'Offline — saved locally'}"></span></div>
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
    btn.addEventListener('click', ()=>{ activeTab = btn.dataset.tab; editingId = null; pendingFocus = '#panels h2, #panels .card'; render(); });
  });
  const themeBtn = document.getElementById('theme-toggle');
  if(themeBtn) themeBtn.addEventListener('click', toggleTheme);
  const signOutBtn = document.getElementById('sign-out-btn');
  if(signOutBtn) signOutBtn.addEventListener('click', signOut);

  const panels = document.getElementById('panels');
  if(activeTab === 'overview') panels.innerHTML = renderOverview();
  else if(activeTab === 'transactions') panels.innerHTML = renderTransactions(t);
  else if(activeTab === 'daily') panels.innerHTML = renderDaily();
  else panels.innerHTML = renderGoals();

  attachPanelHandlers(t);
  if(deferredInstallPrompt) showInstallBanner();

  // Onboarding overlay for new users
  if(!state.transactions.length && !(state.settings && state.settings.onboarded)){
    showOnboarding();
  }

  restoreDrafts(drafts);
  restoreFocus(focusSel);
}

let onboardStep = 0;
function showOnboarding(){
  if(document.getElementById('onboarding-overlay')) return;
  const steps = [
    { title: 'Welcome to The Ledger', body: 'Track your income, expenses, and savings in one place. Everything syncs across devices.' },
    { title: 'Log transactions', body: 'Head to the Transactions tab to add entries. Use tags, accounts, and categories to organize.' },
    { title: 'Set goals & budgets', body: 'Create savings goals in the Goals tab and monthly budgets in Settings. You\'re all set!' }
  ];
  onboardStep = 0;
  const overlay = document.createElement('div');
  overlay.id = 'onboarding-overlay';
  overlay.className = 'onboarding-overlay';
  function renderStep(){
    const s = steps[onboardStep];
    const isLast = onboardStep === steps.length - 1;
    overlay.innerHTML = `<div class="onboarding-card">
      <div class="onboarding-dots">${steps.map((_,i) => `<span class="dot${i === onboardStep ? ' active' : ''}"></span>`).join('')}</div>
      <h2>${s.title}</h2>
      <p>${s.body}</p>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" class="btn ghost" id="onboard-skip">Skip</button>
        <button type="button" class="btn" id="onboard-next">${isLast ? 'Get started' : 'Next'}</button>
      </div>
    </div>`;
    overlay.querySelector('#onboard-skip').addEventListener('click', dismiss);
    overlay.querySelector('#onboard-next').addEventListener('click', () => {
      if(isLast) dismiss();
      else { onboardStep++; renderStep(); }
    });
  }
  function dismiss(){
    overlay.remove();
    state.settings = { ...(state.settings || {}), onboarded: true };
    save();
  }
  renderStep();
  document.body.appendChild(overlay);
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

// renderOverview → overview.js
// renderTransactions, backup helpers → transactions.js
// renderGoals, attachGoalHandlers → goals.js

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

  const alertsToggle = document.getElementById('alerts-toggle');
  if(alertsToggle) alertsToggle.addEventListener('click', () => { alertsCollapsed = !alertsCollapsed; render(); });

  document.querySelectorAll('[data-range]').forEach(btn => {
    btn.addEventListener('click', () => { overviewRange = btn.dataset.range; render(); });
  });
  document.querySelectorAll('[data-acct]').forEach(btn => {
    btn.addEventListener('click', () => { activeAccount = btn.dataset.acct; render(); });
  });
  document.querySelectorAll('[data-cat-link]').forEach(el => {
    const handler = () => {
      txFilter = { query: '', type: 'expense', category: el.dataset.catLink, dateFrom: '', dateTo: '', tag: '' };
      activeTab = 'transactions';
      pendingFocus = '#filter-category';
      render();
    };
    el.addEventListener('click', handler);
    el.addEventListener('keydown', (e) => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); handler(); } });
  });
  const crFrom = document.getElementById('custom-range-from');
  const crTo = document.getElementById('custom-range-to');
  if(crFrom) crFrom.addEventListener('change', () => { customRange.from = crFrom.value; render(); });
  if(crTo) crTo.addEventListener('change', () => { customRange.to = crTo.value; render(); });

  const reportBtn = document.getElementById('download-report-btn');
  if(reportBtn) reportBtn.addEventListener('click', generateReport);

  attachChartHandlers();
  attachCalendarHandlers();

  attachTransactionHandlers(t);
  attachGoalHandlers();
}

// PWA install prompt — capture the browser event and offer an install banner.
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if(currentUser) showInstallBanner();
});

function showInstallBanner(){
  if(!deferredInstallPrompt) return;
  if(document.querySelector('.install-banner')) return;
  const panels = document.getElementById('panels');
  if(!panels) return;
  const bar = document.createElement('div');
  bar.className = 'install-banner';
  bar.innerHTML = '<span>Install Ledger for quick access and offline use.</span>'
    + '<button type="button" id="install-btn">Install</button>'
    + '<button type="button" class="dismiss" id="install-dismiss">Not now</button>';
  panels.prepend(bar);
  document.getElementById('install-btn').addEventListener('click', () => {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(() => { deferredInstallPrompt = null; bar.remove(); });
  });
  document.getElementById('install-dismiss').addEventListener('click', () => {
    bar.remove();
    deferredInstallPrompt = null;
  });
}

function generateReport(){
  const now = new Date();
  let from, to, label;
  if(overviewRange === 'custom'){
    from = customRange.from || ''; to = customRange.to || '';
    label = (from && to) ? from + ' to ' + to : 'Custom range';
  } else {
    ({ from, to } = dateRange(overviewRange, now));
    label = { month: 'This month', lastmonth: 'Last month', quarter: 'This quarter', year: 'This year', all: 'All time' }[overviewRange] || overviewRange;
  }
  const filtered = from ? state.transactions.filter(tx => (!from || tx.date >= from) && (!to || tx.date <= to)) : state.transactions;
  const t = sumTotals(filtered);
  const catEntries = Object.entries(t.byCategory).sort((a, b) => b[1] - a[1]);
  const topCats = catEntries.slice(0, 8).map(([cat, amt]) =>
    `<tr><td>${escapeHtml(cat)}</td><td style="text-align:right">${fmt(amt)}</td><td style="text-align:right">${t.expense > 0 ? Math.round((amt / t.expense) * 100) : 0}%</td></tr>`
  ).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Ledger Report — ${escapeHtml(label)}</title>
<style>body{font-family:'IBM Plex Sans',system-ui,sans-serif;max-width:700px;margin:40px auto;color:#1a1a2e;padding:0 20px}
h1{font-size:1.4rem;margin-bottom:4px}h2{font-size:1rem;margin-top:24px;border-bottom:1px solid #ddd;padding-bottom:4px}
.period{color:#666;font-size:0.9rem}.summary{display:flex;gap:32px;margin:16px 0}.summary div{text-align:center}
.summary .label{font-size:0.8rem;color:#666}.summary .value{font-size:1.3rem;font-weight:600}
.income .value{color:#059669}.expense .value{color:#DC2626}
table{width:100%;border-collapse:collapse;font-size:0.88rem}td,th{padding:6px 8px;text-align:left;border-bottom:1px solid #eee}
th{font-weight:600;font-size:0.78rem;color:#666;text-transform:uppercase}
.footer{margin-top:32px;font-size:0.75rem;color:#999;text-align:center}
@media print{body{margin:0}}</style></head><body>
<h1>The Ledger — Financial Report</h1>
<p class="period">${escapeHtml(label)} · Generated ${now.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</p>
<div class="summary">
  <div class="income"><div class="label">Income</div><div class="value">${fmt(t.income)}</div></div>
  <div class="expense"><div class="label">Expenses</div><div class="value">${fmt(t.expense)}</div></div>
  <div><div class="label">Balance</div><div class="value">${fmt(t.balance)}</div></div>
  <div><div class="label">Transactions</div><div class="value">${filtered.length}</div></div>
</div>
${catEntries.length ? `<h2>Top spending categories</h2><table><tr><th>Category</th><th style="text-align:right">Amount</th><th style="text-align:right">Share</th></tr>${topCats}</table>` : ''}
<div class="footer">Generated by The Ledger · ${window.location.origin}</div>
</body></html>`;
  const w = window.open('', '_blank');
  if(w){ w.document.write(html); w.document.close(); w.focus(); w.print(); }
}

// Keyboard shortcuts (only when not in an input/form)
document.addEventListener('keydown', (e) => {
  if(!currentUser) return;
  const tag = (document.activeElement || {}).tagName;
  if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if(e.ctrlKey || e.metaKey || e.altKey) return;
  switch(e.key){
    case '1': activeTab = 'overview'; render(); break;
    case '2': activeTab = 'transactions'; pendingFocus = '#tx-amount'; render(); break;
    case '3': activeTab = 'daily'; render(); break;
    case '4': activeTab = 'goals'; render(); break;
    case 'n': case 'N':
      if(activeTab !== 'transactions'){ activeTab = 'transactions'; }
      pendingFocus = '#tx-amount'; render(); break;
    case 'Escape':
      if(editingId){ editingId = null; render(); }
      break;
  }
});

// Handle PWA shortcut query params
(function(){
  var params = new URLSearchParams(window.location.search);
  var tab = params.get('tab');
  if(tab && ['overview','transactions','daily','goals'].includes(tab)) activeTab = tab;
  var type = params.get('type');
  if(type === 'income' || type === 'expense') txType = type;
  if(params.toString()) history.replaceState(null, '', window.location.pathname);
})();

restoreSession();
