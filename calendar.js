// Calendar: daily view rendering and navigation.
// Globals used: calYear, calMonthIdx, selectedDate, dailyType, state,
//   todayISO, fmt, sumDay, renderLedgerLine, incomeCats, expenseCats,
//   render, addTransaction, toCents, amountError, validateFields, clearFields.

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
    : `<div class="empty">No entries on this day. Add one below.</div>`;

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

function attachCalendarHandlers(){
  document.querySelectorAll('[data-cal-nav]').forEach(btn => {
    btn.addEventListener('click', () => shiftCalendar(parseInt(btn.dataset.calNav, 10)));
  });
  const calTodayBtn = document.querySelector('[data-cal-today]');
  if(calTodayBtn) calTodayBtn.addEventListener('click', goToToday);
  document.querySelectorAll('.day-cell[data-date]').forEach(btn => {
    btn.addEventListener('click', () => { selectedDate = btn.dataset.date; render(); });
    btn.addEventListener('keydown', (e) => {
      const days = Array.from(document.querySelectorAll('.day-cell[data-date]'));
      const idx = days.indexOf(btn);
      let target = null;
      if(e.key === 'ArrowRight') target = days[idx + 1];
      else if(e.key === 'ArrowLeft') target = days[idx - 1];
      else if(e.key === 'ArrowDown') target = days[idx + 7];
      else if(e.key === 'ArrowUp') target = days[idx - 7];
      else if(e.key === 'Enter' || e.key === ' '){ selectedDate = btn.dataset.date; render(); e.preventDefault(); return; }
      else if(e.key === 'Escape'){ btn.blur(); e.preventDefault(); return; }
      else return;
      if(target){ e.preventDefault(); target.focus(); }
    });
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
}
