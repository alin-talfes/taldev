// js/modules/fixed-assets.js
// Modul Mijloace fixe – gestionare completă, amortizare, scoatere din funcțiune
// UX îmbunătățit: skeleton loading, empty state cu callback, tooltips, feedback la submit
// FIX: marcare coloane raw pentru renderTable (status, actions)

import { fixedAssetsApi } from '../api.js';
import { getSupabase } from '../supabase.js';
import { formatDate, toInputDate, showToast, escapeHtml, formatCurrency } from '../utils.js';
import { createModal, renderStatusBadge, confirmDialog, renderTable, renderSkeleton, renderEmptyState } from '../ui.js';

let currentAssets = [];
let filters = {
  status: 'all',
  search: ''
};

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-heading"><h2>Mijloace fixe</h2><p>Gestionează achizițiile, amortizarea și scoaterea din funcțiune a activelor PFA.</p></div>
      <button class="btn btn-primary" id="add-fixed-asset" title="Adaugă un mijloc fix">＋ Mijloc fix nou</button>
    </div>
    <div class="card filter-card">
      <div class="filter-card-heading"><div><span class="card-eyebrow">Patrimoniu</span><h3>Caută și filtrează</h3></div><button class="btn-link clear-filters" id="asset-reset-filters" type="button">Resetează filtrele</button></div>
      <div class="filters-row">
        <div class="form-group">
          <label for="asset-search">Nume, serie sau număr de inventar</label>
          <input type="search" id="asset-search" placeholder="Ex: monitor sau MF-2026-001" value="${escapeHtml(filters.search)}">
        </div>
        <div class="form-group">
          <label for="asset-filter-status">Starea mijlocului fix</label>
          <select id="asset-filter-status">
            <option value="all" ${filters.status === 'all' ? 'selected' : ''}>Toate statusurile</option>
            <option value="draft" ${filters.status === 'draft' ? 'selected' : ''}>Ciornă</option>
            <option value="acquired" ${filters.status === 'acquired' ? 'selected' : ''}>Achiziționat</option>
            <option value="in_service" ${filters.status === 'in_service' ? 'selected' : ''}>În funcțiune</option>
            <option value="depreciating" ${filters.status === 'depreciating' ? 'selected' : ''}>În amortizare</option>
            <option value="fully_depreciated" ${filters.status === 'fully_depreciated' ? 'selected' : ''}>Amortizat complet</option>
            <option value="sold" ${filters.status === 'sold' ? 'selected' : ''}>Vândut</option>
            <option value="scrapped" ${filters.status === 'scrapped' ? 'selected' : ''}>Casat</option>
            <option value="disposed" ${filters.status === 'disposed' ? 'selected' : ''}>Scos din funcțiune</option>
          </select>
        </div>
        <div class="form-group">
          <label class="filter-action-label" aria-hidden="true">Aplică</label>
          <button class="btn btn-outline" id="asset-search-btn" title="Aplică filtrele">Caută active</button>
        </div>
      </div>
    </div>
    <div id="assets-list"></div>
  `;

  document.getElementById('add-fixed-asset').addEventListener('click', () => openAssetModal());
  document.getElementById('asset-reset-filters').addEventListener('click', () => {
    filters = { status: 'all', search: '' };
    render(container);
  });
  document.getElementById('asset-search-btn').addEventListener('click', () => {
    filters.search = document.getElementById('asset-search').value.trim();
    filters.status = document.getElementById('asset-filter-status').value;
    loadAssets();
  });
  document.getElementById('asset-search').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      filters.search = e.target.value.trim();
      filters.status = document.getElementById('asset-filter-status').value;
      loadAssets();
    }
  });

  await loadAssets();
}

export function destroy() {}

async function loadAssets() {
  const listContainer = document.getElementById('assets-list');
  if (!listContainer) return;
  listContainer.innerHTML = renderSkeleton(5);

  try {
    const assets = await fixedAssetsApi.list();
    currentAssets = assets.filter(asset => {
      const matchesStatus = filters.status === 'all' || asset.status === filters.status;
      const matchesSearch = !filters.search || 
        (asset.name && asset.name.toLowerCase().includes(filters.search.toLowerCase())) ||
        (asset.serial_number && asset.serial_number.toLowerCase().includes(filters.search.toLowerCase())) ||
        (asset.inventory_number && asset.inventory_number.toLowerCase().includes(filters.search.toLowerCase()));
      return matchesStatus && matchesSearch;
    });
    renderAssetsList(listContainer);
  } catch (error) {
    console.error('Eroare la încărcarea mijloacelor fixe:', error);
    listContainer.innerHTML = `<div class="alert alert-error">${escapeHtml(error.message || 'Nu am putut încărca mijloacele fixe')}</div>`;
  }
}

function renderAssetsList(container) {
  if (!currentAssets || currentAssets.length === 0) {
    container.innerHTML = renderEmptyState(
      'Nu ai mijloace fixe în această listă.',
      'Adaugă primul mijloc fix',
      () => openAssetModal()
    );
    return;
  }

  const headers = [
    { label: 'Număr inventar', key: 'inventory_number' },
    { label: 'Nume', key: 'name' },
    { label: 'Categorie', key: 'asset_category' },
    { label: 'Data achiziției', key: 'acquisition_date' },
    { label: 'Valoare achiziție', key: 'acquisition_value', align: 'right' },
    { label: 'Amortizare lunară', key: 'monthly_depreciation', align: 'right' },
    { label: 'Amortizare acumulată', key: 'accumulated_depreciation', align: 'right' },
    { label: 'Valoare rămasă', key: 'remaining_value', align: 'right' },
    { label: 'Stare', key: 'status' },
    { label: 'Acțiuni', key: 'actions' }
  ];

  const rows = currentAssets.map(asset => {
    const canDepreciate = (asset.status === 'in_service' || asset.status === 'depreciating') && parseFloat(asset.remaining_value) > 0 && asset.depreciation_method !== 'NONE';
    const canGeneratePlan = (asset.status === 'acquired' || asset.status === 'draft') && asset.useful_life > 0 && asset.depreciation_method === 'LINEAR';
    const canDispose = asset.status === 'in_service' || asset.status === 'depreciating' || asset.status === 'fully_depreciated';
    const needsInventoryNumber = !asset.inventory_number;
    const canEdit = asset.status === 'draft' || asset.status === 'acquired';
    const canDelete = canEdit && !asset.source_invoice_id;
    const actions = `
      <div class="flex gap-1">
        <button class="btn btn-sm btn-outline" data-action="view" data-id="${asset.id}" title="Vezi detalii mijloc fix">Vezi</button>
        ${canEdit ? `<button class="btn btn-sm btn-outline" data-action="edit" data-id="${asset.id}" title="Editează mijloc fix">Editează</button>` : ''}
        ${needsInventoryNumber ? `<button class="btn btn-sm btn-info" data-action="assign-number" data-id="${asset.id}" title="Generează număr de inventar">Număr inventar</button>` : ''}
        ${canGeneratePlan ? `<button class="btn btn-sm btn-info" data-action="generate-plan" data-id="${asset.id}" title="Verifică rata de amortizare">Verifică rata</button>` : ''}
        ${canDepreciate ? `<button class="btn btn-sm btn-success" data-action="depreciate" data-id="${asset.id}" title="Înregistrează amortizare">Amortizare</button>` : ''}
        ${canDispose ? `<button class="btn btn-sm btn-danger" data-action="dispose" data-id="${asset.id}" title="Scoate din funcțiune">Scoatere</button>` : ''}
        ${canDelete ? `<button class="btn btn-sm btn-danger" data-action="delete" data-id="${asset.id}" title="Șterge ciorna mijlocului fix">Șterge</button>` : ''}
      </div>
    `;
    return {
      inventory_number: asset.inventory_number || '-',
      name: asset.name,
      asset_category: asset.asset_category || '-',
      acquisition_date: formatDate(asset.acquisition_date),
      acquisition_value: formatCurrency(asset.acquisition_value),
      monthly_depreciation: formatCurrency(asset.monthly_depreciation),
      accumulated_depreciation: formatCurrency(asset.accumulated_depreciation),
      remaining_value: formatCurrency(asset.remaining_value),
      status: renderStatusBadge(asset.status),
      actions
    };
  });

  const totalRemaining = currentAssets.reduce((sum, asset) => sum + parseFloat(asset.remaining_value || 0), 0);
  container.innerHTML = `<div class="list-summary"><span><strong>${currentAssets.length}</strong> ${currentAssets.length === 1 ? 'mijloc fix găsit' : 'mijloace fixe găsite'}</span><span>Valoare rămasă: <strong>${formatCurrency(totalRemaining)}</strong></span></div>` + renderTable(headers, rows, { emptyMessage: 'Nu există mijloace fixe', rawColumns: ['status', 'actions'] });

  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      const asset = currentAssets.find(a => a.id === id);
      if (!asset) return;

      if (action === 'view') {
        openAssetDetail(asset);
      } else if (action === 'edit') {
        openAssetModal(asset);
      } else if (action === 'assign-number') {
        try {
          await fixedAssetsApi.generateInventoryNumber(asset.id);
          showToast('Număr de inventar generat', 'success');
          await loadAssets();
        } catch (error) {
          showToast(error.message, 'error');
        }
      } else if (action === 'generate-plan') {
        openGeneratePlanModal(asset);
      } else if (action === 'depreciate') {
        openDepreciationModal(asset);
      } else if (action === 'dispose') {
        openDisposeModal(asset);
      } else if (action === 'delete') {
        const ok = await confirmDialog('Sigur dorești să ștergi această ciornă de mijloc fix?', { danger: true });
        if (ok) {
          try {
            await fixedAssetsApi.remove(id);
            showToast('Mijloc fix șters', 'success');
            await loadAssets();
          } catch (error) {
            showToast(error.message, 'error');
          }
        }
      }
    });
  });
}

// ------------------ MODAL DETALIU ------------------
async function openAssetDetail(asset) {
  try {
    const supabase = await getSupabase();

    const { data: depreciations, error: depError } = await supabase
      .from('fixed_asset_depreciation_entries')
      .select('*')
      .eq('fixed_asset_id', asset.id)
      .order('period', { ascending: false });

    if (depError) throw depError;

    const { data: auditLogs, error: auditError } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('entity_type', 'fixed_asset')
      .eq('entity_id', asset.id)
      .order('created_at', { ascending: false });

    if (auditError) throw auditError;

    const content = `
      <div class="grid mb-2">
        <div><strong>Număr inventar:</strong> ${asset.inventory_number || '-'}</div>
        <div><strong>Nume:</strong> ${escapeHtml(asset.name)}</div>
        <div><strong>Categorie:</strong> ${asset.asset_category || '-'}</div>
        <div><strong>Cod clasificare:</strong> ${asset.classification_code || '-'}</div>
        <div><strong>Serie:</strong> ${asset.serial_number || '-'}</div>
        <div><strong>Furnizor:</strong> ${asset.supplier_id || '-'}</div>
        <div><strong>Factură achiziție:</strong> ${asset.source_invoice_id || '-'}</div>
        <div><strong>Data achiziției:</strong> ${formatDate(asset.acquisition_date)}</div>
        <div><strong>Data intrării:</strong> ${formatDate(asset.entry_date)}</div>
        <div><strong>Data punerii în funcțiune:</strong> ${formatDate(asset.commissioning_date)}</div>
        <div><strong>Valoare achiziție:</strong> ${formatCurrency(asset.acquisition_value)}</div>
        <div><strong>Valoare reziduală:</strong> ${formatCurrency(asset.residual_value)}</div>
        <div><strong>Metodă amortizare:</strong> ${asset.depreciation_method}</div>
        <div><strong>Durată de viață (luni):</strong> ${asset.useful_life || '-'}</div>
        <div><strong>Data începerii amortizării:</strong> ${formatDate(asset.depreciation_start_date)}</div>
        <div><strong>Amortizare lunară:</strong> ${formatCurrency(asset.monthly_depreciation)}</div>
        <div><strong>Amortizare acumulată:</strong> ${formatCurrency(asset.accumulated_depreciation)}</div>
        <div><strong>Valoare rămasă:</strong> ${formatCurrency(asset.remaining_value)}</div>
        <div><strong>Stare:</strong> ${renderStatusBadge(asset.status)}</div>
        <div><strong>Locație:</strong> ${asset.location || '-'}</div>
        <div><strong>Responsabil:</strong> ${asset.responsible_person || '-'}</div>
      </div>

      <h4>Istoric amortizare</h4>
      ${depreciations.length === 0 ? '<p>Nu există înregistrări de amortizare.</p>' : `
        <div class="table-container">
          <table>
            <thead><tr><th>Perioadă</th><th>Sumă</th><th>Cumulat</th><th>Rămas</th></tr></thead>
            <tbody>
              ${depreciations.map(dep => `
                <tr>
                  <td>${formatDate(dep.period)}</td>
                  <td>${formatCurrency(dep.amount)}</td>
                  <td>${formatCurrency(dep.cumulative_amount)}</td>
                  <td>${formatCurrency(dep.remaining_value)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}

      <h4 class="mt-2">Istoric evenimente</h4>
      ${auditLogs.length === 0 ? '<p>Nu există evenimente.</p>' : `
        <div class="table-container">
          <table>
            <thead><tr><th>Data</th><th>Eveniment</th><th>Detalii</th></tr></thead>
            <tbody>
              ${auditLogs.map(log => `
                <tr>
                  <td>${formatDate(log.created_at)}</td>
                  <td>${escapeHtml(log.event_type)}</td>
                  <td>${escapeHtml(JSON.stringify(log.event_data || {}))}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;

    createModal({ title: 'Detalii mijloc fix', content, size: 'lg' });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ------------------ MODAL GENERARE PLAN AMORTIZARE ------------------
async function openGeneratePlanModal(asset) {
  const content = `
    <p>Verifici rata de amortizare calculată de baza de date pentru <strong>${escapeHtml(asset.name)}</strong>?</p>
    <div class="grid mb-2">
      <div>Valoare de achiziție: <strong>${formatCurrency(asset.acquisition_value)}</strong></div>
      <div>Valoare reziduală: <strong>${formatCurrency(asset.residual_value)}</strong></div>
      <div>Durată de viață: <strong>${asset.useful_life} luni</strong></div>
      <div>Metodă: <strong>${asset.depreciation_method}</strong></div>
      <div>Data începerii: <strong>${formatDate(asset.depreciation_start_date || asset.commissioning_date || asset.acquisition_date)}</strong></div>
    </div>
    <div class="flex gap-1 mt-2">
      <button class="btn btn-primary" id="confirm-generate-plan">Verifică</button>
      <button class="btn btn-outline" id="cancel-generate-plan">Anulează</button>
    </div>
  `;

  const { modalElement, close } = createModal({ title: 'Calcul rată amortizare', content, closeOnOverlayClick: false });
  modalElement.querySelector('#cancel-generate-plan').addEventListener('click', close);
  modalElement.querySelector('#confirm-generate-plan').addEventListener('click', async () => {
    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase.rpc('generate_depreciation_schedule', {
        p_fixed_asset_id: asset.id,
        p_version: 1
      });
      if (error) throw error;
      showToast(`Calcul verificat: ${data.total_periods} luni, ${formatCurrency(data.monthly_depreciation)}/lună`, 'success');
      close();
      await loadAssets();
    } catch (error) {
      showToast(error.message, 'error');
    }
  });
}

// ------------------ MODAL ÎNREGISTRARE AMORTIZARE ------------------
async function openDepreciationModal(asset) {
  let monthlyDepreciation = parseFloat(asset.monthly_depreciation) || 0;
  const remainingValue = parseFloat(asset.remaining_value) || 0;
  if (monthlyDepreciation === 0) {
    try {
      const calculation = await fixedAssetsApi.generateDepreciationSchedule(asset.id);
      monthlyDepreciation = Number(calculation?.monthly_depreciation) || 0;
    } catch (error) {
      showToast(error.message, 'error');
      return;
    }
  }

  if (monthlyDepreciation > remainingValue) {
    monthlyDepreciation = remainingValue;
  }

  const content = `
    <form id="depreciation-form">
      <div class="form-group">
        <label>Perioada (luna) *</label>
        <input type="month" name="period" required value="${new Date().toISOString().slice(0, 7)}">
      </div>
      <div class="form-group">
        <label>Suma amortizării *</label>
        <input type="number" step="0.01" min="0.01" name="amount" required value="${monthlyDepreciation.toFixed(2)}">
      </div>
      <div class="alert alert-info">
        Valoare rămasă înainte: <strong>${formatCurrency(remainingValue)}</strong>
      </div>
      <div class="flex gap-1 mt-2">
        <button type="submit" class="btn btn-success">Înregistrează amortizare</button>
        <button type="button" class="btn btn-outline" id="depreciation-cancel">Anulează</button>
      </div>
    </form>
  `;

  const { modalElement, close } = createModal({ title: 'Înregistrează amortizare', content, closeOnOverlayClick: false });
  modalElement.querySelector('#depreciation-cancel').addEventListener('click', close);

  modalElement.querySelector('#depreciation-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = modalElement.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Se procesează...';
    }

    const form = e.target;
    const formData = new FormData(form);
    const period = formData.get('period');
    const amount = parseFloat(formData.get('amount'));

    if (!period || isNaN(amount) || amount <= 0) {
      showToast('Perioadă sau sumă invalidă', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Înregistrează amortizare';
      }
      return;
    }

    const periodDate = period + '-01';

    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase.rpc('record_depreciation_entry', {
        p_fixed_asset_id: asset.id,
        p_period: periodDate,
        p_amount: amount
      });
      if (error) throw error;
      showToast('Amortizare înregistrată', 'success');
      close();
      await loadAssets();
    } catch (error) {
      showToast(error.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Înregistrează amortizare';
      }
    }
  });
}

