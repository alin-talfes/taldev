// js/modules/other-operations.js
// Modul Alte încasări / cheltuieli
// Evidența operațiunilor financiare non-factură (fără aporturi/retrageri titular)
// Include atașarea documentelor justificative și deductibilitate limitată.
// Fix: afișare corectă a procentului de deductibilitate când valoarea este null.

import { otherOperationsApi, bankAccountsApi, documentsApi } from '../api.js';
import { formatCurrency, formatDate, toInputDate, showToast, escapeHtml } from '../utils.js';
import { createModal, renderStatusBadge, confirmDialog, renderTable, renderSkeleton, renderEmptyState } from '../ui.js';

let currentOperations = [];
let filters = {
  direction: 'all',
  category: 'all',
  paymentMethod: 'all',
  status: 'all',
  fromDate: '',
  toDate: '',
  search: ''
};

const incomeCategories = [
  'ALTE_VENITURI',
  'RESTITUIRI',
  'ALTELE'
];

const expenseCategories = [
  'CONSUMABILE',
  'SERVICII',
  'TRANSPORT',
  'TAXE_SI_IMPOZITE',
  'COMISIOANE_BANCARE',
  'ECHIPAMENTE',
  'ALTE_CHELTUIELI'
];

const fiscalTreatments = [
  'INCOME',
  'DEDUCTIBLE_EXPENSE',
  'NON_DEDUCTIBLE_EXPENSE',
  'CASH_MOVEMENT'
];

function getCategoryLabel(cat) {
  const labels = {
    'ALTE_VENITURI': 'Alte venituri',
    'RESTITUIRI': 'Restituiri / rambursări',
    'ALTELE': 'Altele',
    'CONSUMABILE': 'Consumabile',
    'SERVICII': 'Servicii',
    'TRANSPORT': 'Transport',
    'TAXE_SI_IMPOZITE': 'Taxe și impozite',
    'COMISIOANE_BANCARE': 'Comisioane bancare',
    'ECHIPAMENTE': 'Echipamente / mijloace fixe',
    'ALTE_CHELTUIELI': 'Alte cheltuieli'
  };
  return labels[cat] || cat;
}

