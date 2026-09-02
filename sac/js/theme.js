// js/theme.js
// Gestionare temă light/dark cu localStorage și detectare preferință sistem
// UX îmbunătățit: tranziție fină, actualizare automată dacă sistemul se schimbă

const THEME_KEY = 'pfa-admin-theme';

/**
 * Obține tema preferată: localStorage > preferința sistemului > light
 */
function getPreferredTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') {
    return saved;
  }
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

/**
 * Aplică tema pe elementul rădăcină și o salvează în localStorage
 * @param {string} theme - 'light' sau 'dark'
 */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  updateToggleButton(theme);
}

/**
 * Actualizează textul și iconița butonului de toggle
 */
function updateToggleButton(theme) {
  const icon = document.getElementById('theme-toggle-icon');
  const text = document.getElementById('theme-toggle-text');
  if (icon && text) {
    if (theme === 'dark') {
      icon.textContent = '☀️';
      text.textContent = 'Mod luminos';
    } else {
      icon.textContent = '🌙';
      text.textContent = 'Mod întunecat';
    }
  }
}

/**
 * Inițializează tema și event listenerii
 */
export function initTheme() {
  const theme = getPreferredTheme();
  applyTheme(theme);

  const toggleBtn = document.getElementById('theme-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
    });
  }

  // Dacă utilizatorul nu a setat manual o temă, urmărim schimbarea preferinței sistemului
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  if (mediaQuery && typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', (e) => {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved !== 'light' && saved !== 'dark') {
        applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  }
}