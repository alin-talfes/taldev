// js/modules/received-invoices.js
// Modul Facturi primite – listare, creare, editare, confirmare, plată, documente, storno, ștergere draft
// Folosește RPC-uri atomice pentru salvare draft, storno și confirmare.
// Modalurile cu câmpuri editabile folosesc beforeClose pentru confirmarea modificărilor nesalvate.
// La stornare, factura originală devine CANCELLED și nu mai poate fi plătită.
// Fix: butonul „Înregistrează plată” apare pentru facturile confirmate cu sold pozitiv,
// indiferent de existența unui storno (deoarece storno-ul face ca statusul să fie CANCELLED).

import { receivedInvoicesApi, suppliersApi, transactionsApi, documentsApi } from '../api.js';
import { getSupabase } from '../supabase.js';
import { calculateInvoiceTotals, calculateLineTotals, formatCurrency, formatDate, toInputDate, showToast, escapeHtml } from '../utils.js';
import { createModal, renderStatusBadge, confirmDialog, renderTable, renderSkeleton, renderEmptyState } from '../ui.js';
import { bindFxPreview, fxFieldsHtml, readFxParams } from '../services/fx-accounting.js';

let currentReceivedInvoices = [];
let filters = {
  status: 'all',
  paymentStatus: 'all',
  search: ''
};

function formatDeductibilityPercent(value) {
  if (value === null || value === undefined || value === '') return '-';
  return `${value}%`;
}

