// js/modules/dashboard.js
// Modul Dashboard – sumar financiar și patrimonial, alerte mijloace fixe
// UX îmbunătățit: skeleton loading, empty states prietenoase
// Fix: excluderea tranzacțiilor anulate, a facturilor primite stornate/anulate,
// și a operațiunilor cu titularul din calculele operaționale.

import { reportsApi, transactionsApi, invoicesApi, receivedInvoicesApi, fixedAssetsApi } from '../api.js';
import {
  formatCurrency,
  formatCurrencyTotals,
  formatDate,
  escapeHtml,
  totalsByCurrency,
  transactionCashAmountRon
} from '../utils.js';
import { renderStatusBadge, renderSkeleton, renderEmptyState } from '../ui.js';

let currentData = {
  monthlyCashflow: [],
  overdueInvoices: [],
  recentTransactions: [],
  unpaidIssued: [],
  unpaidReceived: [],
  fixedAssets: []
};

export async function render(container) {
  const periodLabel = new Intl.DateTimeFormat('ro-RO', { month: 'long', year: 'numeric' }).format(new Date());
  container.innerHTML = `
    <div class="page-header dashboard-page-header">
      <div class="page-heading">
        <h2>Meniu principal</h2>
        <p>O privire rapidă asupra activității PFA și a lucrurilor care necesită atenție.</p>
      </div>
      <div class="dashboard-header-actions">
        <span class="period-chip"><span class="period-dot"></span>${periodLabel}</span>
        <button class="btn btn-outline btn-sm" id="refresh-dashboard" title="Actualizează datele">↻ Actualizează</button>
      </div>
    </div>
    <nav class="quick-actions" aria-label="Acțiuni rapide">
      <a class="quick-action quick-action-primary" href="#/invoices"><span aria-hidden="true">＋</span><span><strong>Factură nouă</strong><small>Emite o factură</small></span></a>
      <a class="quick-action" href="#/other-operations"><span aria-hidden="true">↕</span><span><strong>Operațiune nouă</strong><small>Încasare sau cheltuială</small></span></a>
      <a class="quick-action" href="#/clients"><span aria-hidden="true">◎</span><span><strong>Client nou</strong><small>Adaugă un partener</small></span></a>
      <a class="quick-action" href="#/reports"><span aria-hidden="true">▥</span><span><strong>Vezi rapoarte</strong><small>Analizează activitatea</small></span></a>
    </nav>
    <div id="dashboard-content">
      ${renderSkeleton(6)}
    </div>
  `;

  document.getElementById('refresh-dashboard').addEventListener('click', loadData);

  await loadData();
}

export function destroy() {
  // Nu avem resurse de curățat
}

