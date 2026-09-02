// js/modules/reports.js
// Modul Rapoarte – facturare, documente, mijloace fixe, numere inventar
// Raportul RJIP a fost eliminat deoarece există deja ca pagină separată în Registre.
// UX îmbunătățit: skeleton loading, empty states, tooltips, export/print
// FIX: afișează corect facturile primite storno/corecție în raportul de facturare.

import { invoicesApi, receivedInvoicesApi, fixedAssetsApi } from '../api.js';
import { getSupabase } from '../supabase.js';
import { formatCurrency, formatCurrencyTotals, formatDate, showToast, escapeHtml, totalsByCurrency } from '../utils.js';
import { renderStatusBadge, renderTable, renderSkeleton, renderEmptyState } from '../ui.js';
import { exportToCsv, printTable } from '../services/export-service.js';

let currentTab = 'invoicing'; // implicit Facturare
let currentAssetSubtab = 'summary';

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-heading"><h2>Rapoarte</h2><p>Analizează facturarea, documentele și patrimoniul folosind datele actuale ale aplicației.</p></div>
    </div>
    <nav class="report-tabs" aria-label="Tip raport">
      <button class="report-tab ${currentTab === 'invoicing' ? 'active' : ''}" data-report-tab="invoicing" title="Facturi emise și primite"><span aria-hidden="true">↕</span><span><strong>Facturare</strong><small>Emise și primite</small></span></button>
      <button class="report-tab ${currentTab === 'documents' ? 'active' : ''}" data-report-tab="documents" title="Documente atașate"><span aria-hidden="true">≡</span><span><strong>Documente</strong><small>Fișiere atașate</small></span></button>
      <button class="report-tab ${currentTab === 'assets' ? 'active' : ''}" data-report-tab="assets" title="Mijloace fixe și amortizare"><span aria-hidden="true">▦</span><span><strong>Mijloace fixe</strong><small>Valori și amortizare</small></span></button>
      <button class="report-tab ${currentTab === 'numbers' ? 'active' : ''}" data-report-tab="numbers" title="Numere de inventar"><span aria-hidden="true">#</span><span><strong>Numere inventar</strong><small>Evidență și alocare</small></span></button>
    </nav>
    <div id="report-content"></div>
  `;

  container.querySelectorAll('[data-report-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab = btn.getAttribute('data-report-tab');
      render(container);
    });
  });

  await loadReportData(container);
}

export function destroy() {}

async function loadReportData(container) {
  const content = container.querySelector('#report-content');
  if (!content) return;

  content.innerHTML = renderSkeleton(5);

  try {
    switch (currentTab) {
      case 'invoicing':
        await renderInvoicingReport(content);
        break;
      case 'documents':
        await renderDocumentsReport(content);
        break;
      case 'assets':
        await renderAssetsReport(content);
        break;
      case 'numbers':
        await renderInventoryNumbersReport(content);
        break;
      default:
        content.innerHTML = '<p>Selectează un raport</p>';
    }
  } catch (error) {
    console.error('Eroare la generarea raportului:', error);
    content.innerHTML = `<div class="alert alert-error">${escapeHtml(error.message || 'Nu am putut genera raportul')}</div>`;
  }
}

// ======================================================================
// INVOICING REPORT
// ======================================================================
async function renderInvoicingReport(container) {
  const [issuedResult, receivedResult] = await Promise.all([
    invoicesApi.list({ page: 1, pageSize: 1000 }),
    receivedInvoicesApi.list({})
  ]);

  const issued = issuedResult.data || [];
  const receivedAll = receivedResult || [];

  // Separăm facturile primite normale de storno/corecție
  const receivedNormal = receivedAll.filter(inv => !['STORNO', 'CORRECTION'].includes(inv.invoice_type));
  const receivedStorno = receivedAll.filter(inv => ['STORNO', 'CORRECTION'].includes(inv.invoice_type));

  // Totaluri pentru facturi emise
  const totalIssued = formatCurrencyTotals(totalsByCurrency(issued, inv => inv.total));
  const totalIssuedUnpaid = formatCurrencyTotals(totalsByCurrency(
    issued.filter(inv => inv.payment_status !== 'PAID'),
    inv => inv.balance_due
  ));

  // Totaluri pentru facturi primite normale
  const totalReceivedNormalUnpaid = formatCurrencyTotals(totalsByCurrency(
    receivedNormal.filter(inv => inv.payment_status !== 'PAID'),
    inv => inv.balance_due
  ));

  // Total storno (de regulă negativ)
  const totalReceivedStorno = formatCurrencyTotals(totalsByCurrency(receivedStorno, inv => inv.total));

  // Sold net al facturilor primite = normale + storno
  const totalReceivedNet = formatCurrencyTotals(totalsByCurrency(receivedAll, inv => inv.total));

  // Headers pentru facturi emise
  const issuedHeaders = [
    { label: 'Serie/Număr', key: 'number' },
    { label: 'Client', key: 'client' },
    { label: 'Data', key: 'issue_date' },
    { label: 'Total', key: 'total', align: 'right' },
    { label: 'Plătit', key: 'paid', align: 'right' },
    { label: 'Sold', key: 'balance', align: 'right' },
    { label: 'Stare', key: 'status' }
  ];

  const issuedRows = issued.map(inv => ({
    number: inv.series ? `${inv.series}-${inv.number}` : 'Ciornă',
    client: inv.clients ? inv.clients.legal_name : '-',
    issue_date: formatDate(inv.issue_date),
    total: formatCurrency(inv.total, inv.currency),
    paid: formatCurrency(inv.paid_total, inv.currency),
    balance: formatCurrency(inv.balance_due, inv.currency),
    status: renderStatusBadge(inv.document_status) + ' ' + renderStatusBadge(inv.payment_status)
  }));

  // Headers pentru facturi primite (includ atât normale cât și storno)
  const receivedHeaders = [
    { label: 'Furnizor', key: 'supplier' },
    { label: 'Serie/Număr', key: 'number' },
    { label: 'Data', key: 'document_date' },
    { label: 'Total', key: 'total', align: 'right' },
    { label: 'Plătit', key: 'paid', align: 'right' },
    { label: 'Sold', key: 'balance', align: 'right' },
    { label: 'Stare', key: 'status' }
  ];

  const receivedRows = receivedAll.map(inv => {
    const isStorno = ['STORNO', 'CORRECTION'].includes(inv.invoice_type);
    const typeBadge = isStorno
      ? `<span class="badge badge-warning">${escapeHtml(inv.invoice_type === 'STORNO' ? 'Storno' : 'Corecție')}</span> `
      : '';
    return {
      supplier: inv.suppliers ? inv.suppliers.legal_name : '-',
      number: inv.series ? `${inv.series}-${inv.number}` : inv.number,
      document_date: formatDate(inv.document_date),
      total: formatCurrency(inv.total, inv.currency),
      paid: formatCurrency(inv.paid_total, inv.currency),
      balance: formatCurrency(inv.balance_due, inv.currency),
      status: typeBadge + renderStatusBadge(inv.document_status) + ' ' + renderStatusBadge(inv.payment_status)
    };
  });

  container.innerHTML = `
    <div class="dashboard-section-heading"><div><span class="card-eyebrow">Facturare</span><h3>Privire de ansamblu</h3></div><span class="section-hint">Primele documente recente sunt afișate mai jos</span></div>
    <div class="stat-grid">
      <div class="stat-card"><span class="stat-label">Facturi emise</span><span class="stat-value">${issued.length}</span></div>
      <div class="stat-card"><span class="stat-label">Facturi primite normale</span><span class="stat-value">${receivedNormal.length}</span></div>
      <div class="stat-card"><span class="stat-label">Facturi primite storno</span><span class="stat-value">${receivedStorno.length}</span></div>
      <div class="stat-card"><span class="stat-label">Emise neachitate</span><span class="stat-value">${issued.filter(inv => inv.payment_status !== 'PAID').length}</span></div>
      <div class="stat-card"><span class="stat-label">Primite normale neachitate</span><span class="stat-value">${receivedNormal.filter(inv => inv.payment_status !== 'PAID').length}</span></div>
    </div>
    <div class="stat-grid">
      <div class="stat-card"><span class="stat-label">Total emise</span><span class="stat-value">${totalIssued}</span></div>
      <div class="stat-card"><span class="stat-label">Total primite (nete)</span><span class="stat-value">${totalReceivedNet}</span></div>
      <div class="stat-card"><span class="stat-label">Sold emise neachitate</span><span class="stat-value" style="color:var(--color-warning)">${totalIssuedUnpaid}</span></div>
      <div class="stat-card"><span class="stat-label">Sold primite normale neachitate</span><span class="stat-value" style="color:var(--color-warning)">${totalReceivedNormalUnpaid}</span></div>
      <div class="stat-card"><span class="stat-label">Total storno primite</span><span class="stat-value" style="color:var(--color-danger)">${totalReceivedStorno}</span></div>
    </div>
    <div class="card">
      <div class="card-header"><div><span class="card-eyebrow">Clienți</span><h3>Facturi emise recente</h3></div><a class="section-link" href="#/invoices">Vezi toate →</a></div>
      ${renderTable(issuedHeaders, issuedRows.slice(0, 10), { emptyMessage: 'Nu există facturi emise', rawColumns: ['status'] })}
    </div>
    <div class="card">
      <div class="card-header"><div><span class="card-eyebrow">Furnizori</span><h3>Facturi primite recente</h3></div><a class="section-link" href="#/received-invoices">Vezi toate →</a></div>
      ${renderTable(receivedHeaders, receivedRows.slice(0, 20), { emptyMessage: 'Nu există facturi primite', rawColumns: ['status'] })}
    </div>
  `;
}

// ======================================================================
// DOCUMENTS REPORT
// ======================================================================
async function renderDocumentsReport(container) {
  const supabase = await getSupabase();
  const { data: documents, error } = await supabase
    .from('documents')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;

  const docs = documents || [];

  if (docs.length === 0) {
    container.innerHTML = renderEmptyState('Nu există documente atașate.');
    return;
  }

  const headers = [
    { label: 'Nume', key: 'filename' },
    { label: 'Tip', key: 'mime_type' },
    { label: 'Dimensiune', key: 'size' },
    { label: 'Data', key: 'created_at' }
  ];

  const rows = docs.map(doc => ({
    filename: doc.original_filename,
    mime_type: doc.mime_type || '-',
    size: (doc.file_size / 1024).toFixed(2) + ' KB',
    created_at: formatDate(doc.created_at)
  }));

  container.innerHTML = `
    <div class="stat-card"><span class="stat-label">Total documente</span><span class="stat-value">${docs.length}</span></div>
    <div class="card">
      <h3>Documente recente</h3>
      ${renderTable(headers, rows.slice(0, 20), { emptyMessage: 'Nu există documente' })}
    </div>
  `;
}

// ======================================================================
// ASSETS REPORT (MIJLOACE FIXE)
// ======================================================================
async function renderAssetsReport(container) {
  container.innerHTML = `
    <div class="flex gap-1 mb-2" style="flex-wrap: wrap;">
      <button class="btn btn-sm ${currentAssetSubtab === 'summary' ? 'btn-primary' : 'btn-outline'}" data-asset-subtab="summary" title="Sumar mijloace fixe">Sumar</button>
      <button class="btn btn-sm ${currentAssetSubtab === 'inventory' ? 'btn-primary' : 'btn-outline'}" data-asset-subtab="inventory" title="Registrul-inventar">Registru inventar</button>
      <button class="btn btn-sm ${currentAssetSubtab === 'depreciation' ? 'btn-primary' : 'btn-outline'}" data-asset-subtab="depreciation" title="Amortizare anuală">Amortizare anuală</button>
      <button class="btn btn-sm ${currentAssetSubtab === 'details' ? 'btn-primary' : 'btn-outline'}" data-asset-subtab="details" title="Fișa activului">Fișa activului</button>
    </div>
    <div id="assets-report-content"></div>
  `;

  container.querySelectorAll('[data-asset-subtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentAssetSubtab = btn.getAttribute('data-asset-subtab');
      renderAssetsReport(container);
    });
  });

  const content = container.querySelector('#assets-report-content');
  if (!content) return;

  content.innerHTML = renderSkeleton(5);

  try {
    switch (currentAssetSubtab) {
      case 'summary':
        await renderAssetsSummary(content);
        break;
      case 'inventory':
        await renderInventoryRegister(content);
        break;
      case 'depreciation':
        await renderAnnualDepreciation(content);
        break;
      case 'details':
        await renderAssetDetailsSelector(content);
        break;
      default:
        await renderAssetsSummary(content);
    }
  } catch (error) {
    content.innerHTML = `<div class="alert alert-error">${escapeHtml(error.message)}</div>`;
  }
}

// ---- Sub-taburi mijloace fixe ----
async function renderAssetsSummary(container) {
  const assets = await fixedAssetsApi.list();
  const totalAcquisition = assets.reduce((sum, a) => sum + parseFloat(a.acquisition_value || 0), 0);
  const totalAccumulated = assets.reduce((sum, a) => sum + parseFloat(a.accumulated_depreciation || 0), 0);
  const totalRemaining = totalAcquisition - totalAccumulated;
  const fullyDepreciated = assets.filter(a => a.status === 'fully_depreciated').length;
  const inService = assets.filter(a => a.status === 'in_service' || a.status === 'depreciating').length;
  const disposed = assets.filter(a => a.status === 'sold' || a.status === 'scrapped' || a.status === 'disposed').length;

  if (assets.length === 0) {
    container.innerHTML = renderEmptyState('Nu există mijloace fixe înregistrate.');
    return;
  }

  const headers = [
    { label: 'Număr inventar', key: 'inventory_number' },
    { label: 'Nume', key: 'name' },
    { label: 'Categorie', key: 'asset_category' },
    { label: 'Data achiziției', key: 'acquisition_date' },
    { label: 'Valoare', key: 'acquisition_value', align: 'right' },
    { label: 'Amortizare cumulată', key: 'accumulated_depreciation', align: 'right' },
    { label: 'Valoare rămasă', key: 'remaining_value', align: 'right' },
    { label: 'Stare', key: 'status' }
  ];

  const rows = assets.map(a => ({
    inventory_number: a.inventory_number || '-',
    name: a.name,
    asset_category: a.asset_category || '-',
    acquisition_date: formatDate(a.acquisition_date),
    acquisition_value: formatCurrency(a.acquisition_value),
    accumulated_depreciation: formatCurrency(a.accumulated_depreciation),
    remaining_value: formatCurrency(a.remaining_value),
    status: renderStatusBadge(a.status)
  }));

  container.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><span class="stat-label">Total mijloace fixe</span><span class="stat-value">${assets.length}</span></div>
      <div class="stat-card"><span class="stat-label">Valoare de intrare</span><span class="stat-value">${formatCurrency(totalAcquisition)}</span></div>
      <div class="stat-card"><span class="stat-label">Amortizare cumulată</span><span class="stat-value">${formatCurrency(totalAccumulated)}</span></div>
      <div class="stat-card"><span class="stat-label">Valoare rămasă</span><span class="stat-value">${formatCurrency(totalRemaining)}</span></div>
    </div>
    <div class="stat-grid">
      <div class="stat-card"><span class="stat-label">În funcțiune</span><span class="stat-value">${inService}</span></div>
      <div class="stat-card"><span class="stat-label">Amortizate complet</span><span class="stat-value">${fullyDepreciated}</span></div>
      <div class="stat-card"><span class="stat-label">Scoase din funcțiune</span><span class="stat-value">${disposed}</span></div>
    </div>
    <div class="flex gap-1 mb-2">
      <button class="btn btn-outline btn-sm" id="export-assets-csv" title="Exportă ca CSV">Export CSV</button>
      <button class="btn btn-outline btn-sm" id="print-assets" title="Tipărește lista">Tipărire / PDF</button>
    </div>
    <div class="card">
      <h3>Lista mijloacelor fixe</h3>
      ${renderTable(headers, rows, { emptyMessage: 'Nu există mijloace fixe', rawColumns: ['status'] })}
    </div>
  `;

  document.getElementById('export-assets-csv').addEventListener('click', () => {
    exportToCsv('mijloace_fixe', headers, rows);
  });
  document.getElementById('print-assets').addEventListener('click', () => {
    printTable('Lista mijloacelor fixe', headers, rows);
  });
}

