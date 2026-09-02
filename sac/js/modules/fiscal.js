// js/modules/fiscal.js
// Modul Situație fiscală – Registrul de evidență fiscală (REF) și sinteză pentru Declarația unică
// Afișează rezumatul anual și lunar al veniturilor/cheltuielilor fiscale,
// excluzând aporturile/retragerile titularului din calculul fiscal.
// Fix: formatare corectă a valorilor null pentru procent/limită deductibilitate.

import { fiscalApi } from '../api.js';
import { formatCurrency, formatDate, showToast, escapeHtml } from '../utils.js';
import { renderSkeleton, renderEmptyState, renderTable } from '../ui.js';
import { exportToCsv } from '../services/export-service.js';

let currentYear = new Date().getFullYear();
let summaryData = null;
let monthlyData = [];

function formatPercent(value) {
  if (value === null || value === undefined || value === '') return '-';
  return `${value}%`;
}

function formatLimit(value) {
  if (value === null || value === undefined || value === '') return '-';
  return formatCurrency(value, 'RON');
}

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-heading"><h2>Situație fiscală</h2><p>Estimarea anuală a veniturilor, cheltuielilor deductibile și venitului net fiscal.</p></div>
      <div class="fiscal-actions">
        <label for="fiscal-year">An fiscal</label>
        <select id="fiscal-year" class="btn btn-outline btn-sm"></select>
        <button class="btn btn-primary btn-sm" id="apply-fiscal-year" title="Afișează situația pentru anul selectat">Afișează</button>
        <button class="btn btn-outline btn-sm" id="print-fiscal" title="Tipărește situația">▧ Tipărire / PDF</button>
      </div>
    </div>
    <div id="fiscal-content"></div>
  `;

  const yearSelect = document.getElementById('fiscal-year');
  const todayYear = new Date().getFullYear();
  for (let y = todayYear - 2; y <= todayYear + 1; y++) {
    const option = document.createElement('option');
    option.value = y;
    option.textContent = y;
    if (y === currentYear) option.selected = true;
    yearSelect.appendChild(option);
  }

  document.getElementById('apply-fiscal-year').addEventListener('click', async () => {
    currentYear = parseInt(yearSelect.value, 10);
    await loadFiscalData();
  });

  document.getElementById('print-fiscal').addEventListener('click', printFiscal);

  await loadFiscalData();
}

export function destroy() {}

async function loadFiscalData() {
  const content = document.getElementById('fiscal-content');
  if (!content) return;

  content.innerHTML = renderSkeleton(6);

  try {
    const [summary, monthly] = await Promise.all([
      fiscalApi.getSummary(currentYear),
      fiscalApi.getMonthlySummary(currentYear)
    ]);

    summaryData = summary;
    monthlyData = monthly || [];

    renderFiscalContent(content);
  } catch (error) {
    console.error('Eroare la încărcarea situației fiscale:', error);
    content.innerHTML = `<div class="alert alert-error">${escapeHtml(error.message || 'Nu am putut încărca situația fiscală')}</div>`;
  }
}

function renderFiscalContent(container) {
  if (!summaryData) {
    container.innerHTML = renderEmptyState('Nu există date fiscale pentru anul selectat.');
    return;
  }

  const s = summaryData;
  const netIncome = parseFloat(s.net_income) || 0;
  const income = parseFloat(s.income) || 0;
  const deductible = parseFloat(s.deductible_expenses) || 0;
  const nonDeductible = parseFloat(s.non_deductible_expenses) || 0;
  const ownerContrib = parseFloat(s.owner_contributions) || 0;
  const ownerWithdraw = parseFloat(s.owner_withdrawals) || 0;
  const cashMovements = parseFloat(s.cash_movements) || 0;

  const headers = [
    { label: 'Luna', key: 'month' },
    { label: 'Venituri', key: 'income', align: 'right' },
    { label: 'Cheltuieli deductibile', key: 'deductible', align: 'right' },
    { label: 'Cheltuieli nedeductibile', key: 'non_deductible', align: 'right' },
    { label: 'Aporturi', key: 'contributions', align: 'right' },
    { label: 'Retrageri', key: 'withdrawals', align: 'right' }
  ];

  const rows = monthlyData.map(m => ({
    month: formatDate(m.month_start) + ' - ' + m.year,
    income: formatCurrency(m.income, 'RON'),
    deductible: formatCurrency(m.deductible_expenses, 'RON'),
    non_deductible: formatCurrency(m.non_deductible_expenses, 'RON'),
    contributions: formatCurrency(m.owner_contributions, 'RON'),
    withdrawals: formatCurrency(m.owner_withdrawals, 'RON')
  }));

  container.innerHTML = `
    <div class="dashboard-section-heading">
      <div><span class="card-eyebrow">Rezumat fiscal</span><h3>Anul ${currentYear}</h3></div>
      <span class="section-hint">Calcul bazat pe operațiunile confirmate</span>
    </div>
    <div class="stat-grid">
      <div class="stat-card">
        <span class="stat-label">Venituri ${currentYear}</span>
        <span class="stat-value" style="color: var(--color-success)">${formatCurrency(income, 'RON')}</span>
        <span class="stat-help">Venituri fiscale înregistrate</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Cheltuieli deductibile</span>
        <span class="stat-value" style="color: var(--color-danger)">${formatCurrency(deductible, 'RON')}</span>
        <span class="stat-help">Reduc baza de calcul fiscală</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Cheltuieli nedeductibile</span>
        <span class="stat-value">${formatCurrency(nonDeductible, 'RON')}</span>
        <span class="stat-help">Nu reduc venitul impozabil</span>
      </div>
      <div class="stat-card highlight">
        <span class="stat-label">Venit net estimat</span>
        <span class="stat-value" style="color: ${netIncome >= 0 ? 'var(--color-success)' : 'var(--color-danger)'}">${formatCurrency(netIncome, 'RON')}</span>
        <span class="stat-help">Venituri minus cheltuieli deductibile</span>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <span class="stat-label">Aporturi titular</span>
        <span class="stat-value" style="color: var(--color-info)">${formatCurrency(ownerContrib, 'RON')}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Retrageri titular</span>
        <span class="stat-value" style="color: var(--color-warning)">${formatCurrency(ownerWithdraw, 'RON')}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Mișcări numerar (nefiscale)</span>
        <span class="stat-value">${formatCurrency(cashMovements, 'RON')}</span>
      </div>
    </div>

    <div class="alert alert-info">
      <strong>Notă:</strong> Aporturile și retragerile titularului nu sunt incluse în calculul venitului net fiscal.
    </div>

    <div class="card">
      <div class="card-header">
        <div><span class="card-eyebrow">Evoluție</span><h3>Evidență lunară</h3></div>
        <button class="btn btn-outline btn-sm" id="export-fiscal-csv" title="Exportă CSV">↓ Export CSV</button>
      </div>
      ${renderTable(headers, rows, { emptyMessage: 'Nu există date lunare' })}
    </div>
  `;

  document.getElementById('export-fiscal-csv').addEventListener('click', () => {
    exportFiscalCsv(headers, rows);
  });
}

function exportFiscalCsv(headers, rows) {
  if (!rows || rows.length === 0) {
    showToast('Nu există date pentru export', 'warning');
    return;
  }

  exportToCsv(`situatie_fiscala_${currentYear}`, headers, rows);
}

function printFiscal() {
  const content = document.getElementById('fiscal-content');
  if (!content || !summaryData) return;

  const printWindow = window.open('', '_blank', 'width=900,height=600');
  if (!printWindow) {
    showToast('Pop-up blocat. Permite pop-up-uri pentru a printa.', 'warning');
    return;
  }

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Situație fiscală ${currentYear}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 12px; margin: 20px; }
        h1 { text-align: center; font-size: 18px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { border: 1px solid #ccc; padding: 6px; text-align: left; }
        th { background-color: #f5f5f5; }
        .summary { display: flex; justify-content: space-around; margin: 10px 0; flex-wrap: wrap; }
        .summary div { margin: 5px; }
      </style>
    </head>
    <body>
      <h1>Situație fiscală ${currentYear}</h1>
      <div class="summary">
        <div>Venituri: <strong>${formatCurrency(summaryData.income, 'RON')}</strong></div>
        <div>Cheltuieli deductibile: <strong>${formatCurrency(summaryData.deductible_expenses, 'RON')}</strong></div>
        <div>Venit net: <strong>${formatCurrency(summaryData.net_income, 'RON')}</strong></div>
      </div>
      ${content.querySelector('.card')?.outerHTML || ''}
    </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 500);
}