async function loadData() {
  const content = document.getElementById('dashboard-content');
  if (!content) return;

  content.innerHTML = renderSkeleton(6);

  try {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    const [overdueInvoicesResult, recentTransactionsResult, unpaidIssuedResult, unpaidReceivedResult, fixedAssetsResult] =
      await Promise.allSettled([
        reportsApi.getOverdueInvoices(),
        transactionsApi.list({ status: 'CONFIRMED' }),
        invoicesApi.list({ status: 'ISSUED', page: 1, pageSize: 1000 }),
        receivedInvoicesApi.list({}),
        fixedAssetsApi.list()
      ]);

    const overdueInvoices = overdueInvoicesResult.status === 'fulfilled' ? overdueInvoicesResult.value : [];
    const allTransactions = recentTransactionsResult.status === 'fulfilled' ? recentTransactionsResult.value : [];
    const unpaidIssuedData = unpaidIssuedResult.status === 'fulfilled' ? unpaidIssuedResult.value : { data: [], count: 0 };
    const unpaidReceivedAll = unpaidReceivedResult.status === 'fulfilled' ? unpaidReceivedResult.value : [];
    const fixedAssets = fixedAssetsResult.status === 'fulfilled' ? fixedAssetsResult.value : [];

    // Excludem facturile primite anulate (CANCELLED) și cele de tip storno/corecție
    const unpaidReceived = (Array.isArray(unpaidReceivedAll) ? unpaidReceivedAll : [])
      .filter(inv => inv.document_status !== 'CANCELLED')
      .filter(inv => !['STORNO', 'CORRECTION'].includes(inv.invoice_type))
      .filter(inv => ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'].includes(inv.payment_status));

    // Excludem operațiunile cu titularul (aport/restituire aport) din totalurile operaționale
    const operationalTransactions = (Array.isArray(allTransactions) ? allTransactions : [])
      .filter(tx => tx.status === 'CONFIRMED')
      .filter(tx => !['OWN_CONTRIBUTION', 'OWN_CONTRIBUTION_RETURN'].includes(tx.transaction_type));

    // Calculăm totalurile lunii curente din tranzacțiile operaționale
    const currentMonthTransactions = operationalTransactions.filter(tx => {
      const txDate = new Date(tx.transaction_date);
      return txDate.getFullYear() === currentYear && (txDate.getMonth() + 1) === currentMonth;
    });

    const totalIn = currentMonthTransactions
      .filter(tx => tx.direction === 'IN')
      .reduce((sum, tx) => sum + (transactionCashAmountRon(tx) || 0), 0);

    const totalOut = currentMonthTransactions
      .filter(tx => tx.direction === 'OUT')
      .reduce((sum, tx) => sum + (transactionCashAmountRon(tx) || 0), 0);

    const netCashflow = totalIn - totalOut;

    // Ultimele tranzacții afișate (doar confirmate)
    const recentTransactions = operationalTransactions.slice(0, 10);

    const unpaidIssued = (Array.isArray(unpaidIssuedData.data) ? unpaidIssuedData.data : [])
      .filter(inv => ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'].includes(inv.payment_status));
    const unpaidIssuedCount = unpaidIssued.length;
    const unpaidIssuedTotal = formatCurrencyTotals(totalsByCurrency(unpaidIssued, inv => inv.balance_due));

    const unpaidReceivedCount = unpaidReceived.length;
    const unpaidReceivedTotal = formatCurrencyTotals(totalsByCurrency(unpaidReceived, inv => inv.balance_due));

    const totalAssetValue = fixedAssets.reduce((sum, asset) => sum + parseFloat(asset.acquisition_value || 0), 0);
    const totalAccumulated = fixedAssets.reduce((sum, asset) => sum + parseFloat(asset.accumulated_depreciation || 0), 0);
    const totalRemaining = totalAssetValue - totalAccumulated;
    const depreciatingCount = fixedAssets.filter(asset => asset.status === 'depreciating' || asset.status === 'in_service').length;

    const assetAlerts = [];
    for (const asset of fixedAssets) {
      if (!asset.inventory_number) {
        assetAlerts.push({
          type: 'missing_inventory',
          message: `Mijloc fix „${escapeHtml(asset.name)}” nu are număr de inventar.`,
          severity: 'warning',
          assetId: asset.id
        });
      }
      if (!asset.depreciation_start_date && asset.depreciation_method !== 'NONE' && asset.status !== 'draft') {
        assetAlerts.push({
          type: 'missing_depreciation_start',
          message: `Mijloc fix „${escapeHtml(asset.name)}” nu are data începerii amortizării.`,
          severity: 'warning',
          assetId: asset.id
        });
      }
      if (asset.useful_life === null || asset.useful_life === undefined) {
        assetAlerts.push({
          type: 'missing_useful_life',
          message: `Mijloc fix „${escapeHtml(asset.name)}” nu are durată de viață setată.`,
          severity: 'info',
          assetId: asset.id
        });
      }
    }

    currentData = {
      monthlyCashflow: [],
      overdueInvoices,
      recentTransactions,
      unpaidIssued,
      unpaidReceived,
      fixedAssets
    };

    renderDashboard({
      totalIn,
      totalOut,
      netCashflow,
      unpaidIssuedCount,
      unpaidIssuedTotal,
      unpaidReceivedCount,
      unpaidReceivedTotal,
      overdueCount: overdueInvoices.length,
      overdueTotal: formatCurrencyTotals(totalsByCurrency(overdueInvoices, inv => inv.balance_due)),
      recentTransactions,
      fixedAssetsCount: fixedAssets.length,
      totalAssetValue,
      totalAccumulated,
      totalRemaining,
      depreciatingCount,
      assetAlerts
    });

  } catch (error) {
    console.error('Eroare la încărcarea dashboard-ului:', error);
    content.innerHTML = `
      <div class="alert alert-error">
        ⚠️ Nu am putut încărca datele meniului principal. Încearcă din nou.
      </div>
    `;
  }
}

function renderDashboard(data) {
  const content = document.getElementById('dashboard-content');
  if (!content) return;

  const {
    totalIn,
    totalOut,
    netCashflow,
    unpaidIssuedCount,
    unpaidIssuedTotal,
    unpaidReceivedCount,
    unpaidReceivedTotal,
    overdueCount,
    overdueTotal,
    recentTransactions,
    fixedAssetsCount,
    totalAssetValue,
    totalAccumulated,
    totalRemaining,
    depreciatingCount,
    assetAlerts
  } = data;

  const alertsHtml = assetAlerts.length > 0
    ? `
      <div class="card attention-card">
        <div class="card-header">
          <div><span class="card-eyebrow">De urmărit</span><h3>Alerte mijloace fixe</h3></div>
          <span class="badge badge-warning">${assetAlerts.length} ${assetAlerts.length === 1 ? 'alertă' : 'alerte'}</span>
        </div>
        <ul class="attention-list">
          ${assetAlerts.map(alert => `
            <li>
              <span>${alert.severity === 'warning' ? '⚠️' : 'ℹ️'} ${alert.message}</span>
              <a href="#/fixed-assets" class="btn btn-sm btn-outline">Deschide</a>
            </li>
          `).join('')}
        </ul>
      </div>
    `
    : '';

  content.innerHTML = `
    <!-- === DASHBOARD CONTAINER: perfect symmetry grid === -->
    <div class="dashboard-container">

    <div class="dashboard-section-heading">
      <div><span class="card-eyebrow">Situație financiară</span><h3>Luna curentă</h3></div>
      <span class="section-hint">Sumele includ doar operațiunile confirmate</span>
    </div>
    <div class="stat-grid">
      <div class="stat-card">
        <span class="stat-label">Încasări operaționale luna curentă</span>
        <span class="stat-value" style="color: var(--color-success)">${formatCurrency(totalIn, 'RON')}</span>
        <span class="stat-help">Total încasat în această lună</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Plăți operaționale luna curentă</span>
        <span class="stat-value" style="color: var(--color-danger)">${formatCurrency(totalOut, 'RON')}</span>
        <span class="stat-help">Cheltuieli achitate în această lună</span>
      </div>
      <div class="stat-card highlight">
        <span class="stat-label">Sold cash-flow operațional</span>
        <span class="stat-value" style="color: ${netCashflow >= 0 ? 'var(--color-success)' : 'var(--color-danger)'}">${formatCurrency(netCashflow, 'RON')}</span>
        <span class="stat-help">${netCashflow >= 0 ? 'Sold operațional pozitiv' : 'Plățile depășesc încasările'}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Facturi emise neachitate</span>
        <span class="stat-value">${unpaidIssuedCount} <small style="font-size:0.6em;color:var(--color-text-secondary)">(${unpaidIssuedTotal})</small></span>
        <a class="stat-link" href="#/invoices">Vezi facturile →</a>
      </div>
      <div class="stat-card">
        <span class="stat-label">Facturi primite neachitate</span>
        <span class="stat-value">${unpaidReceivedCount} <small style="font-size:0.6em;color:var(--color-text-secondary)">(${unpaidReceivedTotal})</small></span>
        <a class="stat-link" href="#/received-invoices">Vezi facturile →</a>
      </div>
      <div class="stat-card">
        <span class="stat-label">Facturi restante</span>
        <span class="stat-value" style="color: ${overdueCount > 0 ? 'var(--color-danger)' : 'var(--color-text)'}">${overdueCount} <small style="font-size:0.6em;color:var(--color-text-secondary)">(${overdueTotal})</small></span>
        <span class="stat-help">${overdueCount > 0 ? 'Necesită atenție' : 'Nu există restanțe'}</span>
      </div>
    </div>

    <div class="dashboard-section-heading compact-heading">
      <div><span class="card-eyebrow">Patrimoniu</span><h3>Mijloace fixe</h3></div>
      <a href="#/fixed-assets" class="section-link">Deschide registrul →</a>
    </div>
    <div class="stat-grid asset-stat-grid">
      <div class="stat-card">
        <span class="stat-label">Total mijloace fixe</span>
        <span class="stat-value">${fixedAssetsCount}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Valoare de intrare</span>
        <span class="stat-value">${formatCurrency(totalAssetValue, 'RON')}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Amortizare cumulată</span>
        <span class="stat-value">${formatCurrency(totalAccumulated, 'RON')}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Valoare rămasă</span>
        <span class="stat-value" style="color: var(--color-info)">${formatCurrency(totalRemaining, 'RON')}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">În amortizare</span>
        <span class="stat-value">${depreciatingCount}</span>
      </div>
    </div>

    ${alertsHtml}

    <!-- Large cards wrapped in a symmetry grid -->
    <div class="dashboard-cards">
      <div class="card">
        <div class="card-header">
          <div><span class="card-eyebrow">Activitate</span><h3>Ultimele operațiuni</h3></div>
          <a href="#/other-operations" class="section-link">Vezi toate →</a>
        </div>
        ${renderRecentTransactions(recentTransactions)}
      </div>

      <div class="card">
        <div class="card-header">
          <div><span class="card-eyebrow">De urmărit</span><h3>Facturi restante</h3></div>
          <a href="#/invoices" class="section-link">Vezi facturile →</a>
        </div>
        ${renderOverdueInvoices(currentData.overdueInvoices)}
      </div>
    </div>

    </div>
    <!-- === end dashboard-container === -->
  `;
}

function renderRecentTransactions(transactions) {
  if (!transactions || transactions.length === 0) {
    return renderEmptyState('Nu există tranzacții recente.');
  }

  let html = '<div class="table-container"><table><thead><tr><th>Data</th><th>Tip</th><th>Descriere</th><th>Sumă</th><th>Stare</th></tr></thead><tbody>';

  for (const tx of transactions) {
    const isContribution = tx.transaction_type === 'OWN_CONTRIBUTION' || tx.transaction_type === 'OWN_CONTRIBUTION_RETURN';
    const amountClass = tx.direction === 'IN' ? 'color: var(--color-success)' : 'color: var(--color-danger)';
    const amountDisplay = tx.direction === 'IN' ? '+' : '-';
    html += `
      <tr>
        <td>${formatDate(tx.transaction_date)}</td>
        <td>${renderStatusBadge(tx.transaction_type)}</td>
        <td>${escapeHtml(tx.description || '-')}</td>
        <td style="${amountClass}; font-weight: 500;">${amountDisplay}${formatCurrency(tx.amount, tx.currency)}${isContribution ? ' <small style="color:var(--color-text-secondary)">(nefiscal)</small>' : ''}</td>
        <td>${renderStatusBadge(tx.status)}</td>
      </tr>
    `;
  }

  html += '</tbody></table></div>';
  return html;
}

function renderOverdueInvoices(invoices) {
  if (!invoices || invoices.length === 0) {
    return renderEmptyState('Nu există facturi restante.');
  }

  let html = '<div class="table-container"><table><thead><tr><th>Serie/Număr</th><th>Client</th><th>Scadență</th><th>Sold</th><th>Zile restante</th></tr></thead><tbody>';

  for (const inv of invoices) {
    html += `
      <tr>
        <td>${escapeHtml(inv.series)}-${escapeHtml(String(inv.number))}</td>
        <td>${escapeHtml(inv.client_name || '-')}</td>
        <td>${formatDate(inv.due_date)}</td>
        <td>${formatCurrency(inv.balance_due, inv.currency)}</td>
        <td style="color: var(--color-danger); font-weight: 500;">${inv.days_overdue} zile</td>
      </tr>
    `;
  }

  html += '</tbody></table></div>';
  return html;
}