async function renderInventoryRegister(container) {
  const assets = await fixedAssetsApi.list();

  if (assets.length === 0) {
    container.innerHTML = renderEmptyState('Nu există elemente în registrul-inventar.');
    return;
  }

  const headers = [
    { label: 'Număr inventar', key: 'inventory_number' },
    { label: 'Denumire', key: 'name' },
    { label: 'Document proveniență', key: 'source' },
    { label: 'Data intrării', key: 'entry_date' },
    { label: 'Valoare intrare', key: 'acquisition_value', align: 'right' },
    { label: 'Stare', key: 'status' },
    { label: 'Data ieșirii', key: 'disposal_date' }
  ];

  const rows = assets.map(a => ({
    inventory_number: a.inventory_number || '-',
    name: a.name,
    source: a.source_invoice_id ? `Factura ${a.source_invoice_id}` : (a.document_reference || '-'),
    entry_date: formatDate(a.entry_date || a.acquisition_date),
    acquisition_value: formatCurrency(a.acquisition_value),
    status: renderStatusBadge(a.status),
    disposal_date: (a.status === 'sold' || a.status === 'scrapped' || a.status === 'disposed') ? formatDate(a.updated_at) : '-'
  }));

  container.innerHTML = `
    <div class="flex gap-1 mb-2">
      <button class="btn btn-outline btn-sm" id="export-inventory-csv" title="Exportă ca CSV">Export CSV</button>
      <button class="btn btn-outline btn-sm" id="print-inventory" title="Tipărește registrul">Tipărire / PDF</button>
    </div>
    <div class="card">
      <h3>Registrul-inventar</h3>
      ${renderTable(headers, rows, { emptyMessage: 'Nu există mijloace fixe', rawColumns: ['status'] })}
    </div>
  `;

  document.getElementById('export-inventory-csv').addEventListener('click', () => {
    exportToCsv('registru_inventar', headers, rows);
  });
  document.getElementById('print-inventory').addEventListener('click', () => {
    printTable('Registru-inventar', headers, rows);
  });
}

