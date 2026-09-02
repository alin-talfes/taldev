// js/modules/rjip.js
// Modul Registrul-jurnal de încasări și plăți (RJIP)
// Fix: folosește view-ul corectat cu status CONFIRMED,
// afișează corect tipurile noi de tranzacții și include referințe agregate.

import { reportsApi } from '../api.js';
import { formatCurrency, formatDate, toInputDate, showToast, escapeHtml } from '../utils.js';
import { renderStatusBadge, renderTable, renderSkeleton, renderEmptyState } from '../ui.js';
import { escapeCsvCell } from '../services/export-service.js';

let currentRjipData = [];
let filters = {
  period: 'month',
  fromDate: '',
  toDate: '',
  direction: 'all',
  paymentMethod: 'all',
  currency: 'all',
  search: ''
};

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-heading"><h2>Registrul-jurnal de încasări și plăți</h2><p>Consultă cronologic toate încasările și plățile confirmate din activitatea PFA.</p></div>
      <div class="flex gap-1">
        <button class="btn btn-outline btn-sm" id="rjip-print" title="Printează registrul">▧ Printare / PDF</button>
        <button class="btn btn-outline btn-sm" id="rjip-csv" title="Exportă ca CSV">↓ Export CSV</button>
      </div>
    </div>
    <div class="card filter-card rjip-filter-card">
      <div class="filter-card-heading"><div><span class="card-eyebrow">Perioadă și criterii</span><h3>Filtrează registrul</h3></div><button class="btn-link clear-filters" id="rjip-reset-filters" type="button">Resetează filtrele</button></div>
      <div class="filters-row">
        <div class="form-group">
          <label>Perioadă</label>
          <select id="rjip-period">
            <option value="today" ${filters.period === 'today' ? 'selected' : ''}>Azi</option>
            <option value="week" ${filters.period === 'week' ? 'selected' : ''}>Săptămâna aceasta</option>
            <option value="month" ${filters.period === 'month' ? 'selected' : ''}>Luna aceasta</option>
            <option value="year" ${filters.period === 'year' ? 'selected' : ''}>Anul acesta</option>
            <option value="custom" ${filters.period === 'custom' ? 'selected' : ''}>Interval personalizat</option>
          </select>
        </div>
        <div class="form-group" id="rjip-from-date-group" style="${filters.period !== 'custom' ? 'display:none;' : ''}">
          <label>De la</label>
          <input type="date" id="rjip-from-date" value="${filters.fromDate}">
        </div>
        <div class="form-group" id="rjip-to-date-group" style="${filters.period !== 'custom' ? 'display:none;' : ''}">
          <label>Până la</label>
          <input type="date" id="rjip-to-date" value="${filters.toDate}">
        </div>
        <div class="form-group">
          <label>Direcție</label>
          <select id="rjip-direction">
            <option value="all" ${filters.direction === 'all' ? 'selected' : ''}>Toate</option>
            <option value="IN" ${filters.direction === 'IN' ? 'selected' : ''}>Încasări</option>
            <option value="OUT" ${filters.direction === 'OUT' ? 'selected' : ''}>Plăți</option>
          </select>
        </div>
        <div class="form-group">
          <label>Metodă plată</label>
          <select id="rjip-payment-method">
            <option value="all" ${filters.paymentMethod === 'all' ? 'selected' : ''}>Toate</option>
            <option value="BANK" ${filters.paymentMethod === 'BANK' ? 'selected' : ''}>Bancă</option>
            <option value="CASH" ${filters.paymentMethod === 'CASH' ? 'selected' : ''}>Numerar</option>
            <option value="CARD" ${filters.paymentMethod === 'CARD' ? 'selected' : ''}>Card</option>
            <option value="OTHER" ${filters.paymentMethod === 'OTHER' ? 'selected' : ''}>Alta</option>
          </select>
        </div>
        <div class="form-group">
          <label>Monedă</label>
          <select id="rjip-currency">
            <option value="all" ${filters.currency === 'all' ? 'selected' : ''}>Toate</option>
            <option value="RON" ${filters.currency === 'RON' ? 'selected' : ''}>RON</option>
            <option value="EUR" ${filters.currency === 'EUR' ? 'selected' : ''}>EUR</option>
            <option value="USD" ${filters.currency === 'USD' ? 'selected' : ''}>USD</option>
          </select>
        </div>
        <div class="form-group">
          <label for="rjip-search">Descriere, partener sau document</label>
          <input type="search" id="rjip-search" placeholder="Caută în registru..." value="${escapeHtml(filters.search)}">
        </div>
        <div class="form-group">
          <label class="filter-action-label" aria-hidden="true">Aplică</label>
          <button class="btn btn-outline" id="rjip-apply-filters" title="Aplică filtrele">Aplică filtrele</button>
        </div>
      </div>
    </div>
    <div id="rjip-content"></div>
  `;

  document.getElementById('rjip-period').addEventListener('change', (e) => {
    filters.period = e.target.value;
    const fromGroup = document.getElementById('rjip-from-date-group');
    const toGroup = document.getElementById('rjip-to-date-group');
    if (filters.period === 'custom') {
      fromGroup.style.display = '';
      toGroup.style.display = '';
    } else {
      fromGroup.style.display = 'none';
      toGroup.style.display = 'none';
      const { from, to } = getDateRangeForPeriod(filters.period);
      filters.fromDate = toInputDate(from);
      filters.toDate = toInputDate(to);
    }
  });

  document.getElementById('rjip-reset-filters').addEventListener('click', () => {
    filters = { period: 'month', fromDate: '', toDate: '', direction: 'all', paymentMethod: 'all', currency: 'all', search: '' };
    render(container);
  });

  document.getElementById('rjip-apply-filters').addEventListener('click', () => {
    filters.direction = document.getElementById('rjip-direction').value;
    filters.paymentMethod = document.getElementById('rjip-payment-method').value;
    filters.currency = document.getElementById('rjip-currency').value;
    filters.search = document.getElementById('rjip-search').value.trim();
    if (filters.period === 'custom') {
      filters.fromDate = document.getElementById('rjip-from-date').value;
      filters.toDate = document.getElementById('rjip-to-date').value;
    } else {
      const { from, to } = getDateRangeForPeriod(filters.period);
      filters.fromDate = toInputDate(from);
      filters.toDate = toInputDate(to);
    }
    loadRjipData();
  });

  document.getElementById('rjip-print').addEventListener('click', () => {
    printRjip();
  });

  document.getElementById('rjip-csv').addEventListener('click', () => {
    exportCsv();
  });

  const { from, to } = getDateRangeForPeriod(filters.period);
  filters.fromDate = toInputDate(from);
  filters.toDate = toInputDate(to);
  await loadRjipData();
}

export function destroy() {}

function getDateRangeForPeriod(period) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let from, to;

  switch (period) {
    case 'today':
      from = today;
      to = today;
      break;
    case 'week': {
      const day = today.getDay();
      const diff = day === 0 ? 6 : day - 1;
      from = new Date(today);
      from.setDate(today.getDate() - diff);
      to = new Date(today);
      to.setDate(from.getDate() + 6);
      break;
    }
    case 'month':
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      break;
    case 'year':
      from = new Date(now.getFullYear(), 0, 1);
      to = new Date(now.getFullYear(), 11, 31);
      break;
    default:
      from = today;
      to = today;
  }
  return { from, to };
}

async function loadRjipData() {
  const content = document.getElementById('rjip-content');
  if (!content) return;

  content.innerHTML = renderSkeleton(5);

  try {
    const data = await reportsApi.getRjip({
      fromDate: filters.fromDate,
      toDate: filters.toDate,
      direction: filters.direction
    });

    let filtered = data || [];
    if (filters.paymentMethod !== 'all') {
      filtered = filtered.filter(tx => tx.payment_method === filters.paymentMethod);
    }
    if (filters.currency !== 'all') {
      filtered = filtered.filter(tx => (tx.original_currency || tx.currency) === filters.currency);
    }
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filtered = filtered.filter(tx => 
        (tx.description && tx.description.toLowerCase().includes(searchLower)) ||
        (tx.counterparty_name && tx.counterparty_name.toLowerCase().includes(searchLower)) ||
        (tx.reference && tx.reference.toLowerCase().includes(searchLower)) ||
        (tx.counterparty_name_resolved && tx.counterparty_name_resolved.toLowerCase().includes(searchLower))
      );
    }

    currentRjipData = filtered;
    renderRjipTable(content);
  } catch (error) {
    console.error('Eroare la încărcarea RJIP:', error);
    content.innerHTML = `<div class="alert alert-error">${escapeHtml(error.message || 'Nu am putut încărca registrul')}</div>`;
  }
}

function renderRjipTable(container) {
  if (!currentRjipData || currentRjipData.length === 0) {
    container.innerHTML = renderEmptyState('Nu există înregistrări în perioada selectată.');
    return;
  }

  const totalIn = currentRjipData.filter(tx => tx.direction === 'IN').reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0);
  const totalOut = currentRjipData.filter(tx => tx.direction === 'OUT').reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0);
  const net = totalIn - totalOut;

  const headers = [
    { label: 'Data', key: 'transaction_date' },
    { label: 'Tip', key: 'transaction_type' },
    { label: 'Descriere', key: 'description' },
    { label: 'Partener', key: 'counterparty_name_resolved' },
    { label: 'Document', key: 'document_ref' },
    { label: 'Metodă', key: 'payment_method' },
    { label: 'Cont bancar', key: 'bank' },
    { label: 'Încasări (IN)', key: 'amount_in', align: 'right' },
    { label: 'Plăți (OUT)', key: 'amount_out', align: 'right' }
  ];

  const rows = currentRjipData.map(tx => {
    const isIn = tx.direction === 'IN';
    const docRef = tx.invoice_series && tx.invoice_number 
      ? `Factura ${tx.invoice_series}-${tx.invoice_number}` 
      : (tx.received_invoice_series && tx.received_invoice_number 
        ? `Factura primită ${tx.received_invoice_series}-${tx.received_invoice_number}` 
        : tx.reference || '-');
    return {
      transaction_date: formatDate(tx.transaction_date),
      transaction_type: renderStatusBadge(tx.transaction_type),
      description: `${tx.description || '-'}${tx.fx_explanation ? `<br><small>${escapeHtml(tx.fx_explanation)}</small>` : ''}`,
      counterparty_name_resolved: tx.counterparty_name_resolved || tx.counterparty_name || '-',
      document_ref: docRef,
      payment_method: tx.payment_method,
      bank: tx.bank_name ? `${tx.bank_name}${tx.iban ? ' ' + tx.iban : ''}` : '-',
      amount_in: isIn ? formatCurrency(tx.amount, tx.currency) : '',
      amount_out: !isIn ? formatCurrency(tx.amount, tx.currency) : ''
    };
  });

  let html = `
    <div class="card mb-2">
      <div class="grid">
        <div class="stat-card"><span class="stat-label">Total încasări</span><span class="stat-value" style="color:var(--color-success)">${formatCurrency(totalIn, 'RON')}</span></div>
        <div class="stat-card"><span class="stat-label">Total plăți</span><span class="stat-value" style="color:var(--color-danger)">${formatCurrency(totalOut, 'RON')}</span></div>
        <div class="stat-card"><span class="stat-label">Sold</span><span class="stat-value" style="color:${net >= 0 ? 'var(--color-success)' : 'var(--color-danger)'}">${formatCurrency(net, 'RON')}</span></div>
      </div>
    </div>
  `;

  html += `<div class="list-summary"><span><strong>${currentRjipData.length}</strong> ${currentRjipData.length === 1 ? 'înregistrare' : 'înregistrări'} în perioada selectată</span><span>${formatDate(filters.fromDate)} – ${formatDate(filters.toDate)}</span></div>`;
  html += renderTable(headers, rows, { emptyMessage: 'Nu există înregistrări', rawColumns: ['transaction_type', 'description'] });
  container.innerHTML = html;
}

function exportCsv() {
  if (!currentRjipData || currentRjipData.length === 0) {
    showToast('Nu există date pentru export', 'warning');
    return;
  }

  const headers = ['Data', 'Tip', 'Descriere', 'Partener', 'Document', 'Metodă', 'Cont bancar', 'Încasări RON', 'Plăți RON', 'Monedă document', 'Sumă valută', 'Curs', 'Data curs', 'Sursă', 'Sumă bancară RON', 'Diferență FX RON', 'Comision RON'];
  const rows = currentRjipData.map(tx => {
    const isIn = tx.direction === 'IN';
    return [
      formatDate(tx.transaction_date),
      tx.transaction_type,
      tx.description || '',
      tx.counterparty_name_resolved || tx.counterparty_name || '',
      tx.invoice_series && tx.invoice_number ? `Factura ${tx.invoice_series}-${tx.invoice_number}` : (tx.received_invoice_series && tx.received_invoice_number ? `Factura primită ${tx.received_invoice_series}-${tx.received_invoice_number}` : tx.reference || ''),
      tx.payment_method,
      tx.bank_name ? `${tx.bank_name} ${tx.iban || ''}` : '',
      isIn ? tx.amount : '',
      !isIn ? tx.amount : '',
      tx.original_currency || tx.currency,
      tx.original_amount || '', tx.exchange_rate || '', tx.exchange_rate_date || '', tx.fx_source || '',
      tx.bank_amount_ron || '', tx.fx_difference_ron || '', tx.bank_fee_ron || ''
    ];
  });

  const csvContent = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map(row => row.map(escapeCsvCell).join(','))
  ].join('\n');

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `RJIP_${filters.fromDate}_${filters.toDate}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Export CSV realizat', 'success');
}

