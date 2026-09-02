// js/modules/invoices.js
// Modul Facturi emise – listare, creare, editare, emitere, storno, încasare, export PDF/XML
// Folosește RPC-uri atomice pentru salvare draft, ștergere draft și storno.
// Blocare plată/storno dacă factura are deja un storno înregistrat.
// Modalurile cu câmpuri editabile folosesc beforeClose pentru confirmarea modificărilor nesalvate.
// Fix: corectat fluxul de închidere cu confirmDialog fără conflict de modaluri.

import { invoicesApi, clientsApi, invoiceSeriesApi, transactionsApi, settingsApi, bankAccountsApi } from '../api.js';
import { calculateInvoiceTotals, calculateLineTotals, formatCurrency, formatDate, toInputDate, showToast, escapeHtml } from '../utils.js';
import { createModal, renderStatusBadge, confirmDialog, renderTable, renderSkeleton, renderEmptyState, renderError } from '../ui.js';
import { previewInvoice } from '../services/pdf-service.js';
import { EFACTURA_EXPORT_VALIDATED, generateEfacturaXml, downloadXml } from '../services/xml-service.js';
import { bindBnrRateAutofill, bindFxPreview, fxFieldsHtml, readFxParams } from '../services/fx-accounting.js';

let currentInvoices = [];
let currentPage = 1;
let pageSize = 20;
let totalCount = 0;
let filters = {
  status: 'all',
  paymentStatus: 'all',
  search: ''
};

let stornoInvoiceIds = new Set();

