// js/modules/proformas.js
// Modul Proforme – listare, creare, editare, emitere, conversie la factură, export PDF, istoric
// Folosește RPC atomic save_proforma_draft pentru creare/editare draft.
// Seria și numărul sunt alocate automat la emitere; nu există câmpuri pentru ele în formular.
// Modalurile cu câmpuri editabile folosesc beforeClose pentru confirmarea modificărilor nesalvate.

import { proformasApi, proformaSeriesApi, clientsApi, settingsApi } from '../api.js';
import { calculateInvoiceTotals, calculateLineTotals, formatCurrency, formatDate, toInputDate, showToast, escapeHtml } from '../utils.js';
import { createModal, renderStatusBadge, confirmDialog, renderTable, renderSkeleton, renderEmptyState } from '../ui.js';
import { previewProforma } from '../services/pdf-service.js';

let currentProformas = [];
let filters = {
  status: 'all',
  search: ''
};

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-heading">
        <h2>Proforme</h2>
        <p>Pregătește oferte comerciale și transformă proformele acceptate în facturi.</p>
      </div>
      <button class="btn btn-primary" id="create-proforma" title="Creează o proformă nouă">＋ Proformă nouă</button>
    </div>
    <div class="card filter-card">
      <div class="filter-card-heading"><div><span class="card-eyebrow">Găsește rapid</span><h3>Caută și filtrează</h3></div><button class="btn-link clear-filters" id="proforma-reset-filters" type="button">Resetează filtrele</button></div>
      <div class="filters-row">
        <div class="form-group">
          <label for="proforma-search">Serie sau număr</label>
          <input type="search" id="proforma-search" placeholder="Ex: PRF-24" value="${escapeHtml(filters.search)}">
        </div>
        <div class="form-group">
          <label for="proforma-filter-status">Starea documentului</label>
          <select id="proforma-filter-status">
            <option value="all" ${filters.status === 'all' ? 'selected' : ''}>Toate statusurile</option>
            <option value="DRAFT" ${filters.status === 'DRAFT' ? 'selected' : ''}>Ciornă</option>
            <option value="ISSUED" ${filters.status === 'ISSUED' ? 'selected' : ''}>Emisă</option>
            <option value="CONVERTED" ${filters.status === 'CONVERTED' ? 'selected' : ''}>Convertită</option>
            <option value="CANCELLED" ${filters.status === 'CANCELLED' ? 'selected' : ''}>Anulată</option>
          </select>
        </div>
        <div class="form-group">
          <label class="filter-action-label" aria-hidden="true">Aplică</label>
          <button class="btn btn-outline" id="proforma-search-btn" title="Aplică filtrele">Caută proforme</button>
        </div>
      </div>
    </div>
    <div id="proformas-list"></div>
  `;

  document.getElementById('create-proforma').addEventListener('click', () => openProformaModal());
  document.getElementById('proforma-reset-filters').addEventListener('click', () => {
    filters = { status: 'all', search: '' };
    render(container);
  });
  document.getElementById('proforma-search-btn').addEventListener('click', () => {
    filters.search = document.getElementById('proforma-search').value.trim();
    filters.status = document.getElementById('proforma-filter-status').value;
    loadProformas();
  });
  document.getElementById('proforma-search').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      filters.search = e.target.value.trim();
      filters.status = document.getElementById('proforma-filter-status').value;
      loadProformas();
    }
  });

  await loadProformas();
}

export function destroy() {}

async function loadProformas() {
  const listContainer = document.getElementById('proformas-list');
  if (!listContainer) return;
  listContainer.innerHTML = renderSkeleton(5);

  try {
    currentProformas = await proformasApi.list(filters);
    renderProformasList(listContainer);
  } catch (error) {
    console.error('Eroare la încărcarea proformelor:', error);
    listContainer.innerHTML = `<div class="alert alert-error">${escapeHtml(error.message || 'Nu am putut încărca proformele')}</div>`;
  }
}

function renderProformasList(container) {
  if (!currentProformas || currentProformas.length === 0) {
    container.innerHTML = renderEmptyState(
      'Nu ai proforme în această listă.',
      'Creează prima proformă',
      () => openProformaModal()
    );
    return;
  }

  const headers = [
    { label: 'Serie/Număr', key: 'number' },
    { label: 'Client', key: 'client' },
    { label: 'Descriere', key: 'description' },
    { label: 'Data', key: 'issue_date' },
    { label: 'Scadență', key: 'due_date' },
    { label: 'Total', key: 'total', align: 'right' },
    { label: 'Stare', key: 'status' },
    { label: 'Acțiuni', key: 'actions' }
  ];

  const rows = currentProformas.map(proforma => {
    const clientName = proforma.clients ? proforma.clients.legal_name : '-';
    const statusBadge = renderStatusBadge(proforma.document_status);

    let description = '-';
    if (proforma.notes && proforma.notes.trim() !== '') {
      description = proforma.notes;
    } else if (proforma.proforma_lines && proforma.proforma_lines.length > 0) {
      description = proforma.proforma_lines[0].description || '-';
    }

    const canEdit = proforma.document_status === 'DRAFT';
    const canDelete = proforma.document_status === 'DRAFT';

    const actions = `
      <div class="flex gap-1">
        <button class="btn btn-sm btn-outline" data-action="view" data-id="${proforma.id}" title="Vezi detalii proformă">Vezi</button>
        <button class="btn btn-sm btn-outline" data-action="pdf" data-id="${proforma.id}" title="Previzualizează și tipărește">Previzualizare</button>
        ${canEdit ? `
          <button class="btn btn-sm btn-outline" data-action="edit" data-id="${proforma.id}" title="Editează draft">Editează</button>
          <button class="btn btn-sm btn-danger" data-action="delete" data-id="${proforma.id}" title="Șterge draft">Șterge</button>
          <button class="btn btn-sm btn-primary" data-action="issue" data-id="${proforma.id}" title="Emite proforma">Emite</button>
        ` : ''}
        ${proforma.document_status === 'ISSUED' ? `
          <button class="btn btn-sm btn-success" data-action="convert" data-id="${proforma.id}" title="Convertește la factură">Convertește</button>
        ` : ''}
        <button class="btn btn-sm btn-outline" data-action="history" data-id="${proforma.id}" title="Istoric proformă">Istoric</button>
      </div>
    `;
    return {
      number: proforma.series && proforma.number ? `${proforma.series}-${proforma.number}` : 'Ciornă',
      client: clientName,
      description: escapeHtml(description),
      issue_date: formatDate(proforma.issue_date),
      due_date: proforma.due_date ? formatDate(proforma.due_date) : '-',
      total: formatCurrency(proforma.total, proforma.currency),
      status: statusBadge,
      actions
    };
  });

  container.innerHTML = `<div class="list-summary"><span><strong>${currentProformas.length}</strong> ${currentProformas.length === 1 ? 'proformă găsită' : 'proforme găsite'}</span></div>` + renderTable(headers, rows, { emptyMessage: 'Nu există proforme', rawColumns: ['status', 'actions'] });

  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      const proforma = currentProformas.find(p => p.id === id);
      if (!proforma) return;

      if (action === 'view') {
        openProformaDetail(proforma.id);
      } else if (action === 'pdf') {
        try {
          const fullProforma = await proformasApi.get(proforma.id);
          const pfaSettings = await settingsApi.getSettings();
          previewProforma(fullProforma, pfaSettings || {});
        } catch (error) {
          showToast('Nu am putut genera PDF-ul: ' + error.message, 'error');
        }
      } else if (action === 'edit') {
        openProformaModal(proforma);
      } else if (action === 'delete') {
        if (proforma.document_status === 'DRAFT') {
          const ok = await confirmDialog('Sigur dorești să ștergi acest draft?', { danger: true });
          if (ok) {
            try {
              await proformasApi.removeDraft(id);
              showToast('Ciornă ștearsă', 'success');
              await loadProformas();
            } catch (error) {
              showToast(error.message, 'error');
            }
          }
        }
      } else if (action === 'issue') {
        const confirmed = await confirmDialog('Emite proforma? Seria și numărul vor fi alocate automat.');
        if (confirmed) {
          try {
            const result = await proformasApi.issue(id);
            showToast(`Proformă emisă: ${result.series}-${result.number}`, 'success');
            await loadProformas();
          } catch (error) {
            showToast(error.message, 'error');
          }
        }
      } else if (action === 'convert') {
        const confirmed = await confirmDialog('Convertești proforma într-un draft de factură? Proforma va fi marcată ca convertită.');
        if (confirmed) {
          try {
            const result = await proformasApi.convertToInvoice(id);
            showToast(`Factură draft creată: ${result.invoice_id}`, 'success');
            await loadProformas();
            window.location.hash = '#/invoices';
          } catch (error) {
            showToast(error.message, 'error');
          }
        }
      } else if (action === 'history') {
        openProformaHistory(id);
      }
    });
  });
}

// ------------------ MODAL ISTORIC PROFORMĂ ------------------
async function openProformaHistory(proformaId) {
  try {
    const supabase = await getSupabase();
    const { data: logs, error } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('entity_type', 'proforma')
      .eq('entity_id', proformaId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const content = `
      ${logs.length === 0 ? '<p>Nu există evenimente.</p>' : `
        <div class="table-container">
          <table>
            <thead><tr><th>Data</th><th>Eveniment</th><th>Detalii</th></tr></thead>
            <tbody>
              ${logs.map(log => `
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
    createModal({ title: 'Istoric proformă', content, size: 'lg' });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ------------------ MODAL CREARE/EDITARE PROFORMĂ ------------------
async function openProformaModal(proforma = null) {
  const isEdit = !!proforma;
  const title = isEdit ? 'Editează proformă draft' : 'Creează proformă';

  const clientsList = await clientsApi.list({ active: true });
  if (!clientsList || clientsList.length === 0) {
    showToast('Adaugă mai întâi un client în modulul Clienți', 'warning');
    return;
  }

  let activeSeriesInfo = null;
  try {
    activeSeriesInfo = await proformaSeriesApi.getActiveSeriesAndNextNumber();
  } catch (e) {
    console.warn('Nu am putut obține seria activă de proforme:', e);
  }

  let existingLines = [];
  if (isEdit) {
    const fullProforma = await proformasApi.get(proforma.id);
    if (fullProforma && fullProforma.proforma_lines) {
      existingLines = fullProforma.proforma_lines.sort((a,b) => a.position - b.position);
    }
  }

  const clientOptions = clientsList.map(c => `<option value="${c.id}" ${proforma && proforma.client_id === c.id ? 'selected' : ''}>${escapeHtml(c.legal_name)}</option>`).join('');

  const seriesInfoHtml = activeSeriesInfo && activeSeriesInfo.success
    ? `<div class="alert alert-info">La emitere se va aloca seria <strong>${escapeHtml(activeSeriesInfo.series)}</strong> și numărul <strong>${activeSeriesInfo.next_number}</strong>.</div>`
    : '<div class="alert alert-warning">Nu există o serie activă de proforme. Adaugă una în Configurare.</div>';

  const content = `
    <form id="proforma-form">
      <div class="form-group">
        <label>Client *</label>
        <select name="client_id" required>
          <option value="">Selectează client</option>
          ${clientOptions}
        </select>
      </div>
      ${isEdit ? '' : seriesInfoHtml}
      <div class="form-row">
        <div class="form-group">
          <label>Data emiterii *</label>
          <input type="date" name="issue_date" required value="${proforma ? toInputDate(proforma.issue_date) : toInputDate(new Date())}">
        </div>
        <div class="form-group">
          <label>Data scadenței</label>
          <input type="date" name="due_date" value="${proforma && proforma.due_date ? toInputDate(proforma.due_date) : toInputDate(new Date(Date.now() + 14*24*60*60*1000))}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Monedă</label>
          <select name="currency">
            <option value="RON" ${proforma && proforma.currency === 'RON' ? 'selected' : ''}>RON</option>
            <option value="EUR" ${proforma && proforma.currency === 'EUR' ? 'selected' : ''}>EUR</option>
            <option value="USD" ${proforma && proforma.currency === 'USD' ? 'selected' : ''}>USD</option>
          </select>
        </div>
        <div class="form-group">
          <label>Termen plată (zile)</label>
          <input type="number" name="payment_terms" min="0" value="${proforma ? proforma.payment_terms : 14}">
        </div>
      </div>
      <div class="form-group">
        <label>Note</label>
        <textarea name="notes">${proforma ? escapeHtml(proforma.notes || '') : ''}</textarea>
      </div>
      <hr>
      <h4>Linii proformă</h4>
      <div id="proforma-lines-container"></div>
      <button type="button" class="btn btn-sm btn-outline" id="add-proforma-line">+ Adaugă linie</button>
      <div class="flex-between mt-2">
        <div class="flex gap-1">
          <button type="submit" class="btn btn-primary">${isEdit ? 'Salvează draft' : 'Creează draft'}</button>
          <button type="button" class="btn btn-outline" id="proforma-cancel">Anulează</button>
        </div>
        <div class="text-right">
          <strong>Total: <span id="proforma-total-display">0.00</span></strong>
        </div>
      </div>
    </form>
  `;

  let isDirty = false;
  const markDirty = () => { isDirty = true; };

  const { modalElement, close } = createModal({
    title,
    content,
    size: 'lg',
    closeOnOverlayClick: false,
    beforeClose: async () => {
      if (isDirty) {
        return await confirmDialog('Aveți modificări nesalvate. Sigur doriți să închideți?', {
          title: 'Modificări nesalvate',
          confirmText: 'Da, închide',
          cancelText: 'Continuă editarea',
          danger: true
        });
      }
      return true;
    }
  });

  const addLine = (lineData = {}) => {
    const container = modalElement.querySelector('#proforma-lines-container');
    const lineHtml = `
      <div class="form-row proforma-line">
        <div class="form-group" style="flex: 3;">
          <label>Descriere</label>
          <input type="text" name="line_description[]" value="${escapeHtml(lineData.description || '')}" required>
        </div>
        <div class="form-group" style="flex: 1;">
          <label>Cant.</label>
          <input type="number" step="0.01" min="0" name="line_quantity[]" value="${lineData.quantity || 1}" required>
        </div>
        <div class="form-group" style="flex: 1;">
          <label>UM</label>
          <input type="text" name="line_unit[]" value="${escapeHtml(lineData.unit || 'buc')}">
        </div>
        <div class="form-group" style="flex: 1;">
          <label>Preț unitar</label>
          <input type="number" step="0.01" min="0" name="line_unit_price[]" value="${lineData.unit_price || 0}" required>
        </div>
        <div class="form-group" style="flex: 0.5;">
          <label>Discount</label>
          <input type="number" step="0.01" min="0" name="line_discount[]" value="${lineData.discount || 0}">
        </div>
        <div class="form-group" style="flex: 0.8;">
          <label>TVA %</label>
          <input type="number" step="0.01" min="0" name="line_vat_rate[]" value="${lineData.vat_rate || 0}">
        </div>
        <div class="form-group" style="flex: 0.4; display: flex; align-items: flex-end;">
          <button type="button" class="btn btn-sm btn-danger remove-proforma-line" style="margin-bottom: 8px;">×</button>
        </div>
      </div>
    `;
    container.insertAdjacentHTML('beforeend', lineHtml);
    recalcTotal();
    markDirty();
  };

  if (existingLines.length > 0) {
    for (const line of existingLines) {
      addLine(line);
    }
  } else {
    addLine();
  }

  modalElement.querySelector('#add-proforma-line').addEventListener('click', () => addLine());

  modalElement.querySelector('#proforma-lines-container').addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-proforma-line')) {
      const lineDiv = e.target.closest('.proforma-line');
      if (lineDiv) {
        lineDiv.remove();
        recalcTotal();
        markDirty();
      }
    }
  });

  modalElement.addEventListener('input', (e) => {
    if (e.target.matches('input[name^="line_"], input[name="client_id"], input[name="issue_date"], input[name="due_date"], input[name="currency"], input[name="payment_terms"], textarea[name="notes"]')) {
      recalcTotal();
      markDirty();
    }
  });

  function recalcTotal() {
    const lineDivs = modalElement.querySelectorAll('.proforma-line');
    const lines = [...lineDivs].map(lineDiv => ({
      quantity: lineDiv.querySelector('[name="line_quantity[]"]').value,
      unit_price: lineDiv.querySelector('[name="line_unit_price[]"]').value,
      discount: lineDiv.querySelector('[name="line_discount[]"]').value,
      vat_rate: lineDiv.querySelector('[name="line_vat_rate[]"]').value
    }));
    const { total } = calculateInvoiceTotals(lines);
    const display = modalElement.querySelector('#proforma-total-display');
    if (display) display.textContent = total.toFixed(2);
  }

  modalElement.querySelector('#proforma-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = modalElement.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Se salvează...';
    }

    const form = e.target;
    const formData = new FormData(form);

    const lineDivs = modalElement.querySelectorAll('.proforma-line');
    const lines = [];
    for (const lineDiv of lineDivs) {
      const description = lineDiv.querySelector('[name="line_description[]"]').value.trim();
      const quantity = parseFloat(lineDiv.querySelector('[name="line_quantity[]"]').value) || 0;
      const unit = lineDiv.querySelector('[name="line_unit[]"]').value || 'buc';
      const unit_price = parseFloat(lineDiv.querySelector('[name="line_unit_price[]"]').value) || 0;
      const discount = parseFloat(lineDiv.querySelector('[name="line_discount[]"]').value) || 0;
      const vat_rate = parseFloat(lineDiv.querySelector('[name="line_vat_rate[]"]').value) || 0;
      const vat_category = vat_rate > 0 ? 'STANDARD' : 'NONE';
      const { net_amount, vat_amount, total_amount } = calculateLineTotals({
        quantity, unit_price, discount, vat_rate
      });

      if (!description || quantity <= 0) continue;

      lines.push({ description, quantity, unit, unit_price, discount, vat_rate, vat_category, net_amount, vat_amount, total_amount });
    }

    if (lines.length === 0) {
      showToast('Adaugă cel puțin o linie', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isEdit ? 'Salvează draft' : 'Creează draft';
      }
      return;
    }

    const data = {
      id: proforma ? proforma.id : null,
      client_id: formData.get('client_id'),
      issue_date: formData.get('issue_date'),
      due_date: formData.get('due_date') || null,
      currency: formData.get('currency'),
      payment_terms: parseInt(formData.get('payment_terms')) || 14,
      notes: formData.get('notes') || null
    };

    // Serie și număr sunt null la draft; vor fi alocate la emitere.
    data.series = null;
    data.number = null;

    try {
      await proformasApi.saveDraft(data, lines);
      isDirty = false;
      showToast(isEdit ? 'Proformă actualizată' : 'Proformă draft creată', 'success');
      close();
      await loadProformas();
    } catch (error) {
      showToast(error.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isEdit ? 'Salvează draft' : 'Creează draft';
      }
    }
  });

  modalElement.querySelector('#proforma-cancel').addEventListener('click', () => close());

  recalcTotal();
}