function formatDeductibilityLimit(value) {
  if (value === null || value === undefined || value === '') return '-';
  return formatCurrency(value, 'RON');
}

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-heading">
        <h2>Facturi primite</h2>
        <p>Înregistrează cheltuielile, urmărește plățile și păstrează documentele furnizorilor.</p>
      </div>
      <button class="btn btn-primary" id="create-received-invoice" title="Adaugă o factură primită">＋ Factură primită</button>
    </div>
    <div class="card filter-card">
      <div class="filter-card-heading"><div><span class="card-eyebrow">Găsește rapid</span><h3>Caută și filtrează</h3></div><button class="btn-link clear-filters" id="received-invoice-reset-filters" type="button">Resetează filtrele</button></div>
      <div class="filters-row">
        <div class="form-group">
          <label for="received-invoice-search">Furnizor sau număr</label>
          <input type="search" id="received-invoice-search" placeholder="Ex: Furnizor SRL sau 1542" value="${escapeHtml(filters.search)}">
        </div>
        <div class="form-group">
          <label for="received-invoice-filter-status">Starea documentului</label>
          <select id="received-invoice-filter-status">
            <option value="all" ${filters.status === 'all' ? 'selected' : ''}>Toate statusurile</option>
            <option value="DRAFT" ${filters.status === 'DRAFT' ? 'selected' : ''}>Ciornă</option>
            <option value="RECEIVED" ${filters.status === 'RECEIVED' ? 'selected' : ''}>Primită</option>
            <option value="CONFIRMED" ${filters.status === 'CONFIRMED' ? 'selected' : ''}>Confirmată</option>
            <option value="CANCELLED" ${filters.status === 'CANCELLED' ? 'selected' : ''}>Anulată</option>
          </select>
        </div>
        <div class="form-group">
          <label for="received-invoice-filter-payment">Starea plății</label>
          <select id="received-invoice-filter-payment">
            <option value="all" ${filters.paymentStatus === 'all' ? 'selected' : ''}>Toate plățile</option>
            <option value="UNPAID" ${filters.paymentStatus === 'UNPAID' ? 'selected' : ''}>Neachitată</option>
            <option value="PARTIALLY_PAID" ${filters.paymentStatus === 'PARTIALLY_PAID' ? 'selected' : ''}>Parțial</option>
            <option value="PAID" ${filters.paymentStatus === 'PAID' ? 'selected' : ''}>Achitată</option>
          </select>
        </div>
        <div class="form-group">
          <label class="filter-action-label" aria-hidden="true">Aplică</label>
          <button class="btn btn-outline" id="received-invoice-search-btn" title="Aplică filtrele">Caută facturi</button>
        </div>
      </div>
    </div>
    <div id="received-invoices-list"></div>
  `;

  document.getElementById('create-received-invoice').addEventListener('click', () => openReceivedInvoiceModal());
  document.getElementById('received-invoice-reset-filters').addEventListener('click', () => {
    filters = { status: 'all', paymentStatus: 'all', search: '' };
    render(container);
  });
  document.getElementById('received-invoice-search-btn').addEventListener('click', () => {
    filters.search = document.getElementById('received-invoice-search').value.trim();
    filters.status = document.getElementById('received-invoice-filter-status').value;
    filters.paymentStatus = document.getElementById('received-invoice-filter-payment').value;
    loadReceivedInvoices();
  });
  document.getElementById('received-invoice-search').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      filters.search = e.target.value.trim();
      filters.status = document.getElementById('received-invoice-filter-status').value;
      filters.paymentStatus = document.getElementById('received-invoice-filter-payment').value;
      loadReceivedInvoices();
    }
  });

  await loadReceivedInvoices();
}

export function destroy() {}

async function loadReceivedInvoices() {
  const listContainer = document.getElementById('received-invoices-list');
  if (!listContainer) return;
  listContainer.innerHTML = renderSkeleton(5);

  try {
    currentReceivedInvoices = await receivedInvoicesApi.list(filters);
    renderReceivedInvoicesList(listContainer);
  } catch (error) {
    console.error('Eroare la încărcarea facturilor primite:', error);
    listContainer.innerHTML = `<div class="alert alert-error">${escapeHtml(error.message || 'Nu am putut încărca facturile primite')}</div>`;
  }
}

function renderReceivedInvoicesList(container) {
  if (!currentReceivedInvoices || currentReceivedInvoices.length === 0) {
    container.innerHTML = renderEmptyState(
      'Nu ai facturi primite în această listă.',
      'Adaugă prima factură primită',
      () => openReceivedInvoiceModal()
    );
    return;
  }

  const stornoInvoiceIds = new Set(
    currentReceivedInvoices
      .filter(inv => inv.storno_for_invoice_id)
      .map(inv => inv.storno_for_invoice_id)
  );

  const headers = [
    { label: 'Furnizor', key: 'supplier' },
    { label: 'Serie/Număr', key: 'number' },
    { label: 'Data', key: 'document_date' },
    { label: 'Scadență', key: 'due_date' },
    { label: 'Total', key: 'total', align: 'right' },
    { label: 'Plătit', key: 'paid', align: 'right' },
    { label: 'Sold', key: 'balance', align: 'right' },
    { label: 'Categorie', key: 'category' },
    { label: 'Stare', key: 'status' },
    { label: 'Acțiuni', key: 'actions' }
  ];

  const rows = currentReceivedInvoices.map(inv => {
    const supplierName = inv.suppliers ? inv.suppliers.legal_name : '-';
    const isStorno = ['STORNO', 'CORRECTION'].includes(inv.invoice_type);
    const isOriginalStorned = stornoInvoiceIds.has(inv.id);

    let statusBadge = renderStatusBadge(inv.document_status) + ' ' + renderStatusBadge(inv.payment_status);
    if (isStorno) {
      statusBadge = `<span class="badge badge-warning">${escapeHtml(inv.invoice_type === 'STORNO' ? 'Storno' : 'Corecție')}</span> ` + statusBadge;
    }
    if (isOriginalStorned && !isStorno) {
      statusBadge = `<span class="badge badge-danger">Stornat</span> ` + statusBadge;
    }

    const canEdit = inv.document_status === 'DRAFT';
    const canDelete = inv.document_status === 'DRAFT';
    const canConfirm = inv.document_status !== 'CONFIRMED' && inv.document_status !== 'CANCELLED' && !isStorno;
    // Corect: orice factură confirmată, ne-storno, cu sold pozitiv poate fi plătită
    const canPay = inv.document_status === 'CONFIRMED' && parseFloat(inv.balance_due) > 0 && !isStorno;
    const canStorno = inv.document_status === 'CONFIRMED' && inv.invoice_type === 'NORMAL' && !stornoInvoiceIds.has(inv.id);

    const categoryLabel = {
      'BUNURI': 'Bunuri',
      'SERVICII': 'Servicii',
      'TRANSPORT': 'Transport & Deplasări',
      'TAXE': 'Taxe & Comisioane',
      'ALTELE': 'Altele'
    }[inv.category] || inv.category;

    const actions = `
      <div class="flex gap-1">
        <button class="btn btn-sm btn-outline" data-action="view" data-id="${inv.id}" title="Vezi detalii factură primită">Vezi</button>
        ${canEdit ? `<button class="btn btn-sm btn-outline" data-action="edit" data-id="${inv.id}" title="Editează factură primită">Editează</button>` : ''}
        ${canDelete ? `<button class="btn btn-sm btn-danger" data-action="delete" data-id="${inv.id}" title="Șterge draft">Șterge</button>` : ''}
        ${canConfirm ? `<button class="btn btn-sm btn-primary" data-action="confirm" data-id="${inv.id}" title="Confirmă factura">Confirmă</button>` : ''}
        ${canPay ? `<button class="btn btn-sm btn-success" data-action="payment" data-id="${inv.id}" title="Înregistrează plata">Înregistrează plată</button>` : ''}
        ${canStorno ? `<button class="btn btn-sm btn-outline" data-action="storno" data-id="${inv.id}" title="Înregistrează storno">Storno</button>` : ''}
        <button class="btn btn-sm btn-outline" data-action="documents" data-id="${inv.id}" title="Atașează documente">Documente</button>
      </div>
    `;
    return {
      supplier: supplierName,
      number: inv.series ? `${inv.series}-${inv.number}` : inv.number,
      document_date: formatDate(inv.document_date),
      due_date: inv.due_date ? formatDate(inv.due_date) : '-',
      total: formatCurrency(inv.total, inv.currency),
      paid: formatCurrency(inv.paid_total, inv.currency),
      balance: formatCurrency(inv.balance_due, inv.currency),
      category: categoryLabel,
      status: statusBadge,
      actions
    };
  });

  container.innerHTML = `<div class="list-summary"><span><strong>${currentReceivedInvoices.length}</strong> ${currentReceivedInvoices.length === 1 ? 'factură găsită' : 'facturi găsite'}</span></div>` + renderTable(headers, rows, { emptyMessage: 'Nu există facturi primite', rawColumns: ['status', 'actions'] });

  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      const invoice = currentReceivedInvoices.find(i => i.id === id);
      if (!invoice) return;

      if (action === 'view') {
        openReceivedInvoiceDetail(invoice.id);
      } else if (action === 'edit') {
        openReceivedInvoiceModal(invoice);
      } else if (action === 'delete') {
        if (invoice.document_status === 'DRAFT') {
          const ok = await confirmDialog('Sigur dorești să ștergi acest draft?', { danger: true });
          if (ok) {
            try {
              await receivedInvoicesApi.removeDraft(invoice.id);
              showToast('Ciornă ștearsă', 'success');
              await loadReceivedInvoices();
            } catch (error) {
              showToast(error.message, 'error');
            }
          }
        }
      } else if (action === 'confirm') {
        const confirmed = await confirmDialog('Confirmi această factură primită? După confirmare, nu mai poate fi editată.');
        if (confirmed) {
          try {
            await receivedInvoicesApi.confirm(id);
            showToast('Factură confirmată', 'success');
            await loadReceivedInvoices();
          } catch (error) {
            showToast(error.message, 'error');
          }
        }
      } else if (action === 'payment') {
        openPaymentModal(invoice);
      } else if (action === 'storno') {
        openReceivedInvoiceStornoModal(invoice);
      } else if (action === 'documents') {
        openDocumentsModal(invoice.id);
      }
    });
  });
}

// ------------------ MODAL STORNO FACTURĂ PRIMITĂ ------------------
async function openReceivedInvoiceStornoModal(originalInvoice) {
  if (originalInvoice.document_status !== 'CONFIRMED' || originalInvoice.invoice_type !== 'NORMAL') {
    showToast('Doar facturile normale confirmate pot fi stornate.', 'error');
    return;
  }

  const fullInvoice = await receivedInvoicesApi.get(originalInvoice.id);
  if (!fullInvoice) return;

  const supplierName = fullInvoice.suppliers ? fullInvoice.suppliers.legal_name : '-';

  const content = `
    <div class="alert alert-info">
      Înregistrezi un storno pentru factura <strong>${escapeHtml(originalInvoice.series)}-${escapeHtml(originalInvoice.number)}</strong> de la ${escapeHtml(supplierName)}.
      Documentul va avea valori negative și va fi legat de factura originală.
      Factura originală va fi marcată automat ca anulată (CANCELLED).
    </div>
    <form id="storno-form">
      <div class="form-row">
        <div class="form-group">
          <label>Furnizor *</label>
          <input type="text" value="${escapeHtml(supplierName)}" disabled>
          <input type="hidden" name="supplier_id" value="${fullInvoice.supplier_id}">
        </div>
        <div class="form-group">
          <label>Serie storno</label>
          <input type="text" name="series" value="${escapeHtml(originalInvoice.series || '')}">
        </div>
        <div class="form-group">
          <label>Număr storno *</label>
          <input type="text" name="number" required placeholder="Ex: 101">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Data document *</label>
          <input type="date" name="document_date" required value="${toInputDate(new Date())}">
        </div>
        <div class="form-group">
          <label>Data scadenței</label>
          <input type="date" name="due_date" value="${toInputDate(new Date())}">
        </div>
      </div>
      <div class="alert alert-info">
        Stornarea se va face automat cu valori negative, fără a modifica liniile manual.
      </div>
      <div class="flex gap-1 mt-2">
        <button type="submit" class="btn btn-primary">Înregistrează storno</button>
        <button type="button" class="btn btn-outline" id="storno-cancel">Anulează</button>
      </div>
    </form>
  `;

  const { modalElement, close } = createModal({ title: 'Înregistrează storno factură primită', content, closeOnOverlayClick: false });

  modalElement.querySelector('#storno-cancel').addEventListener('click', close);
  modalElement.querySelector('#storno-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = modalElement.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Se procesează...';
    }

    const form = e.target;
    const formData = new FormData(form);
    const series = formData.get('series') || '';
    const number = formData.get('number');
    const date = formData.get('document_date');

    try {
      await receivedInvoicesApi.createStornoRpc(originalInvoice.id, series, number, date);
      showToast('Storno înregistrat', 'success');
      close();
      await loadReceivedInvoices();
    } catch (error) {
      showToast(error.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Înregistrează storno';
      }
    }
  });
}

// ------------------ MODAL CREARE/EDITARE FACTURĂ PRIMITĂ ------------------
async function openReceivedInvoiceModal(invoice = null) {
  const isEdit = !!invoice;
  const title = isEdit ? 'Editează factură primită' : 'Adaugă factură primită';

  const suppliersList = await suppliersApi.list({ active: true });
  if (!suppliersList || suppliersList.length === 0) {
    showToast('Adaugă mai întâi un furnizor în modulul Furnizori', 'warning');
    return;
  }

  let existingLines = [];
  if (isEdit) {
    const fullInvoice = await receivedInvoicesApi.get(invoice.id);
    if (fullInvoice && fullInvoice.received_invoice_lines) {
      existingLines = fullInvoice.received_invoice_lines.sort((a,b) => a.position - b.position);
    }
  }

  const supplierOptions = suppliersList.map(s => `<option value="${s.id}" ${invoice && invoice.supplier_id === s.id ? 'selected' : ''}>${escapeHtml(s.legal_name)}</option>`).join('');

  const content = `
    <form id="received-invoice-form">
      <div class="form-row">
        <div class="form-group">
          <label>Furnizor *</label>
          <select name="supplier_id" required>
            <option value="">Selectează furnizor</option>
            ${supplierOptions}
          </select>
        </div>
        <div class="form-group">
          <label>Serie</label>
          <input type="text" name="series" value="${invoice ? escapeHtml(invoice.series || '') : ''}" placeholder="Ex: FCT">
        </div>
        <div class="form-group">
          <label>Număr *</label>
          <input type="text" name="number" required value="${invoice ? escapeHtml(invoice.number || '') : ''}" placeholder="Ex: 123">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Data document *</label>
          <input type="date" name="document_date" required value="${invoice ? toInputDate(invoice.document_date) : toInputDate(new Date())}">
        </div>
        <div class="form-group">
          <label>Data scadenței</label>
          <input type="date" name="due_date" value="${invoice && invoice.due_date ? toInputDate(invoice.due_date) : toInputDate(new Date(Date.now() + 14*24*60*60*1000))}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Monedă</label>
          <select name="currency">
            <option value="RON" ${invoice && invoice.currency === 'RON' ? 'selected' : ''}>RON</option>
            <option value="EUR" ${invoice && invoice.currency === 'EUR' ? 'selected' : ''}>EUR</option>
            <option value="USD" ${invoice && invoice.currency === 'USD' ? 'selected' : ''}>USD</option>
          </select>
        </div>
        <div class="form-group">
          <label>Categorie</label>
          <select name="category">
            <option value="BUNURI" ${invoice && invoice.category === 'BUNURI' ? 'selected' : ''}>Bunuri</option>
            <option value="SERVICII" ${invoice && invoice.category === 'SERVICII' ? 'selected' : ''}>Servicii</option>
            <option value="TRANSPORT" ${invoice && invoice.category === 'TRANSPORT' ? 'selected' : ''}>Transport & Deplasări</option>
            <option value="TAXE" ${invoice && invoice.category === 'TAXE' ? 'selected' : ''}>Taxe & Comisioane</option>
            <option value="ALTELE" ${invoice && invoice.category === 'ALTELE' ? 'selected' : ''}>Altele</option>
          </select>
        </div>
        <div class="form-group">
          <label>Deductibilitate</label>
          <select name="deductible_status">
            <option value="NEEDS_VERIFICATION" ${invoice && invoice.deductible_status === 'NEEDS_VERIFICATION' ? 'selected' : ''}>Necesită verificare</option>
            <option value="DEDUCTIBLE" ${invoice && invoice.deductible_status === 'DEDUCTIBLE' ? 'selected' : ''}>Deductibil</option>
            <option value="PARTIALLY_DEDUCTIBLE" ${invoice && invoice.deductible_status === 'PARTIALLY_DEDUCTIBLE' ? 'selected' : ''}>Parțial deductibil</option>
            <option value="NON_DEDUCTIBLE" ${invoice && invoice.deductible_status === 'NON_DEDUCTIBLE' ? 'selected' : ''}>Nedeductibil</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Procent deductibilitate (%)</label>
          <input type="number" step="0.01" min="0" max="100" name="deductibility_percent"
                 value="${invoice ? (invoice.deductibility_percent ?? '') : ''}">
        </div>
        <div class="form-group">
          <label>Limită deductibilitate (lei)</label>
          <input type="number" step="0.01" min="0" name="deductibility_limit"
                 value="${invoice ? (invoice.deductibility_limit ?? '') : ''}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Curs BNR document (pentru valută)</label><input type="number" min="0.000001" step="0.000001" name="document_exchange_rate" value="${invoice?.document_exchange_rate || ''}"></div>
        <div class="form-group"><label>Data cursului documentului</label><input type="date" name="document_exchange_rate_date" value="${invoice?.document_exchange_rate_date || ''}"></div>
        <div class="form-group"><label>Sursa cursului</label><input name="document_exchange_rate_source" value="${escapeHtml(invoice?.document_exchange_rate_source || 'BNR')}"></div>
      </div>
      <div class="form-group">
        <label>Note</label>
        <textarea name="notes">${invoice ? escapeHtml(invoice.notes || '') : ''}</textarea>
      </div>
      <hr>
      <h4>Linii factură primită</h4>
      <div id="received-invoice-lines-container"></div>
      <button type="button" class="btn btn-sm btn-outline" id="add-received-invoice-line">+ Adaugă linie</button>
      <div class="flex-between mt-2">
        <div class="flex gap-1">
          <button type="submit" class="btn btn-primary">${isEdit ? 'Salvează' : 'Adaugă'}</button>
          <button type="button" class="btn btn-outline" id="received-invoice-cancel">Anulează</button>
        </div>
        <div class="text-right">
          <strong>Total: <span id="received-invoice-total-display">0.00</span></strong>
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
    const container = modalElement.querySelector('#received-invoice-lines-container');
    const lineHtml = `
      <div class="form-row received-invoice-line">
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
        <div class="form-group" style="flex: 1;">
          <label>Tratament achiziție</label>
          <select name="line_treatment[]">
            <option value="cheltuiala_curenta" ${lineData.treatment === 'cheltuiala_curenta' ? 'selected' : ''}>Cheltuială curentă</option>
            <option value="stoc" ${lineData.treatment === 'stoc' ? 'selected' : ''}>Stoc/marfă</option>
            <option value="material" ${lineData.treatment === 'material' ? 'selected' : ''}>Material</option>
            <option value="obiect_inventar" ${lineData.treatment === 'obiect_inventar' ? 'selected' : ''}>Obiect de inventar</option>
            <option value="mijloc_fix" ${lineData.treatment === 'mijloc_fix' ? 'selected' : ''}>Mijloc fix</option>
            <option value="investitie" ${lineData.treatment === 'investitie' ? 'selected' : ''}>Investiție/modernizare</option>
            <option value="alta" ${lineData.treatment === 'alta' ? 'selected' : ''}>Altă categorie</option>
          </select>
        </div>
        <div class="form-group" style="flex: 0.4; display: flex; align-items: flex-end;">
          <button type="button" class="btn btn-sm btn-danger remove-received-invoice-line" style="margin-bottom: 8px;">×</button>
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

  modalElement.querySelector('#add-received-invoice-line').addEventListener('click', () => addLine());

  modalElement.querySelector('#received-invoice-lines-container').addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-received-invoice-line')) {
      const lineDiv = e.target.closest('.received-invoice-line');
      if (lineDiv) {
        lineDiv.remove();
        recalcTotal();
        markDirty();
      }
    }
  });

  modalElement.addEventListener('input', (e) => {
    if (e.target.matches('input[name^="line_"], input[name="supplier_id"], input[name="series"], input[name="number"], input[name="document_date"], input[name="due_date"], input[name="currency"], select[name="category"], select[name="deductible_status"], textarea[name="notes"], input[name="deductibility_percent"], input[name="deductibility_limit"]')) {
      recalcTotal();
      markDirty();
    }
  });

  function recalcTotal() {
    const lineDivs = modalElement.querySelectorAll('.received-invoice-line');
    const lines = [...lineDivs].map(lineDiv => ({
      quantity: lineDiv.querySelector('[name="line_quantity[]"]').value,
      unit_price: lineDiv.querySelector('[name="line_unit_price[]"]').value,
      discount: lineDiv.querySelector('[name="line_discount[]"]').value,
      vat_rate: lineDiv.querySelector('[name="line_vat_rate[]"]').value
    }));
    const { total } = calculateInvoiceTotals(lines);
    const display = modalElement.querySelector('#received-invoice-total-display');
    if (display) display.textContent = total.toFixed(2);
  }

  modalElement.querySelector('#received-invoice-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = modalElement.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Se salvează...';
    }

    const form = e.target;
    const formData = new FormData(form);

    const lineDivs = modalElement.querySelectorAll('.received-invoice-line');
    const lines = [];
    for (const lineDiv of lineDivs) {
      const description = lineDiv.querySelector('[name="line_description[]"]').value.trim();
      const quantity = parseFloat(lineDiv.querySelector('[name="line_quantity[]"]').value) || 0;
      const unit = lineDiv.querySelector('[name="line_unit[]"]').value || 'buc';
      const unit_price = parseFloat(lineDiv.querySelector('[name="line_unit_price[]"]').value) || 0;
      const discount = parseFloat(lineDiv.querySelector('[name="line_discount[]"]').value) || 0;
      const vat_rate = parseFloat(lineDiv.querySelector('[name="line_vat_rate[]"]').value) || 0;
      const vat_category = vat_rate > 0 ? 'STANDARD' : 'NONE';
      const treatment = lineDiv.querySelector('[name="line_treatment[]"]').value;
      const { net_amount, vat_amount, total_amount } = calculateLineTotals({
        quantity, unit_price, discount, vat_rate
      });

      if (!description || quantity <= 0) continue;

      lines.push({ description, quantity, unit, unit_price, discount, vat_rate, vat_category, net_amount, vat_amount, total_amount, treatment });
    }

    if (lines.length === 0) {
      showToast('Adaugă cel puțin o linie', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isEdit ? 'Salvează' : 'Adaugă';
      }
      return;
    }

    const data = {
      id: invoice ? invoice.id : null,
      supplier_id: formData.get('supplier_id'),
      series: formData.get('series') || '',
      number: formData.get('number'),
      document_date: formData.get('document_date'),
      due_date: formData.get('due_date') || null,
      currency: formData.get('currency'),
      category: formData.get('category'),
      deductible_status: formData.get('deductible_status'),
      notes: formData.get('notes') || null,
      deductibility_percent: formData.get('deductibility_percent') || null,
      deductibility_limit: formData.get('deductibility_limit') || null
      ,document_exchange_rate: formData.get('document_exchange_rate') || null
      ,document_exchange_rate_date: formData.get('document_exchange_rate_date') || null
      ,document_exchange_rate_source: formData.get('document_exchange_rate_source') || null
    };

    if (data.currency !== 'RON' && (!data.document_exchange_rate || !data.document_exchange_rate_date)) {
      showToast('Pentru factura în valută completează cursul BNR al documentului și data sa.', 'error');
      if (submitBtn) submitBtn.disabled = false;
      return;
    }

    try {
      await receivedInvoicesApi.saveDraft(data, lines);
      isDirty = false;
      showToast(isEdit ? 'Factură primită actualizată' : 'Factură primită adăugată', 'success');
      close();
      await loadReceivedInvoices();
    } catch (error) {
      showToast(error.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isEdit ? 'Salvează' : 'Adaugă';
      }
    }
  });

  modalElement.querySelector('#received-invoice-cancel').addEventListener('click', () => close());

  recalcTotal();
}

// ------------------ MODAL VIZUALIZARE DETALIU ------------------
async function openReceivedInvoiceDetail(invoiceId) {
  try {
    const invoice = await receivedInvoicesApi.get(invoiceId);
    if (!invoice) return;

    const lines = invoice.received_invoice_lines || [];
    const supplierName = invoice.suppliers ? invoice.suppliers.legal_name : '-';

    const supabase = await getSupabase();
    const { data: fixedAssets, error: faError } = await supabase
      .from('fixed_assets')
      .select('id, name, source_invoice_line_id, inventory_number, status')
      .eq('source_invoice_id', invoice.id);

    if (faError) throw faError;

    const categoryLabel = {
      'BUNURI': 'Bunuri',
      'SERVICII': 'Servicii',
      'TRANSPORT': 'Transport & Deplasări',
      'TAXE': 'Taxe & Comisioane',
      'ALTELE': 'Altele'
    }[invoice.category] || invoice.category;

    const content = `
      <div class="mb-2">
        <strong>Factura primită:</strong> ${invoice.series ? `${invoice.series}-${invoice.number}` : invoice.number} 
        ${invoice.invoice_type && invoice.invoice_type !== 'NORMAL' ? `<span class="badge badge-warning">${escapeHtml(invoice.invoice_type === 'STORNO' ? 'Storno' : 'Corecție')}</span>` : ''}
        (${renderStatusBadge(invoice.document_status)} ${renderStatusBadge(invoice.payment_status)})
      </div>
      <div class="grid mb-2">
        <div><strong>Furnizor:</strong> ${escapeHtml(supplierName)}</div>
        <div><strong>Data:</strong> ${formatDate(invoice.document_date)}</div>
        <div><strong>Scadență:</strong> ${invoice.due_date ? formatDate(invoice.due_date) : '-'}</div>
        <div><strong>Total:</strong> ${formatCurrency(invoice.total, invoice.currency)}</div>
        <div><strong>Plătit:</strong> ${formatCurrency(invoice.paid_total, invoice.currency)}</div>
        <div><strong>Sold:</strong> ${formatCurrency(invoice.balance_due, invoice.currency)}</div>
        <div><strong>Categorie:</strong> ${escapeHtml(categoryLabel)}</div>
        <div><strong>Deductibilitate:</strong> ${renderStatusBadge(invoice.deductible_status)}</div>
        <div><strong>Procent deductibilitate:</strong> ${formatDeductibilityPercent(invoice.deductibility_percent)}</div>
        <div><strong>Limită deductibilitate:</strong> ${formatDeductibilityLimit(invoice.deductibility_limit)}</div>
      </div>
      <h4>Linii</h4>
      <div class="table-container">
        <table>
          <thead><tr><th>Descriere</th><th>Cant.</th><th>Preț</th><th>TVA</th><th>Total</th><th>Tratament</th><th>Mijloc fix</th><th>Acțiuni</th></tr></thead>
          <tbody>
            ${lines.map(line => {
              const matchingAsset = fixedAssets.find(fa => fa.source_invoice_line_id === line.id);
              const treatmentLabel = {
                'cheltuiala_curenta': 'Cheltuială curentă',
                'stoc': 'Stoc/marfă',
                'material': 'Material',
                'obiect_inventar': 'Obiect de inventar',
                'mijloc_fix': 'Mijloc fix',
                'investitie': 'Investiție/modernizare',
                'alta': 'Altă categorie'
              }[line.treatment] || line.treatment;

              const assetInfo = matchingAsset 
                ? `${escapeHtml(matchingAsset.name)} (${matchingAsset.inventory_number || 'fără nr.'})` 
                : '-';

              const actionButton = (line.treatment === 'mijloc_fix' && !matchingAsset)
                ? `<button class="btn btn-sm btn-primary" data-action="create-fixed-asset" data-line-id="${line.id}" title="Creează mijloc fix din această linie">Creează mijloc fix</button>`
                : '';

              return `
                <tr>
                  <td>${escapeHtml(line.description)}</td>
                  <td>${line.quantity} ${escapeHtml(line.unit || '')}</td>
                  <td>${formatCurrency(line.unit_price, invoice.currency)}</td>
                  <td>${formatCurrency(line.vat_amount, invoice.currency)}</td>
                  <td>${formatCurrency(line.total_amount, invoice.currency)}</td>
                  <td>${escapeHtml(treatmentLabel)}</td>
                  <td>${assetInfo}</td>
                  <td>${actionButton}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div class="flex gap-1 mt-2">
        ${invoice.document_status === 'CONFIRMED' && parseFloat(invoice.balance_due) > 0 && !['STORNO','CORRECTION'].includes(invoice.invoice_type) ? `<button class="btn btn-sm btn-success" data-action="payment-from-detail" data-id="${invoice.id}" title="Înregistrează plata">Înregistrează plată</button>` : ''}
        <button class="btn btn-sm btn-outline" id="detail-close">Închide</button>
      </div>
    `;

    const { modalElement, close } = createModal({ title: 'Detalii factură primită', content, size: 'lg' });
    modalElement.querySelector('#detail-close').addEventListener('click', close);

    const payBtn = modalElement.querySelector('[data-action="payment-from-detail"]');
    if (payBtn) {
      payBtn.addEventListener('click', () => {
        close();
        openPaymentModal(invoice);
      });
    }

    modalElement.querySelectorAll('[data-action="create-fixed-asset"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const lineId = btn.getAttribute('data-line-id');
        const line = lines.find(l => l.id === lineId);
        if (line) {
          close();
          openFixedAssetModalFromLine(invoice, line);
        }
      });
    });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ------------------ MODAL CREARE MIJLOC FIX DIN LINIE ------------------
