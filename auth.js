// Auth via Supabase (email + password).
// Globals: authMode, authError, currentUser, currentUserId, state,
//   escapeHtml, SUN_ICON, MOON_ICON, toggleTheme, loadUserData, render, sb.

async function signIn(email, password){
  authError = '';
  email = email.trim();
  if(!email){ authError = 'Enter your email.'; render(); return; }
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if(error){ authError = error.message; render(); return; }
  currentUser = data.user.email;
  currentUserId = data.user.id;
  await loadUserData();
  render();
}

async function signUp(email, password, confirm){
  email = email.trim();
  authError = '';
  if(!email){ authError = 'Enter your email.'; render(); return; }
  if(password.length < 6){ authError = 'Password must be at least 6 characters.'; render(); return; }
  if(password !== confirm){ authError = 'Passwords do not match.'; render(); return; }
  const { data, error } = await sb.auth.signUp({ email, password });
  if(error){ authError = error.message; render(); return; }
  if(data.session){
    currentUser = data.user.email;
    currentUserId = data.user.id;
    await loadUserData();
    render();
  } else {
    authError = 'Check your email to confirm your account, then sign in.';
    authMode = 'signin';
    render();
  }
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
            <label for="auth-email">Email</label>
            <input type="email" id="auth-email" autocomplete="email" placeholder="you@example.com"${authError ? ' aria-invalid="true" aria-describedby="auth-error"' : ''}>
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
      const email = document.getElementById('auth-email').value;
      const password = document.getElementById('auth-password').value;
      if(authMode === 'signup'){
        const confirm = document.getElementById('auth-password-confirm').value;
        signUp(email, password, confirm);
      } else {
        signIn(email, password);
      }
    });
  }
}