// ------------------ MODAL VIZUALIZARE DETALIU PROFORMĂ ------------------
async function openProformaDetail(proformaId) {
  try {
    const proforma = await proformasApi.get(proformaId);
    if (!proforma) return;

    const lines = proforma.proforma_lines || [];
    const clientName = proforma.clients ? proforma.clients.legal_name : '-';

    const content = `
      <div class="mb-2">
        <strong>Proforma:</strong> ${proforma.series && proforma.number ? `${proforma.series}-${proforma.number}` : 'Ciornă'}
        (${renderStatusBadge(proforma.document_status)})
      </div>
      <div class="grid mb-2">
        <div><strong>Client:</strong> ${escapeHtml(clientName)}</div>
        <div><strong>Data:</strong> ${formatDate(proforma.issue_date)}</div>
        <div><strong>Scadență:</strong> ${proforma.due_date ? formatDate(proforma.due_date) : '-'}</div>
        <div><strong>Total:</strong> ${formatCurrency(proforma.total, proforma.currency)}</div>
      </div>
      ${proforma.notes ? `<p><strong>Note:</strong> ${escapeHtml(proforma.notes)}</p>` : ''}
      ${renderTable(
        [
          { label: 'Descriere', key: 'description' },
          { label: 'Cant', key: 'quantity' },
          { label: 'Preț', key: 'unit_price', align: 'right' },
          { label: 'Disc', key: 'discount', align: 'right' },
          { label: 'TVA', key: 'vat_amount', align: 'right' },
          { label: 'Total', key: 'total_amount', align: 'right' }
        ],
        lines.map(l => ({
          description: l.description,
          quantity: l.quantity + ' ' + (l.unit || ''),
          unit_price: formatCurrency(l.unit_price, proforma.currency),
          discount: formatCurrency(l.discount, proforma.currency),
          vat_amount: formatCurrency(l.vat_amount, proforma.currency),
          total_amount: formatCurrency(l.total_amount, proforma.currency)
        }))
      )}
      <div class="flex gap-1 mt-2">
        <button class="btn btn-sm btn-outline" data-action="pdf-from-detail" data-id="${proforma.id}" title="Previzualizează și tipărește">Previzualizare</button>
        ${proforma.document_status === 'ISSUED' ? `<button class="btn btn-sm btn-success" data-action="convert-from-detail" data-id="${proforma.id}" title="Convertește la factură">Convertește la factură</button>` : ''}
        <button class="btn btn-sm btn-outline" id="detail-close">Închide</button>
      </div>
    `;

    const { modalElement, close } = createModal({ title: 'Detalii proformă', content, size: 'lg' });
    modalElement.querySelector('#detail-close').addEventListener('click', close);

    const pdfBtn = modalElement.querySelector('[data-action="pdf-from-detail"]');
    if (pdfBtn) {
      pdfBtn.addEventListener('click', async () => {
        try {
          const pfaSettings = await settingsApi.getSettings();
          previewProforma(proforma, pfaSettings || {});
        } catch (error) {
          showToast('Nu am putut genera PDF-ul: ' + error.message, 'error');
        }
      });
    }

    const convertBtn = modalElement.querySelector('[data-action="convert-from-detail"]');
    if (convertBtn) {
      convertBtn.addEventListener('click', async () => {
        close();
        try {
          const result = await proformasApi.convertToInvoice(proforma.id);
          showToast(`Factură draft creată: ${result.invoice_id}`, 'success');
          window.location.hash = '#/invoices';
        } catch (error) {
          showToast(error.message, 'error');
        }
      });
    }
  } catch (error) {
    showToast(error.message, 'error');
  }
}