async function renderAnnualDepreciation(container) {
  const supabase = await getSupabase();
  const { data: entries, error } = await supabase
    .from('fixed_asset_depreciation_entries')
    .select('*')
    .order('period', { ascending: true });

  if (error) throw error;

  const currentYear = new Date().getFullYear();
  const yearlyEntries = entries.filter(e => new Date(e.period).getFullYear() === currentYear);
  const totalAnnual = yearlyEntries.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);

  if (yearlyEntries.length === 0) {
    container.innerHTML = renderEmptyState(`Nu există amortizare înregistrată în ${currentYear}.`);
    return;
  }

  const headers = [
    { label: 'Număr inventar', key: 'inventory_number' },
    { label: 'Activ', key: 'name' },
    { label: 'Perioada', key: 'period' },
    { label: 'Sumă', key: 'amount', align: 'right' },
    { label: 'Cumulat', key: 'cumulative', align: 'right' },
    { label: 'Rămas', key: 'remaining', align: 'right' }
  ];

  const rows = [];
  for (const entry of yearlyEntries) {
    const asset = await fixedAssetsApi.get(entry.fixed_asset_id);
    rows.push({
      inventory_number: asset.inventory_number || '-',
      name: asset.name,
      period: formatDate(entry.period),
      amount: formatCurrency(entry.amount),
      cumulative: formatCurrency(entry.cumulative_amount),
      remaining: formatCurrency(entry.remaining_value)
    });
  }

  container.innerHTML = `
    <div class="stat-card"><span class="stat-label">Total amortizare ${currentYear}</span><span class="stat-value">${formatCurrency(totalAnnual)}</span></div>
    <div class="flex gap-1 mb-2">
      <button class="btn btn-outline btn-sm" id="export-depreciation-csv" title="Exportă ca CSV">Export CSV</button>
      <button class="btn btn-outline btn-sm" id="print-depreciation" title="Tipărește raportul">Tipărire / PDF</button>
    </div>
    <div class="card">
      <h3>Amortizare anuală</h3>
      ${renderTable(headers, rows, { emptyMessage: 'Nu există amortizare în anul curent' })}
    </div>
  `;

  document.getElementById('export-depreciation-csv').addEventListener('click', () => {
    exportToCsv('amortizare_anuala', headers, rows);
  });
  document.getElementById('print-depreciation').addEventListener('click', () => {
    printTable('Amortizare anuală', headers, rows);
  });
}

