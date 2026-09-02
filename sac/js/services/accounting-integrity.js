// js/services/accounting-integrity.js
// Reguli frontend care trebuie să rămână identice cu motorul contabil din PostgreSQL:
// - rotunjire monetară pe fiecare linie la 2 zecimale;
// - TVA colectată blocată pentru PFA neînregistrat în scopuri de TVA;
// - refundurile se înregistrează separat de documentele storno.

import { getSupabase } from '../supabase.js';
import { bankAccountsApi, settingsApi } from '../api.js';
import { createModal, confirmDialog } from '../ui.js';
import {
  calculateLineTotals,
  escapeHtml,
  formatCurrency,
  generateIdempotencyKey,
  round2,
  showToast,
  toInputDate
} from '../utils.js';
import { bindFxPreview, fxFieldsHtml, readFxParams } from './fx-accounting.js';

const FORM_CONFIG = {
  'invoice-form': {
    display: '#invoice-total-display',
    lockOutputVat: true
  },
  'proforma-form': {
    display: '#proforma-total-display',
    lockOutputVat: true
  },
  'received-invoice-form': {
    display: '#received-invoice-total-display',
    lockOutputVat: false
  }
};

let initialized = false;
let settingsPromise = null;
let refreshTimer = null;
let refundRefreshRunning = false;

function money(value) {
  return round2(value);
}

function findLineContainer(input, form) {
  let node = input?.parentElement || null;

  while (node && node !== form) {
    if (
      node.querySelector('[name="line_unit_price[]"]') &&
      node.querySelector('[name="line_discount[]"]') &&
      node.querySelector('[name="line_vat_rate[]"]')
    ) {
      return node;
    }
    node = node.parentElement;
  }

  return null;
}

function getLineContainers(form) {
  const containers = [];
  const seen = new Set();

  form.querySelectorAll('[name="line_quantity[]"]').forEach((input) => {
    const container = findLineContainer(input, form);
    if (container && !seen.has(container)) {
      seen.add(container);
      containers.push(container);
    }
  });

  return containers;
}

function calculateCanonicalTotal(form) {
  let documentTotal = 0;

  for (const line of getLineContainers(form)) {
    const quantity = Number(line.querySelector('[name="line_quantity[]"]')?.value) || 0;
    const unitPrice = Number(line.querySelector('[name="line_unit_price[]"]')?.value) || 0;
    const discount = Number(line.querySelector('[name="line_discount[]"]')?.value) || 0;
    const vatRate = Number(line.querySelector('[name="line_vat_rate[]"]')?.value) || 0;

    const { total_amount: totalAmount } = calculateLineTotals({
      quantity,
      unit_price: unitPrice,
      discount,
      vat_rate: vatRate
    });

    documentTotal = money(documentTotal + totalAmount);
  }

  return documentTotal;
}

function recalculateDisplayedTotal(form) {
  const config = FORM_CONFIG[form.id];
  if (!config) return;

  const display = form.querySelector(config.display);
  if (!display) return;

  const nextValue = calculateCanonicalTotal(form).toFixed(2);
  if (display.textContent !== nextValue) {
    display.textContent = nextValue;
  }
}

async function getSettings() {
  if (!settingsPromise) {
    settingsPromise = settingsApi.getSettings().catch((error) => {
      settingsPromise = null;
      throw error;
    });
  }
  return settingsPromise;
}

function addVatLockNotice(form) {
  if (form.querySelector('[data-accounting-vat-lock]')) return;

  const firstVatInput = form.querySelector('[name="line_vat_rate[]"]');
  if (!firstVatInput) return;

  const notice = document.createElement('div');
  notice.dataset.accountingVatLock = 'true';
  notice.className = 'alert alert-info';
  notice.textContent = 'TVA colectată este 0% deoarece PFA-ul este configurat ca neînregistrat în scopuri de TVA.';

  const linesRoot = firstVatInput.closest('.form-group')?.parentElement?.parentElement;
  if (linesRoot?.parentElement) {
    linesRoot.parentElement.insertBefore(notice, linesRoot);
  } else {
    form.prepend(notice);
  }
}

