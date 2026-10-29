// Auth: sign-in, sign-up, password hashing (PBKDF2-SHA256).
// Globals used: STORAGE_PREFIX, USERS_KEY, SESSION_KEY, authMode, authError,
//   currentUser, state, escapeHtml, SUN_ICON, MOON_ICON, toggleTheme,
//   loadUserData, render.

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

async function legacyHash(pw){
  if(hasSubtle()){
    try{ return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw))); }
    catch(e){ /* fall through */ }
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