function getFiscalTreatmentLabel(t) {
  const labels = {
    'INCOME': 'Venit',
    'DEDUCTIBLE_EXPENSE': 'Cheltuială deductibilă',
    'NON_DEDUCTIBLE_EXPENSE': 'Cheltuială nedeductibilă',
    'CASH_MOVEMENT': 'Mișcare numerar'
  };
  return labels[t] || t;
}

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
      <div class="page-heading"><h2>Alte încasări / cheltuieli</h2><p>Înregistrează operațiunile care nu provin din facturi și stabilește tratamentul lor fiscal.</p></div>
      <button class="btn btn-primary" id="add-operation" title="Adaugă operațiune">＋ Operațiune nouă</button>
    </div>

    <div class="card filter-card operations-filter-card">
      <div class="filter-card-heading"><div><span class="card-eyebrow">Operațiuni non-factură</span><h3>Caută și filtrează</h3></div><button class="btn-link clear-filters" id="reset-operation-filters" type="button">Resetează filtrele</button></div>
      <div class="filters-row">
        <div class="form-group">
          <label>Direcție</label>
          <select id="filter-direction">
            <option value="all" ${filters.direction === 'all' ? 'selected' : ''}>Toate</option>
            <option value="IN" ${filters.direction === 'IN' ? 'selected' : ''}>Încasări</option>
            <option value="OUT" ${filters.direction === 'OUT' ? 'selected' : ''}>Cheltuieli</option>
          </select>
        </div>
        <div class="form-group">
          <label>Categorie</label>
          <select id="filter-category">
            <option value="all" ${filters.category === 'all' ? 'selected' : ''}>Toate</option>
            ${incomeCategories.concat(expenseCategories).map(c => `<option value="${c}" ${filters.category === c ? 'selected' : ''}>${getCategoryLabel(c)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Metodă plată</label>
          <select id="filter-payment-method">
            <option value="all" ${filters.paymentMethod === 'all' ? 'selected' : ''}>Toate</option>
            <option value="CASH" ${filters.paymentMethod === 'CASH' ? 'selected' : ''}>Numerar</option>
            <option value="CARD" ${filters.paymentMethod === 'CARD' ? 'selected' : ''}>Card</option>
            <option value="BANK" ${filters.paymentMethod === 'BANK' ? 'selected' : ''}>Transfer bancar</option>
            <option value="OTHER" ${filters.paymentMethod === 'OTHER' ? 'selected' : ''}>Alta</option>
          </select>
        </div>
        <div class="form-group">
          <label>Stare</label>
          <select id="filter-status">
            <option value="all" ${filters.status === 'all' ? 'selected' : ''}>Toate</option>
            <option value="CONFIRMED" ${filters.status === 'CONFIRMED' ? 'selected' : ''}>Activă</option>
            <option value="CANCELLED" ${filters.status === 'CANCELLED' ? 'selected' : ''}>Anulată</option>
          </select>
        </div>
        <div class="form-group">
          <label>De la</label>
          <input type="date" id="filter-from-date" value="${filters.fromDate}">
        </div>
        <div class="form-group">
          <label>Până la</label>
          <input type="date" id="filter-to-date" value="${filters.toDate}">
        </div>
        <div class="form-group">
          <label for="filter-search">Descriere sau referință</label>
          <input type="search" id="filter-search" placeholder="Caută în operațiuni..." value="${escapeHtml(filters.search)}">
        </div>
        <div class="form-group">
          <label class="filter-action-label" aria-hidden="true">Aplică</label>
          <button class="btn btn-outline" id="apply-filters" title="Aplică filtrele">Aplică filtrele</button>
        </div>
      </div>
    </div>

    <div id="operations-summary" class="grid mb-2"></div>
    <div id="operations-list"></div>
  `;

  document.getElementById('add-operation').addEventListener('click', () => openOperationModal());
  document.getElementById('reset-operation-filters').addEventListener('click', () => {
    filters = { direction: 'all', category: 'all', paymentMethod: 'all', status: 'all', fromDate: '', toDate: '', search: '' };
    render(container);
  });
  document.getElementById('apply-filters').addEventListener('click', () => {
    filters.direction = document.getElementById('filter-direction').value;
    filters.category = document.getElementById('filter-category').value;
    filters.paymentMethod = document.getElementById('filter-payment-method').value;
    filters.status = document.getElementById('filter-status').value;
    filters.fromDate = document.getElementById('filter-from-date').value;
    filters.toDate = document.getElementById('filter-to-date').value;
    filters.search = document.getElementById('filter-search').value.trim();
    loadOperations();
  });
  document.getElementById('filter-search').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      document.getElementById('apply-filters').click();
    }
  });

  await loadOperations();
}

export function destroy() {}

async function loadOperations() {
  const summaryContainer = document.getElementById('operations-summary');
  const listContainer = document.getElementById('operations-list');
  if (!summaryContainer || !listContainer) return;

  listContainer.innerHTML = renderSkeleton(5);

  try {
    currentOperations = await otherOperationsApi.list(filters);
    renderSummary(summaryContainer);
    renderOperationsList(listContainer);
  } catch (error) {
    console.error('Eroare la încărcarea operațiunilor:', error);
    listContainer.innerHTML = `<div class="alert alert-error">${escapeHtml(error.message || 'Nu am putut încărca operațiunile')}</div>`;
  }
}

function renderSummary(container) {
  const confirmed = currentOperations.filter(o => o.status === 'CONFIRMED');
  const totalIn = confirmed.filter(o => o.direction === 'IN').reduce((s, o) => s + parseFloat(o.amount || 0), 0);
  const totalOut = confirmed.filter(o => o.direction === 'OUT').reduce((s, o) => s + parseFloat(o.amount || 0), 0);
  const sold = totalIn - totalOut;

  container.innerHTML = `
    <div class="stat-card"><span class="stat-label">Total încasări</span><span class="stat-value" style="color:var(--color-success)">${formatCurrency(totalIn, 'RON')}</span></div>
    <div class="stat-card"><span class="stat-label">Total cheltuieli</span><span class="stat-value" style="color:var(--color-danger)">${formatCurrency(totalOut, 'RON')}</span></div>
    <div class="stat-card"><span class="stat-label">Sold</span><span class="stat-value" style="color:${sold >= 0 ? 'var(--color-success)' : 'var(--color-danger)'}">${formatCurrency(sold, 'RON')}</span></div>
    <div class="stat-card"><span class="stat-label">Număr operațiuni</span><span class="stat-value">${confirmed.length}</span></div>
  `;
}