async function enforceVatStatus(form) {
  const config = FORM_CONFIG[form.id];
  if (!config?.lockOutputVat) return;

  let settings;
  try {
    settings = await getSettings();
  } catch (error) {
    console.warn('Nu am putut verifica statutul TVA pentru formular:', error);
    return;
  }

  if (!settings || String(settings.vat_status || '').toLowerCase() !== 'neinregistrat') {
    return;
  }

  let changed = false;
  form.querySelectorAll('[name="line_vat_rate[]"]').forEach((input) => {
    if (input.value !== '0') {
      input.value = '0';
      changed = true;
    }
    input.disabled = true;
    input.setAttribute('aria-disabled', 'true');
    input.title = 'TVA colectată este blocată la 0% pentru PFA neînregistrat în scopuri de TVA.';
  });

  addVatLockNotice(form);

  if (changed) {
    recalculateDisplayedTotal(form);
  }
}

function applyFormIntegrity() {
  Object.keys(FORM_CONFIG).forEach((formId) => {
    const form = document.getElementById(formId);
    if (!form) return;

    enforceVatStatus(form);
    recalculateDisplayedTotal(form);
  });

}

function scheduleRefundRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshRefundButtons().catch((error) => {
      console.warn('Nu am putut actualiza acțiunile de refund:', error);
    });
  }, 80);
}

async function getRefundedAmounts({ ids, received }) {
  if (!ids.length) return new Map();

  const supabase = await getSupabase();
  const foreignKey = received ? 'received_invoice_id' : 'invoice_id';
  const direction = received ? 'IN' : 'OUT';
  const transactionType = received ? 'REFUND_IN' : 'REFUND_OUT';

  let query = supabase
    .from('transaction_allocations')
    .select(`
      ${foreignKey},
      allocated_amount,
      financial_transactions!inner (
        status,
        direction,
        transaction_type
      )
    `)
    .in(foreignKey, ids)
    .eq('financial_transactions.status', 'CONFIRMED')
    .eq('financial_transactions.direction', direction)
    .eq('financial_transactions.transaction_type', transactionType);

  const { data, error } = await query;
  if (error) throw error;

  const totals = new Map();
  for (const row of data || []) {
    const id = row[foreignKey];
    totals.set(id, money((totals.get(id) || 0) + Number(row.allocated_amount || 0)));
  }

  return totals;
}

function getRowActionContainer(listContainer, id) {
  const buttons = Array.from(listContainer.querySelectorAll('button[data-id]'));
  const anchor = buttons.find((button) => button.dataset.id === id);
  return anchor?.closest('.flex.gap-1') || anchor?.parentElement || null;
}

function appendRefundButton({ listContainer, invoice, remaining, received }) {
  const actions = getRowActionContainer(listContainer, invoice.id);
  if (!actions) return;

  const selector = `[data-accounting-refund="${received ? 'supplier' : 'client'}"][data-id="${invoice.id}"]`;
  if (actions.querySelector(selector)) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-sm btn-outline';
  button.dataset.accountingRefund = received ? 'supplier' : 'client';
  button.dataset.id = invoice.id;
  button.title = received
    ? `Înregistrează refund de la furnizor. Disponibil: ${formatCurrency(remaining, invoice.currency)}`
    : `Înregistrează restituire către client. Disponibil: ${formatCurrency(remaining, invoice.currency)}`;
  button.textContent = received ? 'Refund furnizor' : 'Restituie';

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openRefundModal({ invoice, remaining, received }).catch((error) => {
      showToast(error.message || 'Nu am putut deschide refundul', 'error');
    });
  });

  actions.appendChild(button);
}

async function refreshInvoiceRefundButtons() {
  const listContainer = document.getElementById('invoices-list');
  if (!listContainer) return;

  const ids = [...new Set(
    Array.from(listContainer.querySelectorAll('button[data-id]'))
      .map((button) => button.dataset.id)
      .filter(Boolean)
  )];

  if (!ids.length) return;

  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from('invoices')
    .select('id, series, number, currency, document_status, invoice_type, paid_total')
    .in('id', ids);

  if (error) throw error;

  for (const invoice of data || []) {
    if (['STORNO', 'CORRECTION'].includes(invoice.invoice_type) && invoice.document_status === 'DRAFT') {
      const actions = getRowActionContainer(listContainer, invoice.id);
      actions?.querySelector('button[data-action="edit"]')?.remove();
    }
  }

  const eligible = (data || []).filter((invoice) =>
    ['STORNED', 'CORRECTED', 'VOIDED'].includes(invoice.document_status) &&
    Number(invoice.paid_total || 0) > 0
  );

  if (!eligible.length) return;

  const refunded = await getRefundedAmounts({
    ids: eligible.map((invoice) => invoice.id),
    received: false
  });

  for (const invoice of eligible) {
    const remaining = money(Number(invoice.paid_total || 0) - (refunded.get(invoice.id) || 0));
    if (remaining > 0) {
      appendRefundButton({ listContainer, invoice, remaining, received: false });
    }
  }
}

