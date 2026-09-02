// js/app.js
// Punct de intrare principal – autentificare, router, temă, meniu mobil, logo sidebar, versiune.
// Include încărcarea versiunii din files/version.json și afișarea sub butonul Deconectare.

import { initAuth } from './auth.js';
import { initRouter } from './router.js';
import { initTheme } from './theme.js';
import { initAccountingIntegrity } from './services/accounting-integrity.js';
import { APP_CONFIG } from './config.js';

const LOGO_URL = 'files/header.png';

function validateConfig() {
  if (!APP_CONFIG.supabaseUrl || APP_CONFIG.supabaseUrl.includes('YOUR-PROJECT-REF')) {
    console.error('Supabase URL nu este configurat corect în js/config.js');
    return false;
  }
  if (!APP_CONFIG.supabasePublishableKey || APP_CONFIG.supabasePublishableKey.includes('YOUR-ANON')) {
    console.error('Supabase publishable key nu este configurată corect în js/config.js');
    return false;
  }
  return true;
}

function showConfigError() {
  const appElement = document.getElementById('app');
  if (appElement) {
    appElement.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0B1220;padding:20px;">
        <div style="background:#fff;padding:32px;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.1);max-width:500px;width:100%;text-align:center;">
          <h1 style="color:#0A2540;margin-bottom:12px;">Configurare incompletă</h1>
          <p style="color:#5a6472;margin-bottom:20px;">Fișierul <code>js/config.js</code> trebuie completat cu datele proiectului tău Supabase.</p>
        </div>
      </div>`;
  }
}

function initSidebar() {
  if (window.__sidebarInitialized) return;
  window.__sidebarInitialized = true;

  const toggleBtn = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');

  if (!toggleBtn || !sidebar) {
    console.warn('initSidebar: elementele pentru meniul mobil lipsesc.');
    return;
  }

  let overlay = document.querySelector('.sidebar-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);
  }

  const openSidebar = () => {
    sidebar.classList.add('open');
    overlay.classList.add('active');
    document.body.classList.add('sidebar-open');
  };

  const closeSidebar = () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
    document.body.classList.remove('sidebar-open');
  };

  toggleBtn.addEventListener('click', () => {
    if (sidebar.classList.contains('open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });

  overlay.addEventListener('click', closeSidebar);
  window.addEventListener('hashchange', closeSidebar);
}

function loadSidebarLogo() {
  const img = document.getElementById('sidebar-logo');
  const title = document.getElementById('sidebar-title');
  if (img && title) {
    img.src = LOGO_URL;
    img.style.display = 'block';
    title.style.display = 'none';
  }
}

async function loadVersion() {
  try {
    const url = new URL('files/version.json', window.location.href);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('Versiune indisponibilă');

    const data = await response.json();
    const versionEl = document.getElementById('app-version');

    if (versionEl && data.version) {
      const build = data.build ? ` (${data.build})` : '';
      versionEl.textContent = `v${data.version}${build}`;
    }
  } catch (error) {
    console.warn('Nu am putut încărca versiunea:', error);
  }
}

async function bootstrap() {
  console.log(`Pornire ${APP_CONFIG.appName}...`);

  window.addEventListener('error', (event) => {
    if (event.error) {
      console.error('Eroare globală:', event.error.message, event.error.stack);
    } else {
      console.error('Eroare globală:', event.message, 'la', event.filename, 'linia', event.lineno);
    }
  });

  if (!validateConfig()) {
    showConfigError();
    return;
  }

  try {
    initTheme();
    window.addEventListener('pfa:authenticated', loadSidebarLogo);
    await initAuth();
    await loadVersion();
    initRouter();
    initSidebar();
    initAccountingIntegrity();
    console.log('Aplicație pornită cu succes');
  } catch (error) {
    console.error('Eroare la pornirea aplicației:', error);
    const appElement = document.getElementById('app');
    if (appElement) {
      appElement.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0B1220;">
          <div style="background:#fff;padding:32px;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.1);max-width:500px;text-align:center;">
            <h1 style="color:#0A2540;margin-bottom:12px;">Eroare de pornire</h1>
            <p style="color:#5a6472;">A apărut o eroare la inițializarea aplicației. Verifică consola pentru detalii.</p>
          </div>
        </div>`;
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