async function renderAssetDetailsSelector(container) {
  const assets = await fixedAssetsApi.list();

  if (assets.length === 0) {
    container.innerHTML = renderEmptyState('Nu există mijloace fixe pentru a selecta.');
    return;
  }

  const options = assets.map(a => `<option value="${a.id}">${escapeHtml(a.inventory_number || a.name)} - ${escapeHtml(a.name)}</option>`).join('');

  container.innerHTML = `
    <div class="card">
      <h3>Selectează activul</h3>
      <select id="asset-detail-select">
        <option value="">Alege activ...</option>
        ${options}
      </select>
      <button class="btn btn-primary btn-sm mt-2" id="show-asset-detail" title="Afișează fișa activului">Afișează fișa</button>
    </div>
    <div id="asset-detail-container"></div>
  `;

  document.getElementById('show-asset-detail').addEventListener('click', async () => {
    const select = document.getElementById('asset-detail-select');
    const assetId = select.value;
    if (!assetId) {
      showToast('Selectează un activ', 'warning');
      return;
    }
    await renderAssetDetail(assetId, document.getElementById('asset-detail-container'));
  });
}

async function renderAssetDetail(assetId, container) {
  try {
    const asset = await fixedAssetsApi.get(assetId);
    if (!asset) throw new Error('Activ negăsit');

    const supabase = await getSupabase();
    const { data: entries, error } = await supabase
      .from('fixed_asset_depreciation_entries')
      .select('*')
      .eq('fixed_asset_id', assetId)
      .order('period', { ascending: true });

    if (error) throw error;

    container.innerHTML = `
      <div class="card">
        <h3>Fișa mijlocului fix</h3>
        <div class="grid mb-2">
          <div><strong>Număr inventar:</strong> ${asset.inventory_number || '-'}</div>
          <div><strong>Denumire:</strong> ${escapeHtml(asset.name)}</div>
          <div><strong>Categorie:</strong> ${asset.asset_category || '-'}</div>
          <div><strong>Cod clasificare:</strong> ${asset.classification_code || '-'}</div>
          <div><strong>Serie:</strong> ${asset.serial_number || '-'}</div>
          <div><strong>Data achiziției:</strong> ${formatDate(asset.acquisition_date)}</div>
          <div><strong>Valoare intrare:</strong> ${formatCurrency(asset.acquisition_value)}</div>
          <div><strong>Valoare reziduală:</strong> ${formatCurrency(asset.residual_value)}</div>
          <div><strong>Metodă amortizare:</strong> ${asset.depreciation_method}</div>
          <div><strong>Durată viață:</strong> ${asset.useful_life || '-'} luni</div>
          <div><strong>Data începerii amortizării:</strong> ${formatDate(asset.depreciation_start_date)}</div>
          <div><strong>Amortizare lunară:</strong> ${formatCurrency(asset.monthly_depreciation)}</div>
          <div><strong>Amortizare cumulată:</strong> ${formatCurrency(asset.accumulated_depreciation)}</div>
          <div><strong>Valoare rămasă:</strong> ${formatCurrency(asset.remaining_value)}</div>
          <div><strong>Stare:</strong> ${renderStatusBadge(asset.status)}</div>
        </div>
        <h4>Amortizare</h4>
        ${entries.length === 0 ? '<p>Nu există înregistrări de amortizare.</p>' : `
          <div class="table-container">
            <table>
              <thead><tr><th>Perioadă</th><th>Sumă</th><th>Cumulat</th><th>Rămas</th></tr></thead>
              <tbody>
                ${entries.map(e => `
                  <tr>
                    <td>${formatDate(e.period)}</td>
                    <td>${formatCurrency(e.amount)}</td>
                    <td>${formatCurrency(e.cumulative_amount)}</td>
                    <td>${formatCurrency(e.remaining_value)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
      <button class="btn btn-outline btn-sm" id="print-asset-detail" title="Tipărește fișa">Tipărire / PDF</button>
    `;

    document.getElementById('print-asset-detail').addEventListener('click', () => {
      const printContent = container.innerHTML;
      const printWindow = window.open('', '_blank', 'width=900,height=600');
      if (printWindow) {
        printWindow.document.write('<html><head><title>Fișă mijloc fix</title></head><body>' + printContent + '</body></html>');
        printWindow.document.close();
        printWindow.print();
      } else {
        showToast('Pop-up blocat', 'error');
      }
    });
  } catch (error) {
    container.innerHTML = `<div class="alert alert-error">${escapeHtml(error.message)}</div>`;
  }
}

// ======================================================================
// NUMERE INVENTAR (categorie separată)
// ======================================================================
async function renderInventoryNumbersReport(container) {
  const supabase = await getSupabase();
  const { data: numbers, error } = await supabase
    .from('inventory_numbers')
    .select(`
      inventory_number,
      assigned_at,
      status,
      retired_at,
      fixed_asset_id,
      inventory_item_id,
      fixed_assets:fixed_assets(name, inventory_number),
      inventory_items:inventory_items(description, inventory_number)
    `)
    .order('assigned_at', { ascending: false });

  if (error) throw error;

  const nums = numbers || [];

  if (nums.length === 0) {
    container.innerHTML = renderEmptyState('Nu există numere de inventar.');
    return;
  }

  const headers = [
    { label: 'Număr', key: 'inventory_number' },
    { label: 'Activ asociat', key: 'asset_name' },
    { label: 'Data atribuirii', key: 'assigned_at' },
    { label: 'Stare', key: 'status' },
    { label: 'Data retragerii', key: 'retired_at' }
  ];

  const rows = nums.map(n => {
    let assetName = '-';
    if (n.fixed_assets) {
      assetName = `${n.fixed_assets.name} (${n.fixed_assets.inventory_number || 'fără nr.'})`;
    } else if (n.inventory_items) {
      assetName = `${n.inventory_items.description} (${n.inventory_items.inventory_number || 'fără nr.'})`;
    }

    return {
      inventory_number: n.inventory_number,
      asset_name: assetName,
      assigned_at: formatDate(n.assigned_at),
      status: renderStatusBadge(n.status),
      retired_at: n.retired_at ? formatDate(n.retired_at) : '-'
    };
  });

  container.innerHTML = `
    <div class="flex gap-1 mb-2">
      <button class="btn btn-outline btn-sm" id="export-numbers-csv" title="Exportă ca CSV">Export CSV</button>
      <button class="btn btn-outline btn-sm" id="print-numbers" title="Tipărește lista">Tipărire / PDF</button>
    </div>
    <div class="card">
      <h3>Registrul numerelor de inventar</h3>
      ${renderTable(headers, rows, { emptyMessage: 'Nu există numere de inventar', rawColumns: ['status'] })}
    </div>
  `;

  document.getElementById('export-numbers-csv').addEventListener('click', () => {
    exportToCsv('numere_inventar', headers, rows);
  });
  document.getElementById('print-numbers').addEventListener('click', () => {
    printTable('Registrul numerelor de inventar', headers, rows);
  });
}