async function refreshSupplierRefundButtons() {
  const listContainer = document.getElementById('received-invoices-list');
  if (!listContainer) return;

  const ids = [...new Set(
    Array.from(listContainer.querySelectorAll('button[data-id]'))
      .map((button) => button.dataset.id)
      .filter(Boolean)
  )];

  if (!ids.length) return;

  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from('received_invoices')
    .select('id, series, number, currency, document_status, invoice_type, paid_total')
    .in('id', ids);

  if (error) throw error;

  const eligible = (data || []).filter((invoice) =>
    invoice.document_status === 'CANCELLED' &&
    invoice.invoice_type === 'NORMAL' &&
    Number(invoice.paid_total || 0) > 0
  );

  if (!eligible.length) return;

  const refunded = await getRefundedAmounts({
    ids: eligible.map((invoice) => invoice.id),
    received: true
  });

  for (const invoice of eligible) {
    const remaining = money(Number(invoice.paid_total || 0) - (refunded.get(invoice.id) || 0));
    if (remaining > 0) {
      appendRefundButton({ listContainer, invoice, remaining, received: true });
    }
  }
}

async function refreshRefundButtons() {
  if (refundRefreshRunning) return;
  refundRefreshRunning = true;

  try {
    if (window.location.hash === '#/invoices') {
      await refreshInvoiceRefundButtons();
    } else if (window.location.hash === '#/received-invoices') {
      await refreshSupplierRefundButtons();
    }
  } finally {
    refundRefreshRunning = false;
  }
}

function getAccountLabel(account) {
  const bank = account.bank_name || account.bank || account.name || 'Cont';
  const iban = account.iban ? ` — ${account.iban}` : '';
  return `${bank}${iban}`;
}

async function openRefundModal({ invoice, remaining, received }) {
  const accounts = await bankAccountsApi.list();
  const defaultAccount = (accounts || []).find((account) => account.is_default) || null;
  const title = received ? 'Refund primit de la furnizor' : 'Restituire către client';
  const rpcName = received ? 'register_supplier_refund' : 'register_invoice_refund';
  const idParam = received ? 'p_received_invoice_id' : 'p_invoice_id';

  const accountOptions = (accounts || []).map((account) =>
    `<option value="${escapeHtml(account.id)}" ${defaultAccount?.id === account.id ? 'selected' : ''}>${escapeHtml(getAccountLabel(account))}</option>`
  ).join('');

  const content = `
    <div class="alert alert-info">
      Suma maximă disponibilă pentru ${received ? 'recuperare' : 'restituire'} este
      <strong>${escapeHtml(formatCurrency(remaining, invoice.currency))}</strong>.
      Operațiunea financiară se înregistrează separat de documentul storno.
    </div>
    <form id="accounting-refund-form">
      <div class="form-row">
        <div class="form-group">
          <label>Sumă *</label>
          <input type="number" name="amount" min="0.01" step="0.01" max="${remaining.toFixed(2)}" value="${remaining.toFixed(2)}" required>
        </div>
        <div class="form-group">
          <label>Data *</label>
          <input type="date" name="transaction_date" value="${toInputDate(new Date())}" required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Metodă</label>
          <select name="payment_method">
            <option value="BANK">Transfer bancar</option>
            <option value="CARD">Card</option>
            <option value="CASH">Numerar</option>
            <option value="OTHER">Altă metodă</option>
          </select>
        </div>
        <div class="form-group">
          <label>Cont bancar</label>
          <select name="bank_account_id">
            <option value="">Fără cont selectat</option>
            ${accountOptions}
          </select>
        </div>
      </div>
      ${fxFieldsHtml(invoice.currency)}
      <div class="form-group">
        <label>Observații</label>
        <textarea name="notes" rows="3" placeholder="${received ? 'Refund primit de la furnizor' : 'Restituire către client'}"></textarea>
      </div>
      <div class="flex gap-1 mt-2">
        <button type="submit" class="btn btn-primary">${received ? 'Înregistrează refund' : 'Înregistrează restituirea'}</button>
        <button type="button" class="btn btn-outline" id="accounting-refund-cancel">Anulează</button>
      </div>
    </form>
  `;

  const { modalElement, close } = createModal({ title, content, size: 'md' });
  const form = modalElement.querySelector('#accounting-refund-form');
  bindFxPreview(form);
  const cancel = modalElement.querySelector('#accounting-refund-cancel');

  cancel?.addEventListener('click', () => close());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;

    try {
      const values = new FormData(form);
      const amount = money(values.get('amount'));

      if (amount <= 0 || amount > remaining) {
        throw new Error(`Suma trebuie să fie între 0,01 și ${remaining.toFixed(2)}.`);
      }

      const supabase = await getSupabase();
      const params = {
        [idParam]: invoice.id,
        p_amount: amount,
        p_transaction_date: values.get('transaction_date'),
        p_payment_method: values.get('payment_method'),
        p_bank_account_id: values.get('bank_account_id') || null,
        p_notes: values.get('notes')?.trim() || null,
        p_idempotency_key: generateIdempotencyKey()
      };
      const fx = readFxParams(values, invoice.currency);
      Object.assign(params, {
        p_exchange_rate: fx.exchangeRate ?? null, p_exchange_rate_date: fx.exchangeRateDate ?? null,
        p_exchange_rate_source: fx.exchangeRateSource ?? null, p_bank_amount_ron: fx.bankAmountRon ?? null,
        p_bank_settlement_amount: fx.bankSettlementAmount ?? null, p_bank_settlement_currency: fx.bankSettlementCurrency ?? null,
        p_bank_fee_ron: fx.bankFeeRon ?? 0, p_fx_fiscal_treatment: fx.fxFiscalTreatment ?? null
      });

      const { data, error } = await supabase.rpc(rpcName, params);
      if (error) throw error;

      showToast(
        received
          ? `Refund înregistrat: ${formatCurrency(data.amount, invoice.currency)}`
          : `Restituire înregistrată: ${formatCurrency(data.amount, invoice.currency)}`,
        'success'
      );

      await close();
      window.dispatchEvent(new Event('hashchange'));
      scheduleRefundRefresh();
    } catch (error) {
      showToast(error.message || 'Înregistrarea refundului a eșuat', 'error');
      if (submit) submit.disabled = false;
    }
  });
}