async function getEfacturaSettings() {
  const [settings, bankAccounts] = await Promise.all([
    settingsApi.getSettings(),
    bankAccountsApi.list()
  ]);
  const accounts = bankAccounts || [];
  const bankAccount = accounts.find(account => account.id === settings?.default_bank_account_id)
    || accounts.find(account => account.is_default)
    || accounts[0]
    || null;
  return { ...(settings || {}), bank_account: bankAccount };
}

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-heading">
        <h2>Facturi emise</h2>
        <p>Creează facturi, urmărește încasările și gestionează documentele emise clienților.</p>
      </div>
      <button class="btn btn-primary" id="create-invoice" title="Creează o factură nouă">＋ Factură nouă</button>
    </div>
    <div class="card filter-card">
      <div class="filter-card-heading"><div><span class="card-eyebrow">Găsește rapid</span><h3>Caută și filtrează</h3></div><button class="btn-link clear-filters" id="invoice-reset-filters" type="button">Resetează filtrele</button></div>
      <div class="filters-row">
        <div class="form-group">
          <label for="invoice-search">Serie sau număr</label>
          <input type="search" id="invoice-search" placeholder="Ex: FCT-104" value="${escapeHtml(filters.search)}">
        </div>
        <div class="form-group">
          <label for="invoice-filter-status">Starea documentului</label>
          <select id="invoice-filter-status">
            <option value="all" ${filters.status === 'all' ? 'selected' : ''}>Toate statusurile</option>
            <option value="DRAFT" ${filters.status === 'DRAFT' ? 'selected' : ''}>Ciornă</option>
            <option value="ISSUED" ${filters.status === 'ISSUED' ? 'selected' : ''}>Emisă</option>
            <option value="CORRECTED" ${filters.status === 'CORRECTED' ? 'selected' : ''}>Corectată</option>
            <option value="STORNED" ${filters.status === 'STORNED' ? 'selected' : ''}>Stornată</option>
          </select>
        </div>
        <div class="form-group">
          <label for="invoice-filter-payment">Starea încasării</label>
          <select id="invoice-filter-payment">
            <option value="all" ${filters.paymentStatus === 'all' ? 'selected' : ''}>Toate plățile</option>
            <option value="UNPAID" ${filters.paymentStatus === 'UNPAID' ? 'selected' : ''}>Neachitată</option>
            <option value="PARTIALLY_PAID" ${filters.paymentStatus === 'PARTIALLY_PAID' ? 'selected' : ''}>Parțial</option>
            <option value="PAID" ${filters.paymentStatus === 'PAID' ? 'selected' : ''}>Achitată</option>
          </select>
        </div>
        <div class="form-group">
          <label class="filter-action-label" aria-hidden="true">Aplică</label>
          <button class="btn btn-outline" id="invoice-search-btn" title="Aplică filtrele">Caută facturi</button>
        </div>
      </div>
    </div>
    <div id="invoices-list"></div>
  `;

  document.getElementById('create-invoice').addEventListener('click', () => openInvoiceModal());
  document.getElementById('invoice-reset-filters').addEventListener('click', () => {
    filters = { status: 'all', paymentStatus: 'all', search: '' };
    currentPage = 1;
    render(container);
  });
  document.getElementById('invoice-search-btn').addEventListener('click', () => {
    filters.search = document.getElementById('invoice-search').value.trim();
    filters.status = document.getElementById('invoice-filter-status').value;
    filters.paymentStatus = document.getElementById('invoice-filter-payment').value;
    currentPage = 1;
    loadInvoices();
  });
  document.getElementById('invoice-search').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      filters.search = e.target.value.trim();
      filters.status = document.getElementById('invoice-filter-status').value;
      filters.paymentStatus = document.getElementById('invoice-filter-payment').value;
      currentPage = 1;
      loadInvoices();
    }
  });

  await loadInvoices();
}

export function destroy() {}

async function loadInvoices() {
  const listContainer = document.getElementById('invoices-list');
  if (!listContainer) return;
  listContainer.innerHTML = renderSkeleton(5);

  try {
    const result = await invoicesApi.list({
      ...filters,
      page: currentPage,
      pageSize
    });
    currentInvoices = result.data;
    totalCount = result.count;

    const stornoLinks = await invoicesApi.getStornoLinks();
    stornoInvoiceIds = new Set(stornoLinks.map(link => link.storno_for_invoice_id));

    renderInvoicesList(listContainer);
  } catch (error) {
    console.error('loadInvoices error:', error);
    listContainer.innerHTML = renderError(error.message || 'Nu am putut încărca facturile');
  }
}

function renderInvoicesList(container) {
  if (!currentInvoices || currentInvoices.length === 0) {
    container.innerHTML = renderEmptyState(
      'Nu ai facturi emise în această listă.',
      'Creează prima factură',
      () => openInvoiceModal()
    );
    return;
  }

  const headers = [
    { label: 'Serie/Număr', key: 'number' },
    { label: 'Client', key: 'client' },
    { label: 'Data', key: 'issue_date' },
    { label: 'Scadență', key: 'due_date' },
    { label: 'Total', key: 'total', align: 'right' },
    { label: 'Plătit', key: 'paid', align: 'right' },
    { label: 'Sold', key: 'balance', align: 'right' },
    { label: 'Stare', key: 'status' },
    { label: 'Acțiuni', key: 'actions' }
  ];

  const rows = currentInvoices.map(inv => {
    const clientName = inv.clients ? inv.clients.legal_name : '-';
    const isStorno = inv.invoice_type === 'STORNO' || inv.invoice_type === 'CORRECTION';
    const hasStorno = stornoInvoiceIds.has(inv.id);

    let statusBadge = renderStatusBadge(inv.document_status) + ' ' + renderStatusBadge(inv.payment_status);
    if (hasStorno && !isStorno) {
      statusBadge = `<span class="badge badge-danger">Stornat</span> ` + statusBadge;
    }

    const canReceive = inv.document_status === 'ISSUED' && parseFloat(inv.balance_due) > 0 && !isStorno && !hasStorno;
    const canStorno = inv.document_status === 'ISSUED' && !isStorno && !hasStorno;
    const canEdit = inv.document_status === 'DRAFT';
    const canDelete = inv.document_status === 'DRAFT';

    const actions = `
      <div class="flex gap-1">
        <button class="btn btn-sm btn-outline" data-action="view" data-id="${inv.id}" title="Vezi detalii factură">Vezi</button>
        <button class="btn btn-sm btn-outline" data-action="pdf" data-id="${inv.id}" title="Previzualizează și tipărește">Previzualizare</button>
        ${EFACTURA_EXPORT_VALIDATED && inv.document_status !== 'DRAFT'
          ? `<button class="btn btn-sm btn-outline" data-action="xml" data-id="${inv.id}" title="Descarcă XML e-Factura">XML</button>`
          : '<button class="btn btn-sm btn-outline" disabled title="Export indisponibil până la validarea CIUS-RO/ANAF">XML indisponibil</button>'}
        ${canEdit ? `<button class="btn btn-sm btn-outline" data-action="edit" data-id="${inv.id}" title="Editează draft">Editează</button>
        <button class="btn btn-sm btn-danger" data-action="delete" data-id="${inv.id}" title="Șterge draft">Șterge</button>
        <button class="btn btn-sm btn-primary" data-action="issue" data-id="${inv.id}" title="Emite factura">Emite</button>` : ''}
        ${canReceive ? `<button class="btn btn-sm btn-success" data-action="receipt" data-id="${inv.id}" title="Înregistrează încasare">Încasează</button>` : ''}
        ${canStorno ? `<button class="btn btn-sm btn-outline" data-action="storno" data-id="${inv.id}" title="Creează storno">Storno</button>` : ''}
        <button class="btn btn-sm btn-outline" data-action="history" data-id="${inv.id}" title="Istoric factură">Istoric</button>
      </div>
    `;
    return {
      number: inv.series ? `${inv.series}-${inv.number}` : 'Ciornă',
      client: clientName,
      issue_date: formatDate(inv.issue_date),
      due_date: formatDate(inv.due_date),
      total: formatCurrency(inv.total, inv.currency),
      paid: formatCurrency(inv.paid_total, inv.currency),
      balance: formatCurrency(inv.balance_due, inv.currency),
      status: statusBadge,
      actions
    };
  });

  container.innerHTML = `<div class="list-summary"><span><strong>${totalCount}</strong> ${totalCount === 1 ? 'factură găsită' : 'facturi găsite'}</span><span>Pagina ${currentPage}</span></div>` + renderTable(headers, rows, { emptyMessage: 'Nu există facturi', rawColumns: ['status', 'actions'] });

  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  if (totalPages > 1) {
    const paginationHtml = renderPaginationHtml(currentPage, totalPages);
    container.insertAdjacentHTML('beforeend', paginationHtml);
    container.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = parseInt(btn.getAttribute('data-page'));
        if (page >= 1 && page <= totalPages) {
          currentPage = page;
          loadInvoices();
        }
      });
    });
  }

  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      const invoice = currentInvoices.find(i => i.id === id);
      if (!invoice) return;

      try {
        if (action === 'view') {
          openInvoiceDetail(invoice.id);
        } else if (action === 'pdf') {
          const fullInvoice = await invoicesApi.get(invoice.id);
          const pfaSettings = await settingsApi.getSettings();
          previewInvoice(fullInvoice, pfaSettings || {});
        } else if (action === 'xml') {
          const fullInvoice = await invoicesApi.get(invoice.id);
          const pfaSettings = await getEfacturaSettings();
          const xmlString = generateEfacturaXml(fullInvoice, pfaSettings || {});
          downloadXml(xmlString, `factura_${fullInvoice.series || ''}${fullInvoice.number || ''}.xml`);
        } else if (action === 'edit') {
          openInvoiceModal(invoice);
        } else if (action === 'delete') {
          if (invoice.document_status === 'DRAFT') {
            const ok = await confirmDialog('Sigur dorești să ștergi acest draft?', { danger: true });
            if (ok) {
              await invoicesApi.removeDraft(id);
              showToast('Ciornă ștearsă', 'success');
              await loadInvoices();
            }
          }
        } else if (action === 'issue') {
          const confirmed = await confirmDialog('Factura va fi emisă oficial. După emitere nu mai poate fi modificată. Continui?', { danger: false });
          if (confirmed) {
            const result = await invoicesApi.issue(id);
            showToast(`Factura ${result.series}-${result.number} emisă`, 'success');
            await loadInvoices();
          }
        } else if (action === 'receipt') {
          if (stornoInvoiceIds.has(invoice.id)) {
            showToast('Factura a fost stornată și nu mai poate fi încasată.', 'warning');
            return;
          }
          openReceiptModal(invoice);
        } else if (action === 'storno') {
          if (stornoInvoiceIds.has(invoice.id)) {
            showToast('Această factură are deja un storno înregistrat.', 'warning');
            return;
          }
          const confirmed = await confirmDialog('Creezi un document storno pentru această factură? Factura originală rămâne nemodificată.', { danger: true });
          if (confirmed) {
            const result = await invoicesApi.createStorno(id, 'STORNO');
            showToast(`Storno creat: ${result.invoice_id}`, 'success');
            await loadInvoices();
          }
        } else if (action === 'history') {
          openInvoiceHistory(id);
        }
      } catch (error) {
        console.error('Acțiune factură eroare:', error);
        showToast(error.message, 'error');
      }
    });
  });
}

function renderPaginationHtml(currentPage, totalPages) {
  let html = '<div class="flex gap-1 mt-2">';
  html += `<button class="btn btn-sm btn-outline" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>« Înapoi</button>`;
  for (let i = 1; i <= totalPages; i++) {
    html += `<button class="btn btn-sm ${i === currentPage ? 'btn-primary' : 'btn-outline'}" data-page="${i}">${i}</button>`;
  }
  html += `<button class="btn btn-sm btn-outline" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>Înainte »</button>`;
  html += '</div>';
  return html;
}

// ------------------ MODAL CREARE/EDITARE FACTURĂ ------------------
async function openInvoiceModal(invoice = null) {
  const isEdit = !!invoice;
  const title = isEdit ? 'Editează factură draft' : 'Creează factură';

  const [clientsList, seriesList] = await Promise.all([
    clientsApi.list({ active: true }),
    invoiceSeriesApi.list()
  ]);

  if (!clientsList || clientsList.length === 0) {
    showToast('Adaugă mai întâi un client în modulul Clienți', 'warning');
    return;
  }

  const activeSeries = seriesList.filter(s => s.active);
  if (!isEdit && activeSeries.length === 0) {
    showToast('Adaugă o serie de facturare în Configurare', 'warning');
    return;
  }

  let activeSeriesInfo = null;
  try {
    activeSeriesInfo = await invoiceSeriesApi.getActiveSeriesAndNextNumber();
  } catch (e) {
    console.warn('Nu am putut obține seria activă:', e);
  }

  let existingLines = [];
  if (isEdit) {
    const fullInvoice = await invoicesApi.get(invoice.id);
    if (fullInvoice && fullInvoice.invoice_lines) {
      existingLines = fullInvoice.invoice_lines.sort((a,b) => a.position - b.position);
    }
  }

  const clientOptions = clientsList.map(c => `<option value="${c.id}" ${invoice && invoice.client_id === c.id ? 'selected' : ''}>${escapeHtml(c.legal_name)}</option>`).join('');

  const seriesInfoHtml = activeSeriesInfo && activeSeriesInfo.success
    ? `<div class="alert alert-info">Seria facturii: <strong>${escapeHtml(activeSeriesInfo.series)}</strong> | Anul: ${activeSeriesInfo.year} | Următorul număr: <strong>${activeSeriesInfo.next_number}</strong></div>`
    : '<div class="alert alert-warning">Seria activă va fi alocată automat la emitere.</div>';

  const content = `
    <form id="invoice-form">
      <div class="form-group">
        <label>Client *</label>
        <select name="client_id" required>
          <option value="">Selectează client</option>
          ${clientOptions}
        </select>
      </div>
      ${seriesInfoHtml}
      <div class="form-row">
        <div class="form-group">
          <label>Data emiterii *</label>
          <input type="date" name="issue_date" required value="${invoice ? toInputDate(invoice.issue_date) : toInputDate(new Date())}">
        </div>
        <div class="form-group">
          <label>Data scadenței *</label>
          <input type="date" name="due_date" required value="${invoice ? toInputDate(invoice.due_date) : toInputDate(new Date(Date.now() + 14*24*60*60*1000))}">
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
          <label>Termen plată (zile)</label>
          <input type="number" name="payment_terms" min="0" value="${invoice ? invoice.payment_terms : 14}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Curs BNR document (pentru valută)</label><input type="number" min="0.000001" step="0.000001" name="document_exchange_rate" value="${invoice?.document_exchange_rate || ''}"></div>
        <div class="form-group"><label>Data cursului documentului</label><input type="date" name="document_exchange_rate_date" value="${invoice?.document_exchange_rate_date || ''}"></div>
        <div class="form-group"><label>Sursa cursului</label><input name="document_exchange_rate_source" value="${escapeHtml(invoice?.document_exchange_rate_source || 'BNR')}"></div>
      </div>
      <div class="alert alert-info" data-document-bnr-status>Selectează EUR/USD și data emiterii pentru completarea automată.</div>
      <div class="form-group">
        <label>Note</label>
        <textarea name="notes">${invoice ? escapeHtml(invoice.notes || '') : ''}</textarea>
      </div>
      <hr>
      <h4>Linii factură</h4>
      <div id="invoice-lines-container"></div>
      <button type="button" class="btn btn-sm btn-outline" id="add-line">+ Adaugă linie</button>
      <div class="flex-between mt-2">
        <div class="flex gap-1">
          <button type="submit" class="btn btn-primary">${isEdit ? 'Salvează draft' : 'Creează draft'}</button>
          <button type="button" class="btn btn-outline" id="invoice-cancel">Anulează</button>
        </div>
        <div class="text-right">
          <strong>Total: <span id="invoice-total-display">0.00</span></strong>
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

  bindBnrRateAutofill(modalElement.querySelector('#invoice-form'), {
    dateName: 'issue_date',
    rateName: 'document_exchange_rate',
    rateDateName: 'document_exchange_rate_date',
    sourceName: 'document_exchange_rate_source',
    statusSelector: '[data-document-bnr-status]'
  });

  const addLine = (lineData = {}) => {
    const container = modalElement.querySelector('#invoice-lines-container');
    const lineHtml = `
      <div class="form-row invoice-line">
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
          <button type="button" class="btn btn-sm btn-danger remove-line" style="margin-bottom: 8px;">×</button>
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

  modalElement.querySelector('#add-line').addEventListener('click', () => addLine());

  modalElement.querySelector('#invoice-lines-container').addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-line')) {
      const lineDiv = e.target.closest('.invoice-line');
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
    const lineDivs = modalElement.querySelectorAll('.invoice-line');
    const lines = [...lineDivs].map(lineDiv => ({
      quantity: lineDiv.querySelector('[name="line_quantity[]"]').value,
      unit_price: lineDiv.querySelector('[name="line_unit_price[]"]').value,
      discount: lineDiv.querySelector('[name="line_discount[]"]').value,
      vat_rate: lineDiv.querySelector('[name="line_vat_rate[]"]').value
    }));
    const { total } = calculateInvoiceTotals(lines);
    const display = modalElement.querySelector('#invoice-total-display');
    if (display) display.textContent = total.toFixed(2);
  }

  modalElement.querySelector('#invoice-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = modalElement.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Se salvează...';
    }

    const form = e.target;
    const formData = new FormData(form);

    const lineDivs = modalElement.querySelectorAll('.invoice-line');
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
      id: invoice ? invoice.id : null,
      client_id: formData.get('client_id'),
      issue_date: formData.get('issue_date'),
      due_date: formData.get('due_date'),
      currency: formData.get('currency'),
      document_exchange_rate: formData.get('document_exchange_rate') || null,
      document_exchange_rate_date: formData.get('document_exchange_rate_date') || null,
      document_exchange_rate_source: formData.get('document_exchange_rate_source') || null,
      payment_terms: parseInt(formData.get('payment_terms')) || 14,
      notes: formData.get('notes') || null
    };

    if (data.currency !== 'RON' && (!data.document_exchange_rate || !data.document_exchange_rate_date)) {
      showToast('Pentru factura în valută sunt obligatorii cursul BNR și data cursului documentului.', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isEdit ? 'Salvează draft' : 'Creează draft';
      }
      return;
    }

    try {
      await invoicesApi.saveDraft(data, lines);
      isDirty = false;
      showToast(isEdit ? 'Factură actualizată' : 'Factură draft creată', 'success');
      close();
      await loadInvoices();
    } catch (error) {
      showToast(error.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isEdit ? 'Salvează draft' : 'Creează draft';
      }
    }
  });

  modalElement.querySelector('#invoice-cancel').addEventListener('click', () => close());

  recalcTotal();
}

// ------------------ MODAL VIZUALIZARE DETALIU ------------------
async function openInvoiceDetail(invoiceId) {
  try {
    const invoice = await invoicesApi.get(invoiceId);
    if (!invoice) return;

    const lines = invoice.invoice_lines || [];
    const clientName = invoice.clients ? invoice.clients.legal_name : '-';

    const content = `
      <div class="mb-2">
        <strong>Factura:</strong> ${invoice.series ? `${invoice.series}-${invoice.number}` : 'Ciornă'}
        (${renderStatusBadge(invoice.document_status)} ${renderStatusBadge(invoice.payment_status)})
      </div>
      <div class="grid mb-2">
        <div><strong>Client:</strong> ${escapeHtml(clientName)}</div>
        <div><strong>Data:</strong> ${formatDate(invoice.issue_date)}</div>
        <div><strong>Scadență:</strong> ${formatDate(invoice.due_date)}</div>
        <div><strong>Total:</strong> ${formatCurrency(invoice.total, invoice.currency)}</div>
        <div><strong>Plătit:</strong> ${formatCurrency(invoice.paid_total, invoice.currency)}</div>
        <div><strong>Sold:</strong> ${formatCurrency(invoice.balance_due, invoice.currency)}</div>
      </div>
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
          unit_price: formatCurrency(l.unit_price, invoice.currency),
          discount: formatCurrency(l.discount, invoice.currency),
          vat_amount: formatCurrency(l.vat_amount, invoice.currency),
          total_amount: formatCurrency(l.total_amount, invoice.currency)
        }))
      )}
      ${invoice.notes ? `<p><strong>Note:</strong> ${escapeHtml(invoice.notes)}</p>` : ''}
      <div class="flex gap-1 mt-2">
        <button class="btn btn-sm btn-outline" data-action="pdf-from-detail" data-id="${invoice.id}" title="Previzualizează și tipărește">Previzualizare</button>
        ${EFACTURA_EXPORT_VALIDATED && invoice.document_status !== 'DRAFT'
          ? `<button class="btn btn-sm btn-outline" data-action="xml-from-detail" data-id="${invoice.id}">XML</button>`
          : '<button class="btn btn-sm btn-outline" disabled title="Export indisponibil până la validarea CIUS-RO/ANAF">XML indisponibil</button>'}
        ${invoice.document_status === 'ISSUED' && parseFloat(invoice.balance_due) > 0 && !['STORNO','CORRECTION'].includes(invoice.invoice_type) ? `<button class="btn btn-sm btn-success" data-action="receipt-from-detail" data-id="${invoice.id}">Înregistrează încasare</button>` : ''}
        <button class="btn btn-sm btn-outline" id="detail-close">Închide</button>
      </div>
    `;

    const { modalElement, close } = createModal({ title: 'Detalii factură', content, size: 'lg' });
    modalElement.querySelector('#detail-close').addEventListener('click', close);

    modalElement.querySelector('[data-action="pdf-from-detail"]').addEventListener('click', async () => {
      try {
        const pfaSettings = await settingsApi.getSettings();
        previewInvoice(invoice, pfaSettings || {});
      } catch (error) {
        showToast('Nu am putut genera PDF-ul: ' + error.message, 'error');
      }
    });

    modalElement.querySelector('[data-action="xml-from-detail"]')?.addEventListener('click', async () => {
      try {
        const pfaSettings = await getEfacturaSettings();
        const xmlString = generateEfacturaXml(invoice, pfaSettings || {});
        downloadXml(xmlString, `factura_${invoice.series || ''}${invoice.number || ''}.xml`);
      } catch (error) {
        showToast('Nu am putut genera XML-ul: ' + error.message, 'error');
      }
    });

    const receiptBtn = modalElement.querySelector('[data-action="receipt-from-detail"]');
    if (receiptBtn) {
      receiptBtn.addEventListener('click', () => {
        close();
        openReceiptModal(invoice);
      });
    }
  } catch (error) {
    console.error('openInvoiceDetail error:', error);
    showToast(error.message, 'error');
  }
}

// ------------------ MODAL ÎNCASARE ------------------
async function openReceiptModal(invoice) {
  if (!invoice || invoice.document_status !== 'ISSUED' || parseFloat(invoice.balance_due) <= 0 || ['STORNO','CORRECTION'].includes(invoice.invoice_type)) {
    showToast('Factura nu este eligibilă pentru încasare', 'error');
    return;
  }

  const stornoLinks = await invoicesApi.getStornoLinks();
  const hasStorno = stornoLinks.some(link => link.storno_for_invoice_id === invoice.id);
  if (hasStorno) {
    showToast('Factura a fost stornată și nu mai poate fi încasată.', 'warning');
    return;
  }

  const content = `
    <form id="receipt-form">
      <div class="form-group">
        <label>Suma de încasat * (max: ${invoice.balance_due})</label>
        <input type="number" step="0.01" min="0.01" max="${invoice.balance_due}" name="amount" value="${invoice.balance_due}" required>
      </div>
      <div class="form-group">
        <label>Data încasării *</label>
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
        <textarea name="notes" placeholder="Note despre încasare"></textarea>
      </div>
      <div class="flex gap-1 mt-2">
        <button type="submit" class="btn btn-success">Înregistrează încasarea</button>
        <button type="button" class="btn btn-outline" id="receipt-cancel">Anulează</button>
      </div>
    </form>
  `;

  const { modalElement, close } = createModal({ title: 'Înregistrează încasare', content, closeOnOverlayClick: false });
  const receiptForm = modalElement.querySelector('#receipt-form');
  bindFxPreview(receiptForm);
  bindBnrRateAutofill(receiptForm, { currency: invoice.currency });
  modalElement.querySelector('#receipt-cancel').addEventListener('click', close);
  modalElement.querySelector('#receipt-form').addEventListener('submit', async (e) => {
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
      await transactionsApi.registerReceipt({
        invoiceId: invoice.id,
        amount,
        date,
        paymentMethod: method,
        bankAccountId: null,
        notes,
        ...readFxParams(formData, invoice.currency)
      });
      showToast('Încasare înregistrată', 'success');
      close();
      await loadInvoices();
    } catch (error) {
      showToast(error.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Înregistrează încasarea';
      }
    }
  });
}

// ------------------ MODAL ISTORIC ------------------
async function openInvoiceHistory(invoiceId) {
  try {
    const history = await invoicesApi.getHistory(invoiceId);
    const content = `
      ${history.length === 0 ? '<p>Nu există evenimente</p>' : `
        <div class="table-container">
          <table>
            <thead><tr><th>Data</th><th>Eveniment</th><th>Detalii</th></tr></thead>
            <tbody>
              ${history.map(h => `
                <tr>
                  <td>${formatDate(h.created_at)}</td>
                  <td>${escapeHtml(h.event_type)}</td>
                  <td>${escapeHtml(JSON.stringify(h.event_data || {}))}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;
    createModal({ title: 'Istoric factură', content, size: 'lg' });
  } catch (error) {
    console.error('openInvoiceHistory error:', error);
    showToast(error.message, 'error');
  }
}