// ------------------ MODAL SCOATERE DIN FUNCȚIUNE ------------------
async function openDisposeModal(asset) {
  const content = `
    <form id="dispose-form">
      <div class="form-group">
        <label>Tip scoatere *</label>
        <select name="disposal_type" required>
          <option value="sold">Vânzare</option>
          <option value="scrapped">Casare</option>
          <option value="disposed">Scoatere din funcțiune</option>
        </select>
      </div>
      <div class="form-group">
        <label>Data scoaterii *</label>
        <input type="date" name="disposal_date" required value="${toInputDate(new Date())}">
      </div>
      <div class="form-group">
        <label>Note</label>
        <textarea name="notes" placeholder="Motiv, document, etc."></textarea>
      </div>
      <div class="flex gap-1 mt-2">
        <button type="submit" class="btn btn-danger">Confirmă scoaterea</button>
        <button type="button" class="btn btn-outline" id="dispose-cancel">Anulează</button>
      </div>
    </form>
  `;

  const { modalElement, close } = createModal({ title: 'Scoatere din funcțiune', content, closeOnOverlayClick: false });
  modalElement.querySelector('#dispose-cancel').addEventListener('click', close);
  modalElement.querySelector('#dispose-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = modalElement.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Se procesează...';
    }

    const form = e.target;
    const formData = new FormData(form);
    const disposalType = formData.get('disposal_type');
    const disposalDate = formData.get('disposal_date');
    const notes = formData.get('notes') || null;

    try {
      const supabase = await getSupabase();
      const { data, error } = await supabase.rpc('dispose_fixed_asset', {
        p_fixed_asset_id: asset.id,
        p_disposal_type: disposalType,
        p_disposal_date: disposalDate,
        p_notes: notes
      });
      if (error) throw error;
      showToast('Mijloc fix scos din funcțiune', 'success');
      close();
      await loadAssets();
    } catch (error) {
      showToast(error.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Confirmă scoaterea';
      }
    }
  });
}