function printRjip() {
  if (!currentRjipData || currentRjipData.length === 0) {
    showToast('Nu există date pentru printare', 'warning');
    return;
  }

  const printWindow = window.open('', '_blank', 'width=900,height=600');
  if (!printWindow) {
    showToast('Pop-up blocat. Permite pop-up-uri pentru a printa.', 'warning');
    return;
  }

  const totalIn = currentRjipData.filter(tx => tx.direction === 'IN').reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0);
  const totalOut = currentRjipData.filter(tx => tx.direction === 'OUT').reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0);

  const rowsHtml = currentRjipData.map(tx => {
    const isIn = tx.direction === 'IN';
    const docRef = tx.invoice_series && tx.invoice_number 
      ? `Factura ${tx.invoice_series}-${tx.invoice_number}` 
      : (tx.received_invoice_series && tx.received_invoice_number 
        ? `Factura primită ${tx.received_invoice_series}-${tx.received_invoice_number}` 
        : tx.reference || '');
    return `<tr>
      <td>${formatDate(tx.transaction_date)}</td>
      <td>${tx.transaction_type}</td>
      <td>${escapeHtml(tx.description || '')}</td>
      <td>${escapeHtml(tx.counterparty_name_resolved || '')}</td>
      <td>${escapeHtml(docRef)}</td>
      <td>${tx.payment_method}</td>
      <td style="text-align:right">${isIn ? formatCurrency(tx.amount, tx.currency) : ''}</td>
      <td style="text-align:right">${!isIn ? formatCurrency(tx.amount, tx.currency) : ''}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html><head><title>RJIP ${filters.fromDate} - ${filters.toDate}</title>
<style>
body { font-family: Arial, sans-serif; font-size: 12px; margin: 20px; }
h1 { font-size: 18px; text-align: center; }
table { width: 100%; border-collapse: collapse; margin-top: 10px; }
th, td { border: 1px solid #ccc; padding: 6px; text-align: left; }
th { background-color: #f5f5f5; }
.text-right { text-align: right; }
.summary { display: flex; justify-content: space-around; margin: 10px 0; }
</style></head><body>
<h1>Registrul-jurnal de încasări și plăți</h1>
<p>Perioada: ${formatDate(filters.fromDate)} - ${formatDate(filters.toDate)}</p>
<div class="summary">
<div>Total încasări: <strong>${formatCurrency(totalIn, 'RON')}</strong></div>
<div>Total plăți: <strong>${formatCurrency(totalOut, 'RON')}</strong></div>
<div>Sold: <strong>${formatCurrency(totalIn - totalOut, 'RON')}</strong></div>
</div>
<table>
<thead><tr>
<th>Data</th><th>Tip</th><th>Descriere</th><th>Partener</th><th>Document</th><th>Metodă</th><th class="text-right">Încasări</th><th class="text-right">Plăți</th>
</tr></thead>
<tbody>${rowsHtml}</tbody>
</table>
</body></html>`;

  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
  }, 500);
}
