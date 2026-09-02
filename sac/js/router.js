// js/router.js
// Router bazat pe hash pentru GitHub Pages – versiune stabilă, fără bucle de redirect
// Permite ruta #/reset-password fără autentificare pentru fluxul de recuperare a parolei.
// Include rute pentru dashboard, setări, clienți, furnizori, facturi, proforme,
// facturi primite, alte încasări/cheltuieli, RJIP, documente, inventar, mijloace fixe,
// rapoarte, aporturi proprii și situație fiscală.

import { isAuthenticated, showAuthScreen } from './auth.js';
import * as dashboard from './modules/dashboard.js';
import * as settings from './modules/settings.js';
import * as clients from './modules/clients.js';
import * as suppliers from './modules/suppliers.js';
import * as invoices from './modules/invoices.js';
import * as proformas from './modules/proformas.js';
import * as receivedInvoices from './modules/received-invoices.js';
import * as otherOperations from './modules/other-operations.js';
import * as rjip from './modules/rjip.js';
import * as documents from './modules/documents.js';
import * as inventory from './modules/inventory.js';
import * as fixedAssets from './modules/fixed-assets.js';
import * as reports from './modules/reports.js';
import * as aporturi from './modules/aporturi.js';
import * as fiscal from './modules/fiscal.js';

const routes = {
  'dashboard': { title: 'Meniu principal', render: dashboard.render, destroy: dashboard.destroy },
  'settings': { title: 'Configurare', render: settings.render, destroy: settings.destroy },
  'clients': { title: 'Clienți', render: clients.render, destroy: clients.destroy },
  'suppliers': { title: 'Furnizori', render: suppliers.render, destroy: suppliers.destroy },
  'invoices': { title: 'Facturi emise', render: invoices.render, destroy: invoices.destroy },
  'proformas': { title: 'Proforme', render: proformas.render, destroy: proformas.destroy },
  'received-invoices': { title: 'Facturi primite', render: receivedInvoices.render, destroy: receivedInvoices.destroy },
  'other-operations': { title: 'Alte încasări / cheltuieli', render: otherOperations.render, destroy: otherOperations.destroy },
  'rjip': { title: 'Registrul-jurnal de încasări și plăți', render: rjip.render, destroy: rjip.destroy },
  'documents': { title: 'Documente', render: documents.render, destroy: documents.destroy },
  'inventory': { title: 'Registru-inventar', render: inventory.render, destroy: inventory.destroy },
  'fixed-assets': { title: 'Mijloace fixe', render: fixedAssets.render, destroy: fixedAssets.destroy },
  'reports': { title: 'Rapoarte', render: reports.render, destroy: reports.destroy },
  'aporturi': { title: 'Aport propriu', render: aporturi.render, destroy: aporturi.destroy },
  'fiscal': { title: 'Situație fiscală', render: fiscal.render, destroy: fiscal.destroy }
};

let currentRoute = null;
let currentModule = null;
let currentParams = {};

export function initRouter() {
  window.addEventListener('hashchange', handleRouteChange);

  if (isAuthenticated()) {
    if (!window.location.hash || window.location.hash === '#/auth') {
      history.replaceState(null, '', '#/dashboard');
    }
    handleRouteChange();
  } else {
    if (window.location.hash.includes('reset-password')) {
      handleRouteChange();
    } else {
      showAuthScreen();
      if (window.location.hash) {
        history.replaceState(null, '', window.location.pathname);
      }
    }
  }
}

async function handleRouteChange() {
  const hash = window.location.hash.slice(1) || '/dashboard';
  const { path, params } = parseHash(hash);

  if (path === 'reset-password') {
    const auth = await import('./auth.js');
    auth.showAuthScreen();
    if (auth.showResetPasswordForm) {
      auth.showResetPasswordForm();
    }
    return;
  }

  if (!isAuthenticated()) {
    showAuthScreen();
    return;
  }

  if (path === 'auth') {
    history.replaceState(null, '', '#/dashboard');
    return handleRouteChange();
  }

  const route = routes[path];
  if (!route) {
    history.replaceState(null, '', '#/dashboard');
    return handleRouteChange();
  }

  if (currentModule && currentModule.destroy) {
    try {
      currentModule.destroy();
    } catch (e) {
      console.warn('Eroare la distrugerea modulului:', e);
    }
  }

  currentRoute = path;
  currentModule = route;
  currentParams = params;

  document.title = `${route.title} - S.A.C. - P.F.A.`;
  updateActiveNav(path);

  const pageContainer = document.getElementById('page-container');
  if (pageContainer) {
    pageContainer.innerHTML = '<div class="loading">Se încarcă...</div>';
    try {
      await route.render(pageContainer, params);
    } catch (error) {
      console.error('Eroare la randarea modulului:', error);
      pageContainer.innerHTML = `
        <div class="alert alert-error">
          <strong>Eroare:</strong> Nu am putut încărca pagina.
          <br><small>${escapeHtml(error.message || 'Eroare necunoscută')}</small>
        </div>`;
    }
  }

  window.scrollTo(0, 0);

  const sidebar = document.getElementById('sidebar');
  if (sidebar && sidebar.classList.contains('open')) {
    sidebar.classList.remove('open');
  }
}

function parseHash(hash) {
  const cleanHash = hash.startsWith('/') ? hash.slice(1) : hash;
  const [path, queryString] = cleanHash.split('?');
  const params = {};
  if (queryString) {
    const searchParams = new URLSearchParams(queryString);
    for (const [key, value] of searchParams.entries()) {
      params[key] = value;
    }
  }
  return { path, params };
}

function updateActiveNav(path) {
  document.querySelectorAll('.nav-list a[data-route]').forEach(link => {
    link.classList.toggle('active', link.getAttribute('data-route') === path);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function navigate(path) {
  window.location.hash = path.startsWith('#') ? path.slice(1) : path;
}

export function getCurrentParams() {
  return currentParams;
}

export function getCurrentRoute() {
  return currentRoute;
}