// ------------------ MODAL ADĂUGARE/EDITARE ------------------
function openAssetModal(asset = null) {
  const isEdit = !!asset;
  const title = isEdit ? 'Editează mijloc fix' : 'Adaugă mijloc fix';

  const content = `
    <form id="asset-form">
      <div class="form-group">
        <label>Nume *</label>
        <input type="text" name="name" required value="${asset ? escapeHtml(asset.name) : ''}" placeholder="Ex: Laptop">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Data achiziției *</label>
          <input type="date" name="acquisition_date" required value="${asset ? toInputDate(asset.acquisition_date) : toInputDate(new Date())}">
        </div>
        <div class="form-group">
          <label>Valoare achiziție *</label>
          <input type="number" step="0.01" min="0.01" name="acquisition_value" required value="${asset ? asset.acquisition_value : ''}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Valoare reziduală</label>
          <input type="number" step="0.01" min="0" name="residual_value" value="${asset ? asset.residual_value : '0'}">
        </div>
        <div class="form-group">
          <label>Monedă</label>
          <select name="currency">
            <option value="RON" selected>RON (valoare fiscală pentru amortizare)</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Categorie</label>
          <input type="text" name="asset_category" value="${asset ? escapeHtml(asset.asset_category || '') : ''}" placeholder="Ex: IT">
        </div>
        <div class="form-group">
          <label>Cod clasificare</label>
          <input type="text" name="classification_code" value="${asset ? escapeHtml(asset.classification_code || '') : ''}" placeholder="Ex: 2.1.1">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Număr de serie</label>
          <input type="text" name="serial_number" value="${asset ? escapeHtml(asset.serial_number || '') : ''}">
        </div>
        <div class="form-group">
          <label>Locație</label>
          <input type="text" name="location" value="${asset ? escapeHtml(asset.location || '') : ''}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Responsabil</label>
          <input type="text" name="responsible_person" value="${asset ? escapeHtml(asset.responsible_person || '') : ''}">
        </div>
        <div class="form-group">
          <label>Data punerii în funcțiune</label>
          <input type="date" name="commissioning_date" value="${asset && asset.commissioning_date ? toInputDate(asset.commissioning_date) : ''}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Durata de viață (luni)</label>
          <input type="number" min="1" name="useful_life" value="${asset ? asset.useful_life || '' : ''}" placeholder="Ex: 36">
        </div>
        <div class="form-group">
          <label>Metoda de amortizare</label>
          <select name="depreciation_method">
            <option value="LINEAR" ${asset && asset.depreciation_method === 'LINEAR' ? 'selected' : ''}>Liniară</option>
            <option value="DEGRESSIVE" ${asset && asset.depreciation_method === 'DEGRESSIVE' ? 'selected' : ''}>Degresivă</option>
            <option value="NONE" ${asset && asset.depreciation_method === 'NONE' ? 'selected' : ''}>Fără amortizare</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Data începerii amortizării</label>
          <input type="date" name="depreciation_start_date" value="${asset && asset.depreciation_start_date ? toInputDate(asset.depreciation_start_date) : ''}">
        </div>
        <div class="form-group">
          <label>Stare</label>
          <select name="status">
            <option value="draft" ${asset && asset.status === 'draft' ? 'selected' : ''}>Ciornă</option>
            <option value="acquired" ${asset && asset.status === 'acquired' ? 'selected' : ''}>Achiziționat</option>
            <option value="in_service" ${asset && asset.status === 'in_service' ? 'selected' : ''}>În funcțiune</option>
            <option value="depreciating" ${asset && asset.status === 'depreciating' ? 'selected' : ''}>În amortizare</option>
            <option value="fully_depreciated" ${asset && asset.status === 'fully_depreciated' ? 'selected' : ''}>Amortizat complet</option>
            <option value="sold" ${asset && asset.status === 'sold' ? 'selected' : ''}>Vândut</option>
            <option value="scrapped" ${asset && asset.status === 'scrapped' ? 'selected' : ''}>Casat</option>
            <option value="disposed" ${asset && asset.status === 'disposed' ? 'selected' : ''}>Scos din funcțiune</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Note</label>
        <textarea name="notes">${asset ? escapeHtml(asset.notes || '') : ''}</textarea>
      </div>
      <div class="flex gap-1 mt-2">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Actualizează' : 'Adaugă'}</button>
        <button type="button" class="btn btn-outline" id="asset-cancel">Anulează</button>
      </div>
    </form>
  `;

  const { modalElement, close } = createModal({ title, content, size: 'lg', closeOnOverlayClick: false });
  modalElement.querySelector('#asset-cancel').addEventListener('click', close);

  modalElement.querySelector('#asset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = modalElement.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Se salvează...';
    }

    const form = e.target;
    const formData = new FormData(form);
    const acquisitionValue = parseFloat(formData.get('acquisition_value')) || 0;
    const residualValue = parseFloat(formData.get('residual_value')) || 0;
    const accumulated = asset ? parseFloat(asset.accumulated_depreciation) : 0;
    const remainingValue = acquisitionValue - accumulated;

    const data = {
      name: formData.get('name'),
      acquisition_date: formData.get('acquisition_date'),
      acquisition_value: acquisitionValue,
      residual_value: residualValue,
      currency: formData.get('currency'),
      asset_category: formData.get('asset_category') || null,
      classification_code: formData.get('classification_code') || null,
      serial_number: formData.get('serial_number') || null,
      location: formData.get('location') || null,
      responsible_person: formData.get('responsible_person') || null,
      commissioning_date: formData.get('commissioning_date') || null,
      useful_life: formData.get('useful_life') ? parseInt(formData.get('useful_life')) : null,
      depreciation_method: formData.get('depreciation_method'),
      depreciation_start_date: formData.get('depreciation_start_date') || null,
      remaining_value: remainingValue,
      net_book_value: remainingValue,
      status: formData.get('status'),
      notes: formData.get('notes') || null
    };

    try {
      if (isEdit) {
        await fixedAssetsApi.update(asset.id, data);
        showToast('Mijloc fix actualizat', 'success');
      } else {
        const createdAsset = await fixedAssetsApi.create(data);
        await fixedAssetsApi.generateInventoryNumber(createdAsset.id);
        showToast('Mijloc fix adăugat', 'success');
      }
      close();
      await loadAssets();
    } catch (error) {
      showToast(error.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isEdit ? 'Actualizează' : 'Adaugă';
      }
    }
  });
}
