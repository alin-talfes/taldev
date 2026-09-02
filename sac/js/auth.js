// js/auth.js
// Modul de autentificare și gestionare a sesiunii
// UX îmbunătățit: spinner la autentificare, mesaje clare
// Suport pentru fluxul de resetare a parolei (PASSWORD_RECOVERY)
// Exportă showResetPasswordForm pentru router.

import { authApi } from './api.js';
import { getSupabase } from './supabase.js';
import { showToast } from './utils.js';

const authContainer = document.getElementById('auth-container');
const mainContainer = document.getElementById('main-container');

let loginForm = document.getElementById('login-form');
let emailInput = document.getElementById('email');
let passwordInput = document.getElementById('password');
let authError = document.getElementById('auth-error');
let logoutBtn = document.getElementById('logout-btn');
let userEmailDisplay = document.getElementById('user-email-display');
let resetPasswordLink = document.getElementById('reset-password-link');

let currentUser = null;
let resetMode = false; // true dacă trebuie să setăm o nouă parolă

export async function initAuth() {
  await checkSession();

  if (loginForm && !loginForm.dataset.authBound) bindLoginForm();
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  try {
    const supabase = await getSupabase();
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        currentUser = session.user;
        showMainApp();
      } else if (event === 'SIGNED_OUT') {
        currentUser = null;
        resetMode = false;
        showAuthScreen();
      } else if (event === 'TOKEN_REFRESHED' && session) {
        currentUser = session.user;
        showMainApp();
      } else if (event === 'USER_UPDATED' && session) {
        currentUser = session.user;
        updateUserEmailDisplay();
      } else if (event === 'PASSWORD_RECOVERY') {
        resetMode = true;
        showResetPasswordForm();
      }
    });
  } catch (error) {
    console.error('Nu am putut configura ascultătorul de auth:', error);
  }
}

async function checkSession() {
  try {
    const session = await authApi.getSession();
    if (session && session.user) {
      currentUser = session.user;
      showMainApp();
    } else {
      currentUser = null;
      if (window.location.hash.includes('reset-password')) {
        showResetPasswordForm();
      } else {
        showAuthScreen();
      }
    }
  } catch (error) {
    console.error('Eroare la verificarea sesiunii:', error);
    currentUser = null;
    showAuthScreen();
  }
}

async function handleLogin(event) {
  event.preventDefault();

  if (resetMode) {
    await handleNewPassword(event);
    return;
  }

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showAuthError('Introdu email-ul și parola.');
    return;
  }

  const submitBtn = loginForm.querySelector('button[type="submit"]');
  let originalText = '';
  if (submitBtn) {
    originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Se autentifică...';
  }

  try {
    const data = await authApi.signIn(email, password);
    currentUser = data.user;
    resetMode = false;
    showMainApp();
    hideAuthError();
    showToast('Autentificare reușită', 'success');
    history.replaceState(null, '', '#/dashboard');
    window.dispatchEvent(new Event('hashchange'));
  } catch (error) {
    console.error('Login error:', error);
    let message = 'Autentificare eșuată. Verifică email-ul și parola.';
    if (error.message && error.message.includes('Invalid login credentials')) {
      message = 'Email sau parolă incorecte.';
    } else if (error.message && error.message.includes('Email not confirmed')) {
      message = 'Email-ul nu este confirmat. Verifică inbox-ul.';
    }
    showAuthError(message);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }
}

async function handleNewPassword(event) {
  event.preventDefault();

  const newPassword = passwordInput ? passwordInput.value : '';

  if (!newPassword || newPassword.length < 6) {
    showAuthError('Parola trebuie să aibă cel puțin 6 caractere.');
    return;
  }

  const form = loginForm || document.getElementById('reset-password-form');
  const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Se actualizează...';
  }

  try {
    await authApi.updatePassword(newPassword);
    resetMode = false;
    showAuthScreen();
    showAuthError('Parola a fost schimbată. Te poți autentifica acum.', 'success');
    history.replaceState(null, '', '#/auth');
  } catch (error) {
    showAuthError(error.message || 'Nu am putut actualiza parola.');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Salvează parola';
    }
  }
}

async function handleLogout() {
  try {
    await authApi.signOut();
    currentUser = null;
    resetMode = false;
    showAuthScreen();
    history.replaceState(null, '', '#/auth');
    showToast('Te-ai deconectat cu succes', 'info');
  } catch (error) {
    console.error('Logout error:', error);
    showToast('Deconectare eșuată: ' + error.message, 'error');
  }
}

