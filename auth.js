// Auth via Supabase (email + password).
// Globals: authMode, authError, authMessage, currentUser, currentUserId, state,
//   escapeHtml, SUN_ICON, MOON_ICON, toggleTheme, loadUserData, render, sb.

async function signIn(email, password){
  authError = ''; authMessage = '';
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
  authError = ''; authMessage = '';
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
    authMessage = 'Check your email to confirm your account, then sign in.';
    authMode = 'signin';
    render();
  }
}

async function sendPasswordReset(email){
  email = email.trim();
  authError = ''; authMessage = '';
  if(!email){ authError = 'Enter your email first.'; render(); return; }
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
  if(error){ authError = error.message; render(); return; }
  authMessage = 'Password reset link sent — check your email.';
  authMode = 'signin';
  render();
}

async function updatePassword(password, confirm){
  authError = ''; authMessage = '';
  if(password.length < 6){ authError = 'Password must be at least 6 characters.'; render(); return; }
  if(password !== confirm){ authError = 'Passwords do not match.'; render(); return; }
  const { error } = await sb.auth.updateUser({ password });
  if(error){ authError = error.message; render(); return; }
  authMode = 'signin';
  authMessage = '';
  const { data: { session } } = await sb.auth.getSession();
  if(session){
    currentUser = session.user.email;
    currentUserId = session.user.id;
    await loadUserData();
  }
  render();
}

function renderAuthScreen(){
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const isSignup = authMode === 'signup';
  const isReset = authMode === 'reset';
  const isNewPw = authMode === 'newpassword';

  let formBody = '';
  let submitLabel = '';

  if(isNewPw){
    submitLabel = 'Set new password';
    formBody = `
      <div class="field" style="margin-bottom:14px;">
        <label for="auth-password">New password</label>
        <input type="password" id="auth-password" autocomplete="new-password" placeholder="••••••••">
      </div>
      <div class="field" style="margin-bottom:14px;">
        <label for="auth-password-confirm">Confirm new password</label>
        <input type="password" id="auth-password-confirm" autocomplete="new-password" placeholder="••••••••">
      </div>`;
  } else if(isReset){
    submitLabel = 'Send reset link';
    formBody = `
      <div class="field" style="margin-bottom:14px;">
        <label for="auth-email">Email</label>
        <input type="email" id="auth-email" autocomplete="email" placeholder="you@example.com"${authError ? ' aria-invalid="true" aria-describedby="auth-error"' : ''}>
      </div>`;
  } else {
    submitLabel = isSignup ? 'Create account' : 'Sign in';
    formBody = `
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
      </div>` : ''}`;
  }

  const tabs = (isReset || isNewPw) ? '' : `
    <div class="tabs auth-tabs" role="group" aria-label="Account mode">
      <button type="button" class="tab ${!isSignup?'active':''}" data-authmode="signin" aria-pressed="${!isSignup}">Sign in</button>
      <button type="button" class="tab ${isSignup?'active':''}" data-authmode="signup" aria-pressed="${isSignup}">Create account</button>
    </div>`;

  const forgot = (!isSignup && !isReset && !isNewPw)
    ? '<div class="auth-forgot"><button type="button" id="forgot-btn" class="link-btn">Forgot password?</button></div>' : '';

  const backLink = (isReset || isNewPw)
    ? '<div class="auth-forgot"><button type="button" id="back-signin-btn" class="link-btn">&larr; Back to sign in</button></div>' : '';

  return `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-card-top">
          <button type="button" class="theme-toggle" id="theme-toggle" aria-label="${isDark ? 'Switch to light mode' : 'Switch to dark mode'}">${isDark ? SUN_ICON : MOON_ICON}</button>
        </div>
        <h1 class="auth-title">The Ledger</h1>
        <div class="auth-tagline">${isReset ? 'reset your password' : isNewPw ? 'choose a new password' : 'income, expenses & savings, kept in order'}</div>
        ${tabs}
        <form id="auth-form" novalidate>
          ${formBody}
          ${authMessage ? `<div class="auth-message" role="status">${escapeHtml(authMessage)}</div>` : ''}
          ${authError ? `<div class="auth-error" id="auth-error" role="alert">${escapeHtml(authError)}</div>` : ''}
          <button type="submit" id="auth-submit" class="btn" style="width:100%;">${submitLabel}</button>
        </form>
        ${forgot}
        ${backLink}
      </div>
    </div>
  `;
}

function attachAuthHandlers(){
  const themeBtn = document.getElementById('theme-toggle');
  if(themeBtn) themeBtn.addEventListener('click', toggleTheme);

  document.querySelectorAll('[data-authmode]').forEach(btn => {
    btn.addEventListener('click', () => { authMode = btn.dataset.authmode; authError = ''; authMessage = ''; render(); });
  });

  const forgotBtn = document.getElementById('forgot-btn');
  if(forgotBtn) forgotBtn.addEventListener('click', () => { authMode = 'reset'; authError = ''; authMessage = ''; render(); });

  const backBtn = document.getElementById('back-signin-btn');
  if(backBtn) backBtn.addEventListener('click', () => { authMode = 'signin'; authError = ''; authMessage = ''; render(); });

  const form = document.getElementById('auth-form');
  if(form){
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if(authMode === 'newpassword'){
        const pw = document.getElementById('auth-password').value;
        const confirm = document.getElementById('auth-password-confirm').value;
        updatePassword(pw, confirm);
      } else if(authMode === 'reset'){
        const email = document.getElementById('auth-email').value;
        sendPasswordReset(email);
      } else if(authMode === 'signup'){
        const email = document.getElementById('auth-email').value;
        const password = document.getElementById('auth-password').value;
        const confirm = document.getElementById('auth-password-confirm').value;
        signUp(email, password, confirm);
      } else {
        const email = document.getElementById('auth-email').value;
        const password = document.getElementById('auth-password').value;
        signIn(email, password);
      }
    });
  }
}
