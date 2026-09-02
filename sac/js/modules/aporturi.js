// js/modules/aporturi.js
// Modul Aport propriu – evidența operațiunilor cu titularul
// Include aporturi (OWN_CONTRIBUTION) și restituiri de aport (OWN_CONTRIBUTION_RETURN)
// Acestea sunt fluxuri de numerar, dar NU sunt venituri/cheltuieli fiscale.
// Fix: butonul de ștergere apare doar pentru tranzacții PENDING,
// iar mesajele de succes sunt afișate doar dacă API-ul confirmă ștergerea.

import { transactionsApi, bankAccountsApi } from '../api.js';
import { formatCurrency, formatDate, toInputDate, showToast, escapeHtml } from '../utils.js';
import { createModal, renderStatusBadge, confirmDialog, renderTable, renderSkeleton, renderEmptyState } from '../ui.js';

let currentAporturi = [];
let filters = {
  type: 'all',
  fromDate: '',
  toDate: ''
};

function getTransactionTypeLabel(type) {
  const labels = {
    'OWN_CONTRIBUTION': 'Aport propriu',
    'OWN_CONTRIBUTION_RETURN': 'Restituire aport'
  };
  return labels[type] || type;
}

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-heading"><h2>Aport propriu</h2><p>Evidențiază separat banii introduși sau retrași de titular, fără impact asupra venitului fiscal.</p></div>
      <div class="flex gap-1">
        <button class="btn btn-primary" id="add-contribution" title="Adaugă un aport propriu">＋ Adaugă aport</button>
        <button class="btn btn-outline" id="add-return" title="Adaugă o restituire de aport">− Restituie aport</button>
      </div>
    </div>
    <div class="card filter-card">
      <div class="filter-card-heading"><div><span class="card-eyebrow">Mișcări ale titularului</span><h3>Filtrează operațiunile</h3></div><button class="btn-link clear-filters" id="reset-aport-filters" type="button">Resetează filtrele</button></div>
      <div class="filters-row">
        <div class="form-group">
          <label>Tip</label>
          <select id="filter-type">
            <option value="all" ${filters.type === 'all' ? 'selected' : ''}>Toate</option>
            <option value="OWN_CONTRIBUTION" ${filters.type === 'OWN_CONTRIBUTION' ? 'selected' : ''}>Aporturi</option>
            <option value="OWN_CONTRIBUTION_RETURN" ${filters.type === 'OWN_CONTRIBUTION_RETURN' ? 'selected' : ''}>Restituiri</option>
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
          <label class="filter-action-label" aria-hidden="true">Aplică</label>
          <button class="btn btn-outline" id="apply-filters" title="Aplică filtrele">Aplică filtrele</button>
        </div>
      </div>
    </div>
    <div class="alert alert-info">
      <strong>Notă:</strong> Aporturile proprii și restituirile de aport sunt evidențiate în RJIP,
      dar nu reprezintă venituri sau cheltuieli fiscale. Acestea nu pot fi șterse după înregistrare.
    </div>
    <div id="aporturi-list"></div>
  `;

  document.getElementById('add-contribution').addEventListener('click', () => openAportModal('OWN_CONTRIBUTION'));
  document.getElementById('add-return').addEventListener('click', () => openAportModal('OWN_CONTRIBUTION_RETURN'));
  document.getElementById('reset-aport-filters').addEventListener('click', () => {
    filters = { type: 'all', fromDate: '', toDate: '' };
    render(container);
  });
  document.getElementById('apply-filters').addEventListener('click', () => {
    filters.type = document.getElementById('filter-type').value;
    filters.fromDate = document.getElementById('filter-from-date').value;
    filters.toDate = document.getElementById('filter-to-date').value;
    loadAporturi();
  });

  await loadAporturi();
}

export function destroy() {}

async function loadAporturi() {
  const listContainer = document.getElementById('aporturi-list');
  if (!listContainer) return;
  listContainer.innerHTML = renderSkeleton(5);

  try {
    const allTransactions = await transactionsApi.list({
      type: undefined,
      fromDate: filters.fromDate || undefined,
      toDate: filters.toDate || undefined
    });

    currentAporturi = allTransactions
      .filter(tx => tx.transaction_type === 'OWN_CONTRIBUTION' || tx.transaction_type === 'OWN_CONTRIBUTION_RETURN')
      .filter(tx => {
        if (filters.type !== 'all' && tx.transaction_type !== filters.type) return false;
        return true;
      })
      .sort((a, b) => new Date(b.transaction_date) - new Date(a.transaction_date));

    renderAporturiList(listContainer);
  } catch (error) {
    console.error('Eroare la încărcarea aporturilor:', error);
    listContainer.innerHTML = `<div class="alert alert-error">${escapeHtml(error.message || 'Nu am putut încărca aporturile')}</div>`;
  }
}

function renderAporturiList(container) {
  if (!currentAporturi || currentAporturi.length === 0) {
    container.innerHTML = renderEmptyState('Nu există operațiuni de aport propriu în această perioadă.');
    return;
  }

  const totalContributions = currentAporturi
    .filter(tx => tx.transaction_type === 'OWN_CONTRIBUTION')
    .reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0);

  const totalReturns = currentAporturi
    .filter(tx => tx.transaction_type === 'OWN_CONTRIBUTION_RETURN')
    .reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0);

  const headers = [
    { label: 'Data', key: 'transaction_date' },
    { label: 'Tip', key: 'type' },
    { label: 'Descriere', key: 'description' },
    { label: 'Sumă', key: 'amount', align: 'right' },
    { label: 'Metodă', key: 'method' },
    { label: 'Referință', key: 'reference' },
    { label: 'Stare', key: 'status' },
    { label: 'Acțiuni', key: 'actions' }
  ];

  const rows = currentAporturi.map(tx => {
    const isContribution = tx.transaction_type === 'OWN_CONTRIBUTION';
    const amountClass = isContribution ? 'color: var(--color-info)' : 'color: var(--color-warning)';
    const sign = isContribution ? '+' : '-';
    const canDelete = tx.status === 'PENDING';

    const actions = canDelete
      ? `<div class="flex gap-1">
          <button class="btn btn-sm btn-outline" data-action="view" data-id="${tx.id}" title="Vezi detalii">Vezi</button>
          <button class="btn btn-sm btn-danger" data-action="delete" data-id="${tx.id}" title="Șterge operațiunea">Șterge</button>
        </div>`
      : `<div class="flex gap-1">
          <button class="btn btn-sm btn-outline" data-action="view" data-id="${tx.id}" title="Vezi detalii">Vezi</button>
        </div>`;

    return {
      transaction_date: formatDate(tx.transaction_date),
      type: renderStatusBadge(tx.transaction_type),
      description: tx.description || '-',
      amount: `<span style="${amountClass}; font-weight: 600;">${sign}${formatCurrency(tx.amount, tx.currency)}</span>`,
      method: tx.payment_method,
      reference: tx.reference || '-',
      status: renderStatusBadge(tx.status),
      actions
    };
  });

  let html = `
    <div class="grid mb-2">
      <div class="stat-card">
        <span class="stat-label">Total aporturi</span>
        <span class="stat-value" style="color: var(--color-info)">${formatCurrency(totalContributions, 'RON')}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Total restituiri</span>
        <span class="stat-value" style="color: var(--color-warning)">${formatCurrency(totalReturns, 'RON')}</span>
      </div>
    </div>
  `;

  html += `<div class="list-summary"><span><strong>${currentAporturi.length}</strong> ${currentAporturi.length === 1 ? 'operațiune' : 'operațiuni'} în perioada selectată</span><span>Sold aport: <strong>${formatCurrency(totalContributions - totalReturns, 'RON')}</strong></span></div>`;
  html += renderTable(headers, rows, { emptyMessage: 'Nu există operațiuni', rawColumns: ['type', 'amount', 'status', 'actions'] });
  container.innerHTML = html;

  container.querySelectorAll('[data-action="view"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      const tx = currentAporturi.find(t => t.id === id);
      if (tx) openTransactionDetail(tx);
    });
  });

  container.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const tx = currentAporturi.find(t => t.id === id);
      if (!tx) return;
      if (tx.status !== 'PENDING') {
        showToast('Această operațiune nu poate fi ștearsă.', 'warning');
        return;
      }
      const ok = await confirmDialog(`Sigur dorești să ștergi această operațiune (${tx.description || tx.transaction_type})?`, { danger: true });
      if (ok) {
        try {
          await transactionsApi.remove(id);
          showToast('Operațiune ștearsă', 'success');
          await loadAporturi();
        } catch (error) {
          showToast(error.message, 'error');
        }
      }
    });
  });
}

// ------------------ MODAL DETALIU ------------------
function openTransactionDetail(tx) {
  const isContribution = tx.transaction_type === 'OWN_CONTRIBUTION';
  const content = `
    <div class="grid mb-2">
      <div><strong>Data:</strong> ${formatDate(tx.transaction_date)}</div>
      <div><strong>Tip:</strong> ${renderStatusBadge(tx.transaction_type)}</div>
      <div><strong>Direcție:</strong> ${isContribution ? 'Intrare (aport)' : 'Ieșire (restituire)'}</div>
      <div><strong>Sumă:</strong> ${formatCurrency(tx.amount, tx.currency)}</div>
      <div><strong>Metodă:</strong> ${tx.payment_method}</div>
      <div><strong>Descriere:</strong> ${escapeHtml(tx.description || '-')}</div>
      <div><strong>Referință:</strong> ${escapeHtml(tx.reference || '-')}</div>
      <div><strong>Stare:</strong> ${renderStatusBadge(tx.status)}</div>
    </div>
    <div class="alert alert-info">
      ${isContribution ? 'Aportul propriu nu este venit fiscal.' : 'Restituirea de aport nu este cheltuială deductibilă.'}
    </div>
  `;
  createModal({ title: 'Detalii operațiune', content });
}

// ------------------ MODAL ADĂUGARE ------------------
async function openAportModal(type) {
  const isContribution = type === 'OWN_CONTRIBUTION';
  const title = isContribution ? 'Adaugă aport propriu' : 'Restituie aport propriu';
  const bankAccounts = await bankAccountsApi.list();

  const content = `
    <form id="aport-form">
      <div class="form-row">
        <div class="form-group">
          <label>Sumă *</label>
          <input type="number" step="0.01" min="0.01" name="amount" required>
        </div>
        <div class="form-group">
          <label>Data *</label>
          <input type="date" name="transaction_date" required value="${toInputDate(new Date())}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Metodă</label>
          <select name="payment_method">
            <option value="BANK">Bancă</option>
            <option value="CASH">Numerar</option>
            <option value="CARD">Card</option>
            <option value="OTHER">Alta</option>
          </select>
        </div>
        <div class="form-group">
          <label>Cont bancar</label>
          <select name="bank_account_id">
            <option value="">Fără cont</option>
            ${bankAccounts.map(ba => `<option value="${ba.id}">${escapeHtml(ba.bank_name || ba.iban)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Descriere *</label>
        <input type="text" name="description" required placeholder="${isContribution ? 'Ex: Aport propriu titular' : 'Ex: Restituire aport propriu titular'}">
      </div>
      <div class="form-group">
        <label>Referință</label>
        <input type="text" name="reference" placeholder="Ex: OP nr. 5">
      </div>
      <div class="alert alert-info">
        ${isContribution ? 'Aportul propriu este evidențiat în RJIP, dar nu este venit fiscal.' : 'Restituirea de aport este evidențiată în RJIP, dar nu este cheltuială deductibilă.'}
      </div>
      <div class="flex gap-1 mt-2">
        <button type="submit" class="btn btn-primary">${isContribution ? 'Adaugă aport' : 'Restituie'}</button>
        <button type="button" class="btn btn-outline" id="aport-cancel">Anulează</button>
      </div>
    </form>
  `;

  const { modalElement, close } = createModal({ title, content, closeOnOverlayClick: false });
  modalElement.querySelector('#aport-cancel').addEventListener('click', close);
  modalElement.querySelector('#aport-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = modalElement.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Se procesează...';
    }

    const form = e.target;
    const formData = new FormData(form);

    const amount = parseFloat(formData.get('amount'));
    const date = formData.get('transaction_date');
    const paymentMethod = formData.get('payment_method');
    const bankAccountId = formData.get('bank_account_id') || null;
    const description = formData.get('description');
    const reference = formData.get('reference') || null;

    if (isNaN(amount) || amount <= 0) {
      showToast('Suma trebuie să fie pozitivă', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isContribution ? 'Adaugă aport' : 'Restituie';
      }
      return;
    }

    try {
      await transactionsApi.createManual({
        direction: isContribution ? 'IN' : 'OUT',
        type: isContribution ? 'OWN_CONTRIBUTION' : 'OWN_CONTRIBUTION_RETURN',
        amount,
        date,
        currency: 'RON',
        paymentMethod,
        bankAccountId,
        description,
        counterparty: null,
        reference
      });
      showToast('Operațiune înregistrată', 'success');
      close();
      await loadAporturi();
    } catch (error) {
      showToast(error.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isContribution ? 'Adaugă aport' : 'Restituie';
      }
    }
  });
}