async function openFixedAssetModalFromLine(invoice, line) {
  const content = `
    <form id="fixed-asset-from-line-form">
      <div class="form-group">
        <label>Denumire mijloc fix *</label>
        <input type="text" name="name" required value="${escapeHtml(line.description)}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Categorie</label>
          <input type="text" name="asset_category" placeholder="Ex: IT">
        </div>
        <div class="form-group">
          <label>Cod clasificare</label>
          <input type="text" name="classification_code" placeholder="Ex: 2.1.1">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Număr de serie</label>
          <input type="text" name="serial_number">
        </div>
        <div class="form-group">
          <label>Data intrării</label>
          <input type="date" name="entry_date" value="${toInputDate(new Date())}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Data punerii în funcțiune</label>
          <input type="date" name="commissioning_date">
        </div>
        <div class="form-group">
          <label>Durata de viață (luni)</label>
          <input type="number" min="1" name="useful_life" placeholder="Ex: 36">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Metoda de amortizare</label>
          <select name="depreciation_method">
            <option value="LINEAR">Liniară</option>
            <option value="DEGRESSIVE">Degresivă</option>
            <option value="NONE">Fără amortizare</option>
          </select>
        </div>
        <div class="form-group">
          <label>Data începerii amortizării</label>
          <input type="date" name="depreciation_start_date">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Locație</label>
          <input type="text" name="location">
        </div>
        <div class="form-group">
          <label>Responsabil</label>
          <input type="text" name="responsible_person">
        </div>
      </div>
      <div class="form-group">
        <label>Note</label>
        <textarea name="notes"></textarea>
      </div>
      <div class="alert alert-info">
        Valoare de intrare: <strong>${formatCurrency(line.net_amount, invoice.currency)}</strong> (fără TVA)
      </div>
      <div class="flex gap-1 mt-2">
        <button type="submit" class="btn btn-primary">Creează mijloc fix</button>
        <button type="button" class="btn btn-outline" id="fixed-asset-cancel">Anulează</button>
      </div>
    </form>
  `;

  const { modalElement, close } = createModal({ title: 'Creează mijloc fix din factură', content, size: 'lg', closeOnOverlayClick: false });
  modalElement.querySelector('#fixed-asset-cancel').addEventListener('click', close);

  modalElement.querySelector('#fixed-asset-from-line-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = modalElement.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Se creează...';
    }

    const form = e.target;
    const formData = new FormData(form);

    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc('create_fixed_asset_from_invoice_line', {
      p_received_invoice_line_id: line.id,
      p_name: formData.get('name'),
      p_asset_category: formData.get('asset_category') || null,
      p_classification_code: formData.get('classification_code') || null,
      p_serial_number: formData.get('serial_number') || null,
      p_entry_date: formData.get('entry_date') || null,
      p_commissioning_date: formData.get('commissioning_date') || null,
      p_depreciation_method: formData.get('depreciation_method'),
      p_useful_life_months: formData.get('useful_life') ? parseInt(formData.get('useful_life')) : null,
      p_depreciation_start_date: formData.get('depreciation_start_date') || null,
      p_location: formData.get('location') || null,
      p_responsible_person: formData.get('responsible_person') || null,
      p_notes: formData.get('notes') || null
    });

    if (error) {
      showToast(error.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Creează mijloc fix';
      }
      return;
    }

    showToast('Mijloc fix creat cu succes', 'success');
    close();
    await loadReceivedInvoices();
  });
}