async function interceptInvoiceStorno(event) {
  if (window.location.hash !== '#/invoices') return;

  const button = event.target.closest('button[data-action="storno"]');
  if (!button) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const invoiceId = button.dataset.id;
  if (!invoiceId) return;

  const confirmed = await confirmDialog(
    'Se va crea o ciornă storno. Factura originală va fi marcată ca stornată numai când documentul storno este emis. Încasările rămân în istoric; restituirea banilor se înregistrează separat. Continui?',
    { danger: true }
  );

  if (!confirmed) return;

  try {
    button.disabled = true;
    const supabase = await getSupabase();
    const { data, error } = await supabase.rpc('create_storno_invoice', {
      p_original_invoice_id: invoiceId,
      p_storno_type: 'STORNO'
    });

    if (error) throw error;

    showToast(`Ciornă storno creată. Emite documentul pentru a finaliza corecția.`, 'success');
    window.dispatchEvent(new Event('hashchange'));
  } catch (error) {
    showToast(error.message || 'Nu am putut crea storno-ul', 'error');
  } finally {
    button.disabled = false;
    scheduleRefundRefresh();
  }
}

function addReceivedStornoNotice() {
  if (window.location.hash !== '#/received-invoices') return;

  const form = document.getElementById('storno-form');
  if (!form || form.querySelector('[data-accounting-storno-refund-note]')) return;

  const note = document.createElement('div');
  note.className = 'alert alert-info';
  note.dataset.accountingStornoRefundNote = 'true';
  note.textContent = 'Storno-ul nu înregistrează automat restituirea banilor. Dacă furnizorul îți returnează o sumă deja plătită, vei avea separat acțiunea „Refund furnizor”.';

  form.prepend(note);
}

function handleDocumentInput(event) {
  const form = event.target.closest('#invoice-form, #proforma-form, #received-invoice-form');
  if (!form) return;

  queueMicrotask(() => {
    enforceVatStatus(form);
    recalculateDisplayedTotal(form);
  });
}

function handleMutations() {
  applyFormIntegrity();
  addReceivedStornoNotice();
  scheduleRefundRefresh();
}

export function initAccountingIntegrity() {
  if (initialized) return;
  initialized = true;

  document.addEventListener('input', handleDocumentInput);
  document.addEventListener('change', handleDocumentInput);
  document.addEventListener('click', interceptInvoiceStorno, true);

  const observer = new MutationObserver(handleMutations);
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  window.addEventListener('hashchange', () => {
    // Reîncarcă statutul TVA după navigare, inclusiv după modificarea setărilor PFA.
    settingsPromise = null;
    applyFormIntegrity();
    scheduleRefundRefresh();
  });

  handleMutations();
}