function renderOperationsList(container) {
  if (!currentOperations || currentOperations.length === 0) {
    container.innerHTML = renderEmptyState('Nu există operațiuni în această listă.');
    return;
  }

  const headers = [
    { label: 'Data', key: 'transaction_date' },
    { label: 'Tip', key: 'type' },
    { label: 'Categorie', key: 'category' },
    { label: 'Descriere', key: 'description' },
    { label: 'Sumă', key: 'amount', align: 'right' },
    { label: 'Metodă', key: 'method' },
    { label: 'Tratament fiscal', key: 'fiscal_treatment' },
    { label: 'Stare', key: 'status' },
    { label: 'Acțiuni', key: 'actions' }
  ];

  const rows = currentOperations.map(op => {
    const isIn = op.direction === 'IN';
    const canCancel = op.status === 'CONFIRMED';

    return {
      transaction_date: formatDate(op.transaction_date),
      type: renderStatusBadge(op.transaction_type),
      category: getCategoryLabel(op.category),
      description: op.description || '-',
      amount: `<span style="color:${isIn ? 'var(--color-success)' : 'var(--color-danger)'};font-weight:600;">${isIn ? '+' : '-'}${formatCurrency(op.amount, op.currency)}</span>`,
      method: op.payment_method,
      fiscal_treatment: getFiscalTreatmentLabel(op.fiscal_treatment),
      status: renderStatusBadge(op.status),
      actions: `
        <div class="flex gap-1">
          <button class="btn btn-sm btn-outline" data-action="view" data-id="${op.id}" title="Vezi detalii">Vezi</button>
          ${canCancel ? `<button class="btn btn-sm btn-danger" data-action="cancel" data-id="${op.id}" title="Anulează">Anulează</button>` : ''}
        </div>
      `
    };
  });

  container.innerHTML = `<div class="list-summary"><span><strong>${currentOperations.length}</strong> ${currentOperations.length === 1 ? 'operațiune găsită' : 'operațiuni găsite'}</span><span>Valorile din sumar includ doar operațiunile confirmate</span></div>` + renderTable(headers, rows, {
    emptyMessage: 'Nu există operațiuni',
    rawColumns: ['type', 'amount', 'status', 'actions']
  });

  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      const operation = currentOperations.find(o => o.id === id);
      if (!operation) return;

      if (action === 'view') {
        openOperationDetail(operation);
      } else if (action === 'cancel') {
        const ok = await confirmDialog('Sigur dorești să anulezi această operațiune?', { danger: true });
        if (ok) {
          try {
            await otherOperationsApi.cancel(id);
            showToast('Operațiune anulată', 'success');
            await loadOperations();
          } catch (error) {
            showToast(error.message, 'error');
          }
        }
      }
    });
  });
}