async function handleResetPassword() {
  const email = emailInput ? emailInput.value.trim() : '';
  if (!email) {
    showAuthError('Introdu email-ul pentru resetarea parolei.');
    return;
  }

  try {
    await authApi.resetPassword(email);
    showAuthError('Email de resetare trimis. Verifică inbox-ul.', 'success');
  } catch (error) {
    showAuthError(error.message || 'Nu am putut trimite email-ul de resetare.');
  }
}

export function showResetPasswordForm() {
  resetMode = true;

  if (authContainer) authContainer.style.display = 'flex';
  if (mainContainer) mainContainer.style.display = 'none';

  const authCard = authContainer ? authContainer.querySelector('.auth-card') : null;
  if (!authCard) return;

  authCard.innerHTML = `
    <img class="auth-logo" src="files/header.png" alt="TALDEV">
    <span class="auth-eyebrow">Securitatea contului</span>
    <h1>Parolă nouă</h1>
    <p class="auth-subtitle">Sistemul de Administrare și Contabilitate al Persoanei Fizice Autorizate</p>
    <p class="auth-context">Setează o nouă parolă</p>
    <form id="reset-password-form">
      <div class="form-group">
        <label for="password">Parolă nouă</label>
        <input type="password" id="password" name="password" required minlength="6" autocomplete="new-password">
      </div>
      <button type="submit" class="btn btn-primary btn-block">Salvează parola</button>
    </form>
    <div id="auth-error" class="error-message" role="alert" aria-live="polite" style="display:none;"></div>
  `;

  loginForm = document.getElementById('reset-password-form');
  emailInput = document.getElementById('email');
  passwordInput = document.getElementById('password');
  authError = document.getElementById('auth-error');
  resetPasswordLink = document.getElementById('reset-password-link');

  bindLoginForm();
}

export function showMainApp() {
  resetMode = false;
  if (authContainer) authContainer.style.display = 'none';
  if (mainContainer) mainContainer.style.display = 'flex';
  updateUserEmailDisplay();
  window.dispatchEvent(new CustomEvent('pfa:authenticated'));
}

export function showAuthScreen() {
  resetMode = false;
  if (authContainer) authContainer.style.display = 'flex';
  if (mainContainer) mainContainer.style.display = 'none';
  if (userEmailDisplay) userEmailDisplay.textContent = '';

  const authCard = authContainer ? authContainer.querySelector('.auth-card') : null;
  if (!authCard) return;

  authCard.innerHTML = `
    <img class="auth-logo" src="files/header.png" alt="TALDEV">
    <h1>Bine ai revenit!</h1>
    <p class="auth-subtitle">Sistemul de Administrare și Contabilitate al Persoanei Fizice Autorizate</p>
    <form id="login-form">
      <div class="form-group">
        <label for="email">Adresă de e-mail:</label>
        <input type="email" id="email" name="email" required autocomplete="email">
      </div>
      <div class="form-group">
        <label for="password">Parolă:</label>
        <input type="password" id="password" name="password" required autocomplete="current-password">
      </div>
      <button type="submit" class="btn btn-primary btn-block">Autentificare</button>
    </form>
    <button id="reset-password-link" class="btn-link">Am uitat parola</button>
    <div id="auth-error" class="error-message" role="alert" aria-live="polite" style="display:none;"></div>
  `;

  loginForm = document.getElementById('login-form');
  emailInput = document.getElementById('email');
  passwordInput = document.getElementById('password');
  authError = document.getElementById('auth-error');
  resetPasswordLink = document.getElementById('reset-password-link');

  bindLoginForm();
}

function bindLoginForm() {
  if (loginForm && !loginForm.dataset.authBound) {
    loginForm.addEventListener('submit', handleLogin);
    loginForm.dataset.authBound = 'true';
  }
  if (resetPasswordLink && !resetPasswordLink.dataset.authBound) {
    resetPasswordLink.addEventListener('click', handleResetPassword);
    resetPasswordLink.dataset.authBound = 'true';
  }
}

function updateUserEmailDisplay() {
  if (userEmailDisplay && currentUser) {
    userEmailDisplay.textContent = currentUser.email;
  }
}

function showAuthError(message, type = 'error') {
  if (!authError) return;
  authError.textContent = message;
  authError.style.display = 'block';
  authError.style.color = type === 'success' ? 'var(--color-success)' : 'var(--color-danger)';
}

function hideAuthError() {
  if (authError) {
    authError.style.display = 'none';
    authError.textContent = '';
  }
}

export function getCurrentUser() {
  return currentUser;
}

export function isAuthenticated() {
  return !!currentUser;
}