// ------------------ MODAL ÎNREGISTRARE PLATĂ ------------------
async function openPaymentModal(invoice) {
  if (!invoice || invoice.document_status !== 'CONFIRMED' || parseFloat(invoice.balance_due) <= 0 || ['STORNO','CORRECTION'].includes(invoice.invoice_type)) {
    showToast('Factura nu este eligibilă pentru plată', 'error');
    return;
  }

  const content = `
    <form id="payment-form">
      <div class="form-group">
        <label>Suma de plătit * (max: ${invoice.balance_due})</label>
        <input type="number" step="0.01" min="0.01" max="${invoice.balance_due}" name="amount" value="${invoice.balance_due}" required>
      </div>
      <div class="form-group">
        <label>Data plății *</label>
        <input type="date" name="date" value="${toInputDate(new Date())}" required>
      </div>
      <div class="form-group">
        <label>Metodă plată</label>
        <select name="payment_method">
          <option value="BANK">Bancă</option>
          <option value="CASH">Numerar</option>
          <option value="CARD">Card</option>
          <option value="OTHER">Alta</option>
        </select>
      </div>
      ${fxFieldsHtml(invoice.currency)}
      <div class="form-group">
        <label>Note</label>
        <textarea name="notes" placeholder="Note despre plată"></textarea>
      </div>
      <div class="flex gap-1 mt-2">
        <button type="submit" class="btn btn-success">Înregistrează plata</button>
        <button type="button" class="btn btn-outline" id="payment-cancel">Anulează</button>
      </div>
    </form>
  `;

  const { modalElement, close } = createModal({ title: 'Înregistrează plată', content, closeOnOverlayClick: false });
  bindFxPreview(modalElement.querySelector('#payment-form'));
  modalElement.querySelector('#payment-cancel').addEventListener('click', close);
  modalElement.querySelector('#payment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = modalElement.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Se procesează...';
    }

    const form = e.target;
    const formData = new FormData(form);
    const amount = parseFloat(formData.get('amount'));
    const date = formData.get('date');
    const method = formData.get('payment_method');
    const notes = formData.get('notes') || null;

    try {
      await transactionsApi.registerPayment({
        receivedInvoiceId: invoice.id,
        amount,
        date,
        paymentMethod: method,
        bankAccountId: null,
        notes,
        ...readFxParams(formData, invoice.currency)
      });
      showToast('Plată înregistrată', 'success');
      close();
      await loadReceivedInvoices();
    } catch (error) {
      showToast(error.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Înregistrează plata';
      }
    }
  });
}

