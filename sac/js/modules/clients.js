// js/modules/clients.js
// Modul Clienți – gestionarea clienților
// UX îmbunătățit: skeleton loading, empty state cu callback, tooltips, feedback la submit
// FIX: marcare coloane raw pentru renderTable (status, actions)

import { clientsApi } from '../api.js';
import { showToast, escapeHtml, isValidTaxId, isValidRomanianIBAN } from '../utils.js';
import { createModal, renderTable, confirmDialog, renderSkeleton, renderEmptyState } from '../ui.js';

let currentClients = [];
let searchQuery = '';
let filterActive = 'all';

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-heading">
        <h2>Clienți</h2>
        <p>Administrează datele de facturare și contact ale persoanelor și companiilor pentru care lucrezi.</p>
      </div>
      <button class="btn btn-primary" id="add-client" title="Adaugă un client nou">＋ Client nou</button>
    </div>
    <div class="card filter-card">
      <div class="filter-card-heading"><div><span class="card-eyebrow">Director clienți</span><h3>Caută și filtrează</h3></div><button class="btn-link clear-filters" id="client-reset-filters" type="button">Resetează filtrele</button></div>
      <div class="filters-row">
        <div class="form-group">
          <label for="client-search">Nume sau identificator fiscal</label>
          <input type="search" id="client-search" placeholder="Ex: Studio Nord sau RO12345678" value="${escapeHtml(searchQuery)}">
        </div>
        <div class="form-group">
          <label for="client-filter-active">Starea clientului</label>
          <select id="client-filter-active">
            <option value="all" ${filterActive === 'all' ? 'selected' : ''}>Toți</option>
            <option value="active" ${filterActive === 'active' ? 'selected' : ''}>Activi</option>
            <option value="inactive" ${filterActive === 'inactive' ? 'selected' : ''}>Inactivi</option>
          </select>
        </div>
        <div class="form-group">
          <label class="filter-action-label" aria-hidden="true">Aplică</label>
          <button class="btn btn-outline" id="client-search-btn" title="Aplică filtrele">Caută clienți</button>
        </div>
      </div>
    </div>
    <div id="clients-list"></div>
  `;

  document.getElementById('add-client').addEventListener('click', () => openClientModal());
  document.getElementById('client-reset-filters').addEventListener('click', () => {
    searchQuery = '';
    filterActive = 'all';
    render(container);
  });
  document.getElementById('client-search-btn').addEventListener('click', () => {
    searchQuery = document.getElementById('client-search').value.trim();
    filterActive = document.getElementById('client-filter-active').value;
    loadClients();
  });
  document.getElementById('client-search').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      searchQuery = e.target.value.trim();
      filterActive = document.getElementById('client-filter-active').value;
      loadClients();
    }
  });

  await loadClients();
}

export function destroy() {}

async function loadClients() {
  const listContainer = document.getElementById('clients-list');
  if (!listContainer) return;

  listContainer.innerHTML = renderSkeleton(5);

  try {
    const filter = filterActive === 'all' ? null : filterActive === 'active';
    currentClients = await clientsApi.list({ search: searchQuery, active: filter });
    renderClientsList(listContainer);
  } catch (error) {
    console.error('Eroare la încărcarea clienților:', error);
    listContainer.innerHTML = `<div class="alert alert-error">${escapeHtml(error.message || 'Nu am putut încărca clienții')}</div>`;
  }
}

function renderClientsList(container) {
  if (!currentClients || currentClients.length === 0) {
    container.innerHTML = renderEmptyState(
      'Nu ai clienți în această listă.',
      'Adaugă primul client',
      () => openClientModal()
    );
    return;
  }

  const headers = [
    { label: 'Nume', key: 'legal_name' },
    { label: 'CUI/CNP', key: 'cui' },
    { label: 'Oraș', key: 'city' },
    { label: 'Telefon', key: 'phone' },
    { label: 'Email', key: 'email' },
    { label: 'Stare', key: 'active' },
    { label: 'Acțiuni', key: 'actions' }
  ];

  const rows = currentClients.map(client => ({
    legal_name: client.trade_name ? `${client.legal_name} (${client.trade_name})` : client.legal_name,
    cui: client.cui || '-',
    city: client.city || '-',
    phone: client.phone || '-',
    email: client.email || '-',
    active: client.active
      ? '<span class="badge badge-success">Activ</span>'
      : '<span class="badge badge-muted">Inactiv</span>',
    actions: `
      <div class="flex gap-1">
        <button class="btn btn-sm btn-outline" data-action="edit" data-id="${client.id}" title="Editează client">Editează</button>
        <button class="btn btn-sm ${client.active ? 'btn-danger' : 'btn-outline'}" data-action="toggle-active" data-id="${client.id}" title="${client.active ? 'Dezactivează client' : 'Activează client'}">
          ${client.active ? 'Dezactivează' : 'Activează'}
        </button>
      </div>
    `
  }));

  const activeCount = currentClients.filter(client => client.active).length;
  container.innerHTML = `<div class="list-summary"><span><strong>${currentClients.length}</strong> ${currentClients.length === 1 ? 'client găsit' : 'clienți găsiți'}</span><span>${activeCount} activi</span></div>` + renderTable(headers, rows, { emptyMessage: 'Nu există clienți', rawColumns: ['active', 'actions'] });

  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      const client = currentClients.find(c => c.id === id);
      if (!client) return;

      if (action === 'edit') {
        openClientModal(client);
      } else if (action === 'toggle-active') {
        const newActive = !client.active;
        const message = newActive ? 'Activezi clientul?' : 'Dezactivezi clientul?';
        const ok = await confirmDialog(message);
        if (ok) {
          try {
            await clientsApi.update(id, { active: newActive });
            await loadClients();
            showToast(newActive ? 'Client activat' : 'Client dezactivat', 'success');
          } catch (error) {
            showToast(error.message, 'error');
          }
        }
      }
    });
  });
}

function openClientModal(client = null) {
  const isEdit = !!client;
  const title = isEdit ? 'Editează client' : 'Adaugă client';

  const content = `
    <form id="client-form">
      <div class="form-section-heading"><span class="card-eyebrow">Identificare</span><h4>Datele clientului</h4><p>Câmpurile marcate cu * sunt obligatorii.</p></div>
      <div class="form-group">
        <label>Denumire legală *</label>
        <input type="text" name="legal_name" required value="${escapeHtml(client?.legal_name || '')}">
      </div>
      <div class="form-group">
        <label>Nume comercial</label>
        <input type="text" name="trade_name" value="${escapeHtml(client?.trade_name || '')}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Identificator fiscal (CUI/CNP)</label>
          <input type="text" name="cui" value="${escapeHtml(client?.cui || '')}" placeholder="CUI sau CNP">
        </div>
        <div class="form-group">
          <label>Cod TVA (RO...)</label>
          <input type="text" name="vat_number" value="${escapeHtml(client?.vat_number || '')}">
        </div>
      </div>
      <div class="form-section-heading"><span class="card-eyebrow">Adresă</span><h4>Sediu și localitate</h4></div>
      <div class="form-row">
        <div class="form-group">
          <label>Județ</label>
          <input type="text" name="county" value="${escapeHtml(client?.county || '')}">
        </div>
        <div class="form-group">
          <label>Localitate</label>
          <input type="text" name="city" value="${escapeHtml(client?.city || '')}">
        </div>
      </div>
      <div class="form-group">
        <label>Adresă</label>
        <input type="text" name="address" value="${escapeHtml(client?.address || '')}">
      </div>
      <div class="form-section-heading"><span class="card-eyebrow">Contact și plată</span><h4>Date opționale</h4></div>
      <div class="form-row">
        <div class="form-group">
          <label>Email</label>
          <input type="email" name="email" value="${escapeHtml(client?.email || '')}">
        </div>
        <div class="form-group">
          <label>Telefon</label>
          <input type="tel" name="phone" value="${escapeHtml(client?.phone || '')}">
        </div>
      </div>
      <div class="form-group">
        <label>IBAN</label>
        <input type="text" name="iban" value="${escapeHtml(client?.iban || '')}">
      </div>
      <div class="form-group">
        <label>Note</label>
        <textarea name="notes">${escapeHtml(client?.notes || '')}</textarea>
      </div>
      <div class="form-group">
        <label>
          <input type="checkbox" name="active" ${client ? (client.active ? 'checked' : '') : 'checked'}>
          Client activ
        </label>
      </div>
      <div class="flex gap-1 mt-2">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Actualizează' : 'Adaugă'}</button>
        <button type="button" class="btn btn-outline" id="client-cancel">Anulează</button>
      </div>
    </form>
  `;

  const { modalElement, close } = createModal({ title, content, size: 'lg', closeOnOverlayClick: false });

  modalElement.querySelector('#client-cancel').addEventListener('click', close);

  modalElement.querySelector('#client-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = modalElement.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Se salvează...';
    }

    const form = e.target;
    const formData = new FormData(form);

    const data = {
      legal_name: formData.get('legal_name'),
      trade_name: formData.get('trade_name') || null,
      cui: formData.get('cui') || null,
      vat_number: formData.get('vat_number') || null,
      county: formData.get('county') || null,
      city: formData.get('city') || null,
      address: formData.get('address') || null,
      email: formData.get('email') || null,
      phone: formData.get('phone') || null,
      iban: formData.get('iban') || null,
      notes: formData.get('notes') || null,
      active: formData.get('active') === 'on'
    };

    if (data.cui && !isValidTaxId(data.cui)) {
      showToast('Identificator fiscal invalid. Introduceți CUI (2-10 cifre) sau CNP (13 cifre).', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isEdit ? 'Actualizează' : 'Adaugă';
      }
      return;
    }

    if (data.iban && !isValidRomanianIBAN(data.iban)) {
      showToast('IBAN invalid. Introduceți un IBAN românesc valid.', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isEdit ? 'Actualizează' : 'Adaugă';
      }
      return;
    }

    try {
      if (isEdit) {
        await clientsApi.update(client.id, data);
        showToast('Client actualizat', 'success');
      } else {
        await clientsApi.create(data);
        showToast('Client adăugat', 'success');
      }
      close();
      await loadClients();
    } catch (error) {
      showToast(error.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isEdit ? 'Actualizează' : 'Adaugă';
      }
    }
  });
}