// ------------------ MODAL DETALIU ------------------
async function openOperationDetail(operation) {
  try {
    const full = await otherOperationsApi.get(operation.id);

    const content = `
      <div class="grid mb-2">
        <div><strong>Data:</strong> ${formatDate(full.transaction_date)}</div>
        <div><strong>Tip:</strong> ${renderStatusBadge(full.transaction_type)}</div>
        <div><strong>Direcție:</strong> ${full.direction === 'IN' ? 'Încasare' : 'Cheltuială'}</div>
        <div><strong>Sumă:</strong> ${formatCurrency(full.amount, full.currency)}</div>
        <div><strong>Monedă:</strong> ${full.currency}</div>
        <div><strong>Metodă:</strong> ${full.payment_method}</div>
        <div><strong>Categorie:</strong> ${getCategoryLabel(full.category)}</div>
        <div><strong>Tratament fiscal:</strong> ${getFiscalTreatmentLabel(full.fiscal_treatment)}</div>
        <div><strong>Procent deductibilitate:</strong> ${formatDeductibilityPercent(full.deductibility_percent)}</div>
        <div><strong>Limită deductibilitate:</strong> ${formatDeductibilityLimit(full.deductibility_limit)}</div>
        <div><strong>Descriere:</strong> ${escapeHtml(full.description || '-')}</div>
        <div><strong>Partener:</strong> ${escapeHtml(full.counterparty_name || '-')}</div>
        <div><strong>Document:</strong> ${escapeHtml(full.document_type || '-')} ${escapeHtml(full.document_number || '')}</div>
        <div><strong>Dată document:</strong> ${full.document_date ? formatDate(full.document_date) : '-'}</div>
        <div><strong>Observații:</strong> ${escapeHtml(full.notes || '-')}</div>
        <div><strong>Stare:</strong> ${renderStatusBadge(full.status)}</div>
      </div>
    `;
    createModal({ title: 'Detalii operațiune', content, size: 'lg' });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ------------------ MODAL CREARE/EDITARE ------------------
async function openOperationModal(operation = null) {
  const isEdit = !!operation;
  if (isEdit) {
    showToast('Operațiunile confirmate nu se modifică. Anulează operațiunea și înregistrează una nouă.', 'warning');
    return;
  }
  const title = 'Adaugă operațiune';
  const bankAccounts = await bankAccountsApi.list();

  const content = `
    <div class="alert alert-info">Operațiunile non-factură sunt înregistrate momentan numai în RON. Pentru valută este necesar un flux dedicat cu curs BNR și valoare bancară.</div>
    <form id="operation-form">
      <div class="form-group">
        <label>Tip *</label>
        <select name="direction" required>
          <option value="IN" ${operation && operation.direction === 'IN' ? 'selected' : ''}>Încasare</option>
          <option value="OUT" ${operation && operation.direction === 'OUT' ? 'selected' : ''}>Cheltuială</option>
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Sumă *</label>
          <input type="number" step="0.01" min="0.01" name="amount" required value="${operation ? operation.amount : ''}">
        </div>
        <div class="form-group">
          <label>Monedă</label>
          <input name="currency" value="RON" readonly aria-readonly="true">
        </div>
        <div class="form-group">
          <label>Data *</label>
          <input type="date" name="transaction_date" required value="${operation ? toInputDate(operation.transaction_date) : toInputDate(new Date())}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Metodă plată</label>
          <select name="payment_method">
            <option value="CASH" ${operation && operation.payment_method === 'CASH' ? 'selected' : ''}>Numerar</option>
            <option value="CARD" ${operation && operation.payment_method === 'CARD' ? 'selected' : ''}>Card</option>
            <option value="BANK" ${operation && operation.payment_method === 'BANK' ? 'selected' : ''}>Transfer bancar</option>
            <option value="OTHER" ${operation && operation.payment_method === 'OTHER' ? 'selected' : ''}>Altă metodă</option>
          </select>
        </div>
        <div class="form-group">
          <label>Cont bancar</label>
          <select name="bank_account_id">
            <option value="">Fără cont</option>
            ${bankAccounts.map(ba => `<option value="${ba.id}" ${operation && operation.bank_account_id === ba.id ? 'selected' : ''}>${escapeHtml(ba.bank_name || ba.iban)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Categorie</label>
        <select name="category" id="operation-category">
          <option value="">Selectează...</option>
          ${incomeCategories.map(c => `<option value="${c}" ${operation && operation.category === c ? 'selected' : ''}>${getCategoryLabel(c)}</option>`).join('')}
          ${expenseCategories.map(c => `<option value="${c}" ${operation && operation.category === c ? 'selected' : ''}>${getCategoryLabel(c)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Tratament fiscal</label>
        <select name="fiscal_treatment" required>
          <option value="">Selectează...</option>
          ${fiscalTreatments.map(t => `<option value="${t}" ${operation && operation.fiscal_treatment === t ? 'selected' : ''}>${getFiscalTreatmentLabel(t)}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Procent deductibilitate (%)</label>
          <input type="number" step="0.01" min="0" max="100" name="deductibility_percent" value="${operation ? (operation.deductibility_percent ?? '') : ''}">
        </div>
        <div class="form-group">
          <label>Limită deductibilitate (lei)</label>
          <input type="number" step="0.01" min="0" name="deductibility_limit" value="${operation ? (operation.deductibility_limit ?? '') : ''}">
        </div>
      </div>
      <div class="form-group">
        <label>Descriere / explicație *</label>
        <input type="text" name="description" required value="${operation ? escapeHtml(operation.description || '') : ''}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Tip document</label>
          <input type="text" name="document_type" value="${operation ? escapeHtml(operation.document_type || '') : ''}" placeholder="Ex: chitanță, OP">
        </div>
        <div class="form-group">
          <label>Număr document</label>
          <input type="text" name="document_number" value="${operation ? escapeHtml(operation.document_number || '') : ''}">
        </div>
        <div class="form-group">
          <label>Dată document</label>
          <input type="date" name="document_date" value="${operation && operation.document_date ? toInputDate(operation.document_date) : ''}">
        </div>
      </div>
      <div class="form-group">
        <label>Partener (nume)</label>
        <input type="text" name="counterparty_name" value="${operation ? escapeHtml(operation.counterparty_name || '') : ''}">
      </div>
      <div class="form-group">
        <label>Referință</label>
        <input type="text" name="reference" value="${operation ? escapeHtml(operation.reference || '') : ''}">
      </div>
      <div class="form-group">
        <label>Observații</label>
        <textarea name="notes">${operation ? escapeHtml(operation.notes || '') : ''}</textarea>
      </div>
      <div class="form-group">
        <label>Atașament document (opțional)</label>
        <input type="file" name="attachment" accept=".pdf,.xml,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.csv">
      </div>
      <div class="flex gap-1 mt-2">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Actualizează' : 'Adaugă'}</button>
        <button type="button" class="btn btn-outline" id="operation-cancel">Anulează</button>
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

  modalElement.addEventListener('input', markDirty);
  modalElement.addEventListener('change', markDirty);

  modalElement.querySelector('#operation-cancel').addEventListener('click', () => close());

  modalElement.querySelector('#operation-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = modalElement.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Se salvează...';
    }

    const form = e.target;
    const formData = new FormData(form);

    const direction = formData.get('direction');
    const amount = parseFloat(formData.get('amount'));
    const transactionDate = formData.get('transaction_date');

    if (isNaN(amount) || amount <= 0) {
      showToast('Suma trebuie să fie pozitivă', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isEdit ? 'Actualizează' : 'Adaugă';
      }
      return;
    }

    const type = direction === 'IN' ? 'OTHER_IN' : 'OTHER_OUT';

    const data = {
      id: operation ? operation.id : null,
      direction,
      transaction_type: type,
      amount,
      transaction_date: transactionDate,
      currency: formData.get('currency'),
      payment_method: formData.get('payment_method'),
      bank_account_id: formData.get('bank_account_id') || null,
      description: formData.get('description'),
      category: formData.get('category') || null,
      fiscal_treatment: formData.get('fiscal_treatment') || null,
      document_type: formData.get('document_type') || null,
      document_number: formData.get('document_number') || null,
      document_date: formData.get('document_date') || null,
      notes: formData.get('notes') || null,
      counterparty_name: formData.get('counterparty_name') || null,
      reference: formData.get('reference') || null,
      deductibility_percent: formData.get('deductibility_percent') || null,
      deductibility_limit: formData.get('deductibility_limit') || null
    };

    try {
      const transactionId = await otherOperationsApi.save(data);

      const fileInput = modalElement.querySelector('input[name="attachment"]');
      if (fileInput && fileInput.files && fileInput.files.length > 0) {
        const file = fileInput.files[0];
        try {
          await documentsApi.upload(file, {
            entityType: 'financial_transaction_id',
            entityId: transactionId,
            category: 'other-operations'
          });
        } catch (uploadError) {
          showToast('Operațiune salvată, dar atașamentul a eșuat: ' + uploadError.message, 'warning');
        }
      }

      isDirty = false;
      showToast(isEdit ? 'Operațiune actualizată' : 'Operațiune adăugată', 'success');
      close();
      await loadOperations();
    } catch (error) {
      showToast(error.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isEdit ? 'Actualizează' : 'Adaugă';
      }
    }
  });
}