// ------------------ MODAL DOCUMENTE ------------------
async function openDocumentsModal(receivedInvoiceId) {
  try {
    const documents = await documentsApi.listForEntity('received_invoice_id', receivedInvoiceId);
    const content = `
      <div class="mb-2">
        <h4>Documente atașate</h4>
        ${documents.length === 0 ? '<p>Nu există documente atașate</p>' : `
          <ul>
            ${documents.map(doc => `<li>${escapeHtml(doc.original_filename)} (${(doc.file_size/1024).toFixed(2)} KB)</li>`).join('')}
          </ul>
        `}
      </div>
      <input type="file" id="doc-upload" accept=".pdf,.xml,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx">
      <button class="btn btn-primary btn-sm mt-1" id="upload-doc">Încarcă document</button>
    `;
    const { modalElement, close } = createModal({ title: 'Documente', content });
    modalElement.querySelector('#upload-doc').addEventListener('click', async () => {
      const fileInput = modalElement.querySelector('#doc-upload');
      if (!fileInput.files || fileInput.files.length === 0) {
        showToast('Selectează un fișier', 'warning');
        return;
      }
      const file = fileInput.files[0];
      try {
        await documentsApi.upload(file, {
          entityType: 'received_invoice_id',
          entityId: receivedInvoiceId,
          category: 'received-invoices'
        });
        showToast('Document încărcat', 'success');
        close();
        openDocumentsModal(receivedInvoiceId);
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  } catch (error) {
    showToast(error.message, 'error');
  }
}
