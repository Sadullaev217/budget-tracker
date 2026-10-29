// Goals tab: savings goal rendering and handlers.
// Globals used: state, fmt, escapeHtml, incomeCats, toCents, amountError,
//   validateFields, clearFields, addGoal, deleteGoal, contributeToGoal, render.

function renderGoals(){
  const goalCards = state.goals.length ? state.goals.map(g => {
    const autoContrib = g.linkedCategory ? state.transactions.filter(t => t.type === 'income' && t.category === g.linkedCategory).reduce((s, t) => s + t.amount, 0) : 0;
    const totalSaved = g.saved + autoContrib;
    const pct = g.target > 0 ? Math.min(100, Math.round((totalSaved / g.target)*100)) : 0;
    return `
      <div class="goal-card" draggable="true" data-goalid="${g.id}">
        <div class="goal-top">
          <span class="goal-name">${escapeHtml(g.name)}</span>
          <button class="del" data-delgoal="${g.id}" aria-label="Delete goal ${escapeHtml(g.name)}"><span aria-hidden="true">✕</span></button>
        </div>
        <div class="goal-nums">${fmt(totalSaved)} <span class="target">of ${fmt(g.target)}</span></div>
        <div class="bar-track" style="margin-top:10px;"><div class="bar-fill gold" style="width:${pct}%"></div></div>
        <div class="goal-pct">${pct}% funded</div>
        ${g.linkedCategory ? `<div class="goal-linked">Tracking income from: ${escapeHtml(g.linkedCategory)}${autoContrib ? ` (${fmt(autoContrib)} auto)` : ''}</div>` : ''}
        ${(function(){
          if(!g.deadline || totalSaved >= g.target) return '';
          const remaining = g.target - totalSaved;
          const today = new Date();
          const dl = new Date(g.deadline + 'T00:00:00');
          const msLeft = dl - today;
          if(msLeft <= 0) return '<div class="goal-deadline behind">Deadline passed — ' + fmt(remaining) + ' still needed.</div>';
          const monthsLeft = Math.max(1, Math.ceil(msLeft / (1000*60*60*24*30)));
          const perMonth = Math.round(remaining / monthsLeft);
          const dlLabel = dl.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
          const totalMonths = Math.ceil((dl - new Date(g.id ? state.goals.find(x=>x.id===g.id) : g).saved) / (1000*60*60*24*30)) || monthsLeft;
          const progressPct = g.target > 0 ? totalSaved / g.target : 0;
          const timePct = totalMonths > 0 ? (totalMonths - monthsLeft) / totalMonths : 0;
          const cls = progressPct >= timePct ? 'on-track' : 'behind';
          return '<div class="goal-deadline ' + cls + '">Save ' + fmt(perMonth) + '/mo to reach goal by ' + escapeHtml(dlLabel) + ' (' + monthsLeft + ' mo left)</div>';
        })()}
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
        <div class="field">
          <label for="goal-deadline">Target date <span style="opacity:.5">(optional)</span></label>
          <input type="date" id="goal-deadline">
        </div>
        <div class="field">
          <label for="goal-link-cat">Track income from</label>
          <select id="goal-link-cat">
            <option value="">None (manual only)</option>
            ${incomeCats().map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
          </select>
        </div>
      </div>
      <button class="btn" id="add-goal-btn">Create goal</button>
    </div>
  `;
}

function attachGoalHandlers(){
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
      const linkCatEl = document.getElementById('goal-link-cat');
      const linkedCategory = linkCatEl ? linkCatEl.value : '';
      const deadlineEl = document.getElementById('goal-deadline');
      const deadline = deadlineEl ? deadlineEl.value : '';
      clearFields(['goal-name', 'goal-target', 'goal-link-cat', 'goal-deadline']);
      addGoal({ name, target, ...(linkedCategory ? { linkedCategory } : {}), ...(deadline ? { deadline } : {}) });
    });
  }
  document.querySelectorAll('[data-delgoal]').forEach(btn => {
    btn.addEventListener('click', () => deleteGoal(btn.dataset.delgoal));
  });
  document.querySelectorAll('[data-contribute]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.contribute;
      const input = document.getElementById(`contrib-${id}`);
      if(!validateFields([[input, amountError(input.value), input.closest('.goal-actions')]])) return;
      const amount = toCents(input.value);
      clearFields([`contrib-${id}`]);
      contributeToGoal(id, amount);
    });
  });

  // Drag to reorder goals
  let dragId = null;
  document.querySelectorAll('.goal-card[draggable]').forEach(card => {
    card.addEventListener('dragstart', e => {
      dragId = card.dataset.goalid;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.goal-card.drag-over').forEach(c => c.classList.remove('drag-over'));
      dragId = null;
    });
    card.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if(card.dataset.goalid !== dragId) card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('drag-over');
      if(!dragId || card.dataset.goalid === dragId) return;
      const fromIdx = state.goals.findIndex(g => g.id === dragId);
      const toIdx = state.goals.findIndex(g => g.id === card.dataset.goalid);
      if(fromIdx < 0 || toIdx < 0) return;
      const [moved] = state.goals.splice(fromIdx, 1);
      state.goals.splice(toIdx, 0, moved);
      save();
      render();
    });
  });
}
