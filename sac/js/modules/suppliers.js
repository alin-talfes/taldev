// js/modules/suppliers.js
// Modul Furnizori – gestionarea furnizorilor
// UX îmbunătățit: skeleton loading, empty state cu callback, tooltips, feedback la submit
// FIX: marcare coloane raw pentru renderTable (status, actions)

import { suppliersApi } from '../api.js';
import { showToast, escapeHtml, isValidTaxId, isValidRomanianIBAN } from '../utils.js';
import { createModal, renderTable, confirmDialog, renderSkeleton, renderEmptyState } from '../ui.js';

let currentSuppliers = [];
let searchQuery = '';
let filterActive = 'all';

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-heading">
        <h2>Furnizori</h2>
        <p>Păstrează într-un singur loc datele furnizorilor folosite la facturile primite și plăți.</p>
      </div>
      <button class="btn btn-primary" id="add-supplier" title="Adaugă un furnizor nou">＋ Furnizor nou</button>
    </div>
    <div class="card filter-card">
      <div class="filter-card-heading"><div><span class="card-eyebrow">Director furnizori</span><h3>Caută și filtrează</h3></div><button class="btn-link clear-filters" id="supplier-reset-filters" type="button">Resetează filtrele</button></div>
      <div class="filters-row">
        <div class="form-group">
          <label for="supplier-search">Nume sau identificator fiscal</label>
          <input type="search" id="supplier-search" placeholder="Ex: Furnizor SRL sau RO12345678" value="${escapeHtml(searchQuery)}">
        </div>
        <div class="form-group">
          <label for="supplier-filter-active">Starea furnizorului</label>
          <select id="supplier-filter-active">
            <option value="all" ${filterActive === 'all' ? 'selected' : ''}>Toți</option>
            <option value="active" ${filterActive === 'active' ? 'selected' : ''}>Activi</option>
            <option value="inactive" ${filterActive === 'inactive' ? 'selected' : ''}>Inactivi</option>
          </select>
        </div>
        <div class="form-group">
          <label class="filter-action-label" aria-hidden="true">Aplică</label>
          <button class="btn btn-outline" id="supplier-search-btn" title="Aplică filtrele">Caută furnizori</button>
        </div>
      </div>
    </div>
    <div id="suppliers-list"></div>
  `;

  document.getElementById('add-supplier').addEventListener('click', () => openSupplierModal());
  document.getElementById('supplier-reset-filters').addEventListener('click', () => {
    searchQuery = '';
    filterActive = 'all';
    render(container);
  });
  document.getElementById('supplier-search-btn').addEventListener('click', () => {
    searchQuery = document.getElementById('supplier-search').value.trim();
    filterActive = document.getElementById('supplier-filter-active').value;
    loadSuppliers();
  });
  document.getElementById('supplier-search').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      searchQuery = e.target.value.trim();
      filterActive = document.getElementById('supplier-filter-active').value;
      loadSuppliers();
    }
  });

  await loadSuppliers();
}

export function destroy() {}

async function loadSuppliers() {
  const listContainer = document.getElementById('suppliers-list');
  if (!listContainer) return;

  listContainer.innerHTML = renderSkeleton(5);

  try {
    const filter = filterActive === 'all' ? null : filterActive === 'active';
    currentSuppliers = await suppliersApi.list({ search: searchQuery, active: filter });
    renderSuppliersList(listContainer);
  } catch (error) {
    console.error('Eroare la încărcarea furnizorilor:', error);
    listContainer.innerHTML = `<div class="alert alert-error">${escapeHtml(error.message || 'Nu am putut încărca furnizorii')}</div>`;
  }
}

function renderSuppliersList(container) {
  if (!currentSuppliers || currentSuppliers.length === 0) {
    container.innerHTML = renderEmptyState(
      'Nu ai furnizori în această listă.',
      'Adaugă primul furnizor',
      () => openSupplierModal()
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

  const rows = currentSuppliers.map(supplier => ({
    legal_name: supplier.trade_name ? `${supplier.legal_name} (${supplier.trade_name})` : supplier.legal_name,
    cui: supplier.cui || '-',
    city: supplier.city || '-',
    phone: supplier.phone || '-',
    email: supplier.email || '-',
    active: supplier.active
      ? '<span class="badge badge-success">Activ</span>'
      : '<span class="badge badge-muted">Inactiv</span>',
    actions: `
      <div class="flex gap-1">
        <button class="btn btn-sm btn-outline" data-action="edit" data-id="${supplier.id}" title="Editează furnizor">Editează</button>
        <button class="btn btn-sm ${supplier.active ? 'btn-danger' : 'btn-outline'}" data-action="toggle-active" data-id="${supplier.id}" title="${supplier.active ? 'Dezactivează furnizor' : 'Activează furnizor'}">
          ${supplier.active ? 'Dezactivează' : 'Activează'}
        </button>
      </div>
    `
  }));

  const activeCount = currentSuppliers.filter(supplier => supplier.active).length;
  container.innerHTML = `<div class="list-summary"><span><strong>${currentSuppliers.length}</strong> ${currentSuppliers.length === 1 ? 'furnizor găsit' : 'furnizori găsiți'}</span><span>${activeCount} activi</span></div>` + renderTable(headers, rows, { emptyMessage: 'Nu există furnizori', rawColumns: ['active', 'actions'] });

  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      const supplier = currentSuppliers.find(s => s.id === id);
      if (!supplier) return;

      if (action === 'edit') {
        openSupplierModal(supplier);
      } else if (action === 'toggle-active') {
        const newActive = !supplier.active;
        const message = newActive ? 'Activezi furnizorul?' : 'Dezactivezi furnizorul?';
        const ok = await confirmDialog(message);
        if (ok) {
          try {
            await suppliersApi.update(id, { active: newActive });
            await loadSuppliers();
            showToast(newActive ? 'Furnizor activat' : 'Furnizor dezactivat', 'success');
          } catch (error) {
            showToast(error.message, 'error');
          }
        }
      }
    });
  });
}

function openSupplierModal(supplier = null) {
  const isEdit = !!supplier;
  const title = isEdit ? 'Editează furnizor' : 'Adaugă furnizor';

  const content = `
    <form id="supplier-form">
      <div class="form-section-heading"><span class="card-eyebrow">Identificare</span><h4>Datele furnizorului</h4><p>Câmpurile marcate cu * sunt obligatorii.</p></div>
      <div class="form-group">
        <label>Denumire legală *</label>
        <input type="text" name="legal_name" required value="${escapeHtml(supplier?.legal_name || '')}">
      </div>
      <div class="form-group">
        <label>Nume comercial</label>
        <input type="text" name="trade_name" value="${escapeHtml(supplier?.trade_name || '')}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Identificator fiscal (CUI/CNP)</label>
          <input type="text" name="cui" value="${escapeHtml(supplier?.cui || '')}" placeholder="CUI sau CNP">
        </div>
        <div class="form-group">
          <label>Cod TVA (RO...)</label>
          <input type="text" name="vat_number" value="${escapeHtml(supplier?.vat_number || '')}">
        </div>
      </div>
      <div class="form-section-heading"><span class="card-eyebrow">Adresă</span><h4>Sediu și localitate</h4></div>
      <div class="form-row">
        <div class="form-group">
          <label>Județ</label>
          <input type="text" name="county" value="${escapeHtml(supplier?.county || '')}">
        </div>
        <div class="form-group">
          <label>Localitate</label>
          <input type="text" name="city" value="${escapeHtml(supplier?.city || '')}">
        </div>
      </div>
      <div class="form-group">
        <label>Adresă</label>
        <input type="text" name="address" value="${escapeHtml(supplier?.address || '')}">
      </div>
      <div class="form-section-heading"><span class="card-eyebrow">Contact și plată</span><h4>Date opționale</h4></div>
      <div class="form-row">
        <div class="form-group">
          <label>Email</label>
          <input type="email" name="email" value="${escapeHtml(supplier?.email || '')}">
        </div>
        <div class="form-group">
          <label>Telefon</label>
          <input type="tel" name="phone" value="${escapeHtml(supplier?.phone || '')}">
        </div>
      </div>
      <div class="form-group">
        <label>IBAN</label>
        <input type="text" name="iban" value="${escapeHtml(supplier?.iban || '')}">
      </div>
      <div class="form-group">
        <label>Note</label>
        <textarea name="notes">${escapeHtml(supplier?.notes || '')}</textarea>
      </div>
      <div class="form-group">
        <label>
          <input type="checkbox" name="active" ${supplier ? (supplier.active ? 'checked' : '') : 'checked'}>
          Furnizor activ
        </label>
      </div>
      <div class="flex gap-1 mt-2">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Actualizează' : 'Adaugă'}</button>
        <button type="button" class="btn btn-outline" id="supplier-cancel">Anulează</button>
      </div>
    </form>
  `;

  const { modalElement, close } = createModal({ title, content, size: 'lg', closeOnOverlayClick: false });

  modalElement.querySelector('#supplier-cancel').addEventListener('click', close);

  modalElement.querySelector('#supplier-form').addEventListener('submit', async (e) => {
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
        await suppliersApi.update(supplier.id, data);
        showToast('Furnizor actualizat', 'success');
      } else {
        await suppliersApi.create(data);
        showToast('Furnizor adăugat', 'success');
      }
      close();
      await loadSuppliers();
    } catch (error) {
      showToast(error.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isEdit ? 'Actualizează' : 'Adaugă';
      }
    }
  });
}
