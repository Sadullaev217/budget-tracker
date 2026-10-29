const STORAGE_PREFIX = 'ledger-data-v1';
function userStorageKey(id){ return STORAGE_PREFIX + ':' + id; }
const EXPENSE_CATS = ['Food','Housing','Transport','Utilities','Entertainment','Health','Other'];
const INCOME_CATS = ['Salary','Freelance','Gift','Other'];

let state = { transactions: [], goals: [], recurring: [], recurringGenerated: {} };

function expenseCats(){
  return mergeCats(EXPENSE_CATS, state.settings && state.settings.customExpenseCats);
}
function incomeCats(){
  return mergeCats(INCOME_CATS, state.settings && state.settings.customIncomeCats);
}
let activeTab = 'overview';
let txType = 'expense';
let dailyType = 'expense';

let currentUser = null;
let currentUserId = null;
let authMode = 'signin';
let authError = '';
let authMessage = '';

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
  state = { transactions: [], goals: [], recurring: [], recurringGenerated: {} };
  activeTab = 'overview';
  authMode = 'signin';
  authError = '';
  authMessage = '';
  backupStatus = { msg: '', isError: false };
  editingId = null;
  txFilter = { query: '', type: 'all', category: 'all', dateFrom: '', dateTo: '' };
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
        try{ localStorage.setItem(userStorageKey(currentUserId), JSON.stringify(state)); }catch(e){}
        if(changed) save();
        generateRecurring();
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
      if(changed) save();
    }
  }catch(e){}
  generateRecurring();
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
  try {
    if(currentUserId){
      await sb.from('user_data').upsert({
        user_id: currentUserId,
        data: state,
        updated_at: new Date().toISOString()
      });
    }
  } catch(e) {}
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
    btn.addEventListener('click', ()=>{ activeTab = btn.dataset.tab; editingId = null; pendingFocus = '#panels h2, #panels .card'; render(); });
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
  if(deferredInstallPrompt) showInstallBanner();
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

restoreSession();
