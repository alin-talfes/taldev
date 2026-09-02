// js/modules/inventory.js
// Modul Registru-inventar – gestionarea elementelor de inventar cu numere de inventar
// UX îmbunătățit: skeleton loading, empty state cu callback, tooltips, feedback la submit
// FIX: marcare coloane raw pentru renderTable (status, actions)

import { inventoryApi } from '../api.js';
import { getSupabase } from '../supabase.js';
import { formatDate, toInputDate, showToast, escapeHtml, formatCurrency } from '../utils.js';
import { createModal, renderStatusBadge, confirmDialog, renderTable, renderSkeleton, renderEmptyState } from '../ui.js';

let currentItems = [];
let filters = {
  status: 'all',
  search: ''
};

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-heading"><h2>Registru-inventar</h2><p>Urmărește bunurile, valorile și starea fiecărui element aflat în patrimoniul PFA.</p></div>
      <button class="btn btn-primary" id="add-inventory-item" title="Adaugă element de inventar">＋ Element nou</button>
    </div>
    <div class="card filter-card">
      <div class="filter-card-heading"><div><span class="card-eyebrow">Registru</span><h3>Caută și filtrează</h3></div><button class="btn-link clear-filters" id="inventory-reset-filters" type="button">Resetează filtrele</button></div>
      <div class="filters-row">
        <div class="form-group">
          <label for="inventory-search">Descriere sau număr de inventar</label>
          <input type="search" id="inventory-search" placeholder="Ex: laptop sau INV-2026-001" value="${escapeHtml(filters.search)}">
        </div>
        <div class="form-group">
          <label for="inventory-filter-status">Starea elementului</label>
          <select id="inventory-filter-status">
            <option value="all" ${filters.status === 'all' ? 'selected' : ''}>Toate statusurile</option>
            <option value="ACTIVE" ${filters.status === 'ACTIVE' ? 'selected' : ''}>Activ</option>
            <option value="CONSUMED" ${filters.status === 'CONSUMED' ? 'selected' : ''}>Consumat</option>
            <option value="DAMAGED" ${filters.status === 'DAMAGED' ? 'selected' : ''}>Deteriorat</option>
            <option value="SOLD" ${filters.status === 'SOLD' ? 'selected' : ''}>Vândut</option>
            <option value="WRITTEN_OFF" ${filters.status === 'WRITTEN_OFF' ? 'selected' : ''}>Scăzut din gestiune</option>
            <option value="ARCHIVED" ${filters.status === 'ARCHIVED' ? 'selected' : ''}>Arhivat</option>
          </select>
        </div>
        <div class="form-group">
          <label class="filter-action-label" aria-hidden="true">Aplică</label>
          <button class="btn btn-outline" id="inventory-search-btn" title="Aplică filtrele">Caută în registru</button>
        </div>
      </div>
    </div>
    <div id="inventory-list"></div>
  `;

  document.getElementById('add-inventory-item').addEventListener('click', () => openInventoryModal());
  document.getElementById('inventory-reset-filters').addEventListener('click', () => {
    filters = { status: 'all', search: '' };
    render(container);
  });
  document.getElementById('inventory-search-btn').addEventListener('click', () => {
    filters.search = document.getElementById('inventory-search').value.trim();
    filters.status = document.getElementById('inventory-filter-status').value;
    loadInventory();
  });
  document.getElementById('inventory-search').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      filters.search = e.target.value.trim();
      filters.status = document.getElementById('inventory-filter-status').value;
      loadInventory();
    }
  });

  await loadInventory();
}

export function destroy() {}

async function loadInventory() {
  const listContainer = document.getElementById('inventory-list');
  if (!listContainer) return;
  listContainer.innerHTML = renderSkeleton(5);

  try {
    const items = await inventoryApi.list();
    currentItems = items.filter(item => {
      const matchesStatus = filters.status === 'all' || item.status === filters.status;
      const searchLower = filters.search.toLowerCase();
      const matchesSearch = !filters.search || 
        (item.description && item.description.toLowerCase().includes(searchLower)) ||
        (item.inventory_number && item.inventory_number.toLowerCase().includes(searchLower));
      return matchesStatus && matchesSearch;
    });
    renderInventoryList(listContainer);
  } catch (error) {
    console.error('Eroare la încărcarea inventarului:', error);
    listContainer.innerHTML = `<div class="alert alert-error">${escapeHtml(error.message || 'Nu am putut încărca inventarul')}</div>`;
  }
}

function renderInventoryList(container) {
  if (!currentItems || currentItems.length === 0) {
    container.innerHTML = renderEmptyState(
      'Nu ai elemente de inventar în această listă.',
      'Adaugă primul element',
      () => openInventoryModal()
    );
    return;
  }

  const headers = [
    { label: 'Număr inventar', key: 'inventory_number' },
    { label: 'Data', key: 'record_date' },
    { label: 'Descriere', key: 'description' },
    { label: 'Document', key: 'document_reference' },
    { label: 'Cantitate', key: 'quantity' },
    { label: 'Valoare unitară', key: 'unit_value', align: 'right' },
    { label: 'Valoare totală', key: 'total_value', align: 'right' },
    { label: 'Stare', key: 'status' },
    { label: 'Acțiuni', key: 'actions' }
  ];

  const rows = currentItems.map(item => {
    const needsNumber = !item.inventory_number;
    const actions = `
      <div class="flex gap-1">
        <button class="btn btn-sm btn-outline" data-action="view" data-id="${item.id}" title="Vezi detalii element">Vezi</button>
        <button class="btn btn-sm btn-outline" data-action="edit" data-id="${item.id}" title="Editează element">Editează</button>
        ${needsNumber ? `<button class="btn btn-sm btn-info" data-action="assign-number" data-id="${item.id}" title="Generează număr inventar">Număr inventar</button>` : ''}
        <button class="btn btn-sm btn-danger" data-action="delete" data-id="${item.id}" title="Șterge element">Șterge</button>
      </div>
    `;
    return {
      inventory_number: item.inventory_number || '-',
      record_date: formatDate(item.record_date),
      description: item.description,
      document_reference: item.document_reference || '-',
      quantity: item.quantity,
      unit_value: formatCurrency(item.unit_value),
      total_value: formatCurrency(item.total_value),
      status: renderStatusBadge(item.status),
      actions
    };
  });

  const totalValue = currentItems.reduce((sum, item) => sum + parseFloat(item.total_value || 0), 0);
  container.innerHTML = `<div class="list-summary"><span><strong>${currentItems.length}</strong> ${currentItems.length === 1 ? 'element găsit' : 'elemente găsite'}</span><span>Valoare afișată: <strong>${formatCurrency(totalValue)}</strong></span></div>` + renderTable(headers, rows, { emptyMessage: 'Nu există elemente de inventar', rawColumns: ['status', 'actions'] });

  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      const item = currentItems.find(i => i.id === id);
      if (!item) return;

      if (action === 'view') {
        openInventoryDetail(item);
      } else if (action === 'edit') {
        openInventoryModal(item);
      } else if (action === 'assign-number') {
        try {
          const supabase = await getSupabase();
          const { data, error } = await supabase.rpc('generate_inventory_item_number', {
            p_inventory_item_id: item.id
          });
          if (error) throw error;
          showToast(`Număr de inventar generat: ${data}`, 'success');
          await loadInventory();
        } catch (error) {
          showToast(error.message, 'error');
        }
      } else if (action === 'delete') {
        const ok = await confirmDialog('Sigur dorești să ștergi acest element de inventar?', { danger: true });
        if (ok) {
          try {
            await inventoryApi.remove(id);
            showToast('Element șters', 'success');
            await loadInventory();
          } catch (error) {
            showToast(error.message, 'error');
          }
        }
      }
    });
  });
}

// ------------------ MODAL DETALIU ------------------
async function openInventoryDetail(item) {
  const content = `
    <div class="grid mb-2">
      <div><strong>Număr inventar:</strong> ${item.inventory_number || '-'}</div>
      <div><strong>Data înregistrării:</strong> ${formatDate(item.record_date)}</div>
      <div><strong>Descriere:</strong> ${escapeHtml(item.description)}</div>
      <div><strong>Document referință:</strong> ${escapeHtml(item.document_reference || '-')}</div>
      <div><strong>Cantitate:</strong> ${item.quantity}</div>
      <div><strong>Valoare unitară:</strong> ${formatCurrency(item.unit_value)}</div>
      <div><strong>Valoare totală:</strong> ${formatCurrency(item.total_value)}</div>
      <div><strong>Sursă:</strong> ${escapeHtml(item.source || '-')}</div>
      <div><strong>Locație:</strong> ${escapeHtml(item.location || '-')}</div>
      <div><strong>Stare:</strong> ${renderStatusBadge(item.status)}</div>
      <div><strong>Note:</strong> ${escapeHtml(item.notes || '-')}</div>
    </div>
  `;
  createModal({ title: 'Detalii element inventar', content, size: 'lg' });
}

// ------------------ MODAL CREARE/EDITARE ------------------
async function openInventoryModal(item = null) {
  const isEdit = !!item;
  const title = isEdit ? 'Editează element de inventar' : 'Adaugă element de inventar';

  const content = `
    <form id="inventory-form">
      <div class="form-group">
        <label>Data înregistrării *</label>
        <input type="date" name="record_date" required value="${item ? toInputDate(item.record_date) : toInputDate(new Date())}">
      </div>
      <div class="form-group">
        <label>Descriere *</label>
        <input type="text" name="description" required value="${item ? escapeHtml(item.description) : ''}">
      </div>
      <div class="form-group">
        <label>Document de referință</label>
        <input type="text" name="document_reference" value="${item ? escapeHtml(item.document_reference || '') : ''}" placeholder="Ex: Factura nr. 123">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Cantitate *</label>
          <input type="number" step="0.01" min="0" name="quantity" required value="${item ? item.quantity : 1}">
        </div>
        <div class="form-group">
          <label>Valoare unitară *</label>
          <input type="number" step="0.01" min="0" name="unit_value" required value="${item ? item.unit_value : 0}">
        </div>
      </div>
      <div class="form-group">
        <label>Valoare totală (calculată automat)</label>
        <input type="text" id="total-value-display" value="${item ? item.total_value : '0.00'}" disabled>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Sursă</label>
          <input type="text" name="source" value="${item ? escapeHtml(item.source || '') : ''}" placeholder="Ex: Achiziție">
        </div>
        <div class="form-group">
          <label>Locație</label>
          <input type="text" name="location" value="${item ? escapeHtml(item.location || '') : ''}" placeholder="Ex: Depozit">
        </div>
      </div>
      <div class="form-group">
        <label>Stare</label>
        <select name="status">
          <option value="ACTIVE" ${item && item.status === 'ACTIVE' ? 'selected' : ''}>Activ</option>
          <option value="CONSUMED" ${item && item.status === 'CONSUMED' ? 'selected' : ''}>Consumat</option>
          <option value="DAMAGED" ${item && item.status === 'DAMAGED' ? 'selected' : ''}>Deteriorat</option>
          <option value="SOLD" ${item && item.status === 'SOLD' ? 'selected' : ''}>Vândut</option>
          <option value="WRITTEN_OFF" ${item && item.status === 'WRITTEN_OFF' ? 'selected' : ''}>Scăzut</option>
          <option value="ARCHIVED" ${item && item.status === 'ARCHIVED' ? 'selected' : ''}>Arhivat</option>
        </select>
      </div>
      <div class="form-group">
        <label>Note</label>
        <textarea name="notes">${item ? escapeHtml(item.notes || '') : ''}</textarea>
      </div>
      <div class="flex gap-1 mt-2">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Actualizează' : 'Adaugă'}</button>
        <button type="button" class="btn btn-outline" id="inventory-cancel">Anulează</button>
      </div>
    </form>
  `;

  const { modalElement, close } = createModal({ title, content, size: 'lg', closeOnOverlayClick: false });

  const qtyInput = modalElement.querySelector('[name="quantity"]');
  const priceInput = modalElement.querySelector('[name="unit_value"]');
  const totalDisplay = modalElement.querySelector('#total-value-display');
  const recalcTotal = () => {
    const qty = parseFloat(qtyInput.value) || 0;
    const price = parseFloat(priceInput.value) || 0;
    totalDisplay.value = (qty * price).toFixed(2);
  };
  qtyInput.addEventListener('input', recalcTotal);
  priceInput.addEventListener('input', recalcTotal);

  modalElement.querySelector('#inventory-cancel').addEventListener('click', close);

  modalElement.querySelector('#inventory-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = modalElement.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Se salvează...';
    }

    const form = e.target;
    const formData = new FormData(form);
    const quantity = parseFloat(formData.get('quantity')) || 0;
    const unitValue = parseFloat(formData.get('unit_value')) || 0;
    const data = {
      record_date: formData.get('record_date'),
      description: formData.get('description'),
      document_reference: formData.get('document_reference') || null,
      quantity,
      unit_value: unitValue,
      total_value: Math.round(quantity * unitValue * 100) / 100,
      source: formData.get('source') || null,
      location: formData.get('location') || null,
      status: formData.get('status'),
      notes: formData.get('notes') || null
    };

    try {
      if (isEdit) {
        await inventoryApi.update(item.id, data);
        showToast('Element actualizat', 'success');
      } else {
        const createdItem = await inventoryApi.create(data);
        const supabase = await getSupabase();
        const { error } = await supabase.rpc('generate_inventory_item_number', {
          p_inventory_item_id: createdItem.id
        });
        if (error) throw error;
        showToast('Element adăugat cu număr de inventar', 'success');
      }
      close();
      await loadInventory();
    } catch (error) {
      showToast(error.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isEdit ? 'Actualizează' : 'Adaugă';
      }
    }
  });
}
