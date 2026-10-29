// Goals tab: savings goal rendering and handlers.
// Globals used: state, fmt, escapeHtml, incomeCats, toCents, amountError,
//   validateFields, clearFields, addGoal, deleteGoal, contributeToGoal, render.

function renderGoals(){
  const goalCards = state.goals.length ? state.goals.map(g => {
    const autoContrib = g.linkedCategory ? state.transactions.filter(t => t.type === 'income' && t.category === g.linkedCategory).reduce((s, t) => s + t.amount, 0) : 0;
    const totalSaved = g.saved + autoContrib;
    const pct = g.target > 0 ? Math.min(100, Math.round((totalSaved / g.target)*100)) : 0;
    return `
      <div class="goal-card">
        <div class="goal-top">
          <span class="goal-name">${escapeHtml(g.name)}</span>
          <button class="del" data-delgoal="${g.id}" aria-label="Delete goal ${escapeHtml(g.name)}"><span aria-hidden="true">✕</span></button>
        </div>
        <div class="goal-nums">${fmt(totalSaved)} <span class="target">of ${fmt(g.target)}</span></div>
        <div class="bar-track" style="margin-top:10px;"><div class="bar-fill gold" style="width:${pct}%"></div></div>
        <div class="goal-pct">${pct}% funded</div>
        ${g.linkedCategory ? `<div class="goal-linked">Tracking income from: ${escapeHtml(g.linkedCategory)}${autoContrib ? ` (${fmt(autoContrib)} auto)` : ''}</div>` : ''}
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
      clearFields(['goal-name', 'goal-target', 'goal-link-cat']);
      addGoal({ name, target, ...(linkedCategory ? { linkedCategory } : {}) });
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
}
