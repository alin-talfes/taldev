// js/services/pdf-service.js
// Serviciu de generare PDF pentru facturi și proforme
// Layout profesional A4, alb-negru, cu logo-ul standard files/header.png

import { formatCurrency, formatDate, escapeHtml } from '../utils.js';
import { createModal } from '../ui.js';

const LOGO_URL = 'files/header.png';

/**
 * Calculează sumele pentru fiecare cotă TVA din liniile documentului
 */
function calculateVatSummary(lines) {
  const summary = new Map();
  for (const line of lines) {
    const vatRate = parseFloat(line.vat_rate) || 0;
    const netAmount = parseFloat(line.net_amount) || 0;
    const vatAmount = parseFloat(line.vat_amount) || 0;
    const key = vatRate.toFixed(2);
    if (summary.has(key)) {
      const existing = summary.get(key);
      existing.base += netAmount;
      existing.vat += vatAmount;
    } else {
      summary.set(key, { base: netAmount, vat: vatAmount });
    }
  }
  return Array.from(summary.entries()).map(([rate, values]) => ({
    rate: parseFloat(rate),
    base: values.base,
    vat: values.vat
  }));
}

function formatQuantity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '-';
  return new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 2 }).format(numeric);
}

/**
 * Generează HTML pentru un document (factură sau proformă)
 */
function generateDocumentHtml(doc, pfaSettings, isProforma) {
  const lines = doc.invoice_lines || doc.proforma_lines || [];
  const client = doc.clients || {};
  const currency = doc.currency || 'RON';
  const isAdjustment = doc.invoice_type === 'STORNO' || doc.invoice_type === 'CORRECTION';
  const title = isProforma
    ? 'PROFORMĂ'
    : ({ STORNO: 'FACTURĂ STORNO', CORRECTION: 'FACTURĂ DE CORECȚIE', REFUND: 'FACTURĂ DE RESTITUIRE' }[doc.invoice_type] || 'FACTURĂ');

  const vatSummary = calculateVatSummary(lines);

  const linesHtml = lines.map((line, index) => {
    const netAmount = parseFloat(line.net_amount) || 0;
    const vatAmount = parseFloat(line.vat_amount) || 0;
    const totalAmount = parseFloat(line.total_amount) || 0;
    return `
      <tr>
        <td class="text-center">${index + 1}</td>
        <td>${escapeHtml(line.description)}</td>
        <td class="text-center">${escapeHtml(line.unit || 'buc')}</td>
        <td class="text-right">${formatQuantity(line.quantity)}</td>
        <td class="text-right">${formatCurrency(line.unit_price, currency)}</td>
        <td class="text-right">${formatCurrency(netAmount, currency)}</td>
        <td class="text-center">${parseFloat(line.vat_rate) || 0}%</td>
        <td class="text-right">${formatCurrency(vatAmount, currency)}</td>
        <td class="text-right"><strong>${formatCurrency(totalAmount, currency)}</strong></td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="9" class="text-center muted">Documentul nu conține poziții.</td></tr>';

  const pfaName = pfaSettings.legal_name || 'PFA';
  const pfaTitular = pfaSettings.titular_name || '';
  const pfaCui = pfaSettings.cui || '';
  const pfaRegCom = pfaSettings.reg_com || '';
  const pfaAddress = pfaSettings.address || '';
  const pfaCounty = pfaSettings.county || '';
  const pfaCity = pfaSettings.city || '';
  const pfaPhone = pfaSettings.phone || '';
  const pfaEmail = pfaSettings.email || '';
  const pfaFooter = pfaSettings.invoice_footer_text || '';
  const pfaIban = pfaSettings.default_bank_account_iban || '';
  const pfaBank = pfaSettings.default_bank_account_bank || '';

  const clientName = client.legal_name || client.trade_name || '';
  const clientCui = client.cui || '';
  const clientRegCom = client.registration_number || '';
  const clientAddress = client.address || '';
  const clientCounty = client.county || '';
  const clientCity = client.city || '';
  const clientEmail = client.email || '';

  const logoUrl = LOGO_URL;

  // Construim date suplimentare din document
  const dueDate = doc.due_date ? formatDate(doc.due_date) : '';
  const issueDate = doc.issue_date ? formatDate(doc.issue_date) : '';
  const paymentTerms = doc.payment_terms ? `${doc.payment_terms} zile` : '';
  const notes = doc.notes || '';

  // Detalii plată
  const paymentMethod = doc.payment_method || 'Transfer bancar';

  const taxableBase = doc.taxable_base ?? doc.subtotal ?? 0;
  const vatTotal = doc.vat_total ?? 0;
  const documentTotal = doc.total ?? 0;
  const paidTotal = Math.max(0, parseFloat(doc.paid_total) || 0);
  const balanceDue = doc.balance_due == null
    ? (parseFloat(documentTotal) || 0) - paidTotal
    : parseFloat(doc.balance_due) || 0;
  const hasRecordedPayment = !isProforma && !isAdjustment && paidTotal > 0;
  const finalTotalsRows = isAdjustment ? `
      <tr class="total-due"><td>TOTAL ${doc.invoice_type === 'CORRECTION' ? 'CORECȚIE' : 'STORNO'}:</td><td>${formatCurrency(documentTotal, currency)}</td></tr>
    ` : hasRecordedPayment ? `
      <tr><td>Total document:</td><td>${formatCurrency(documentTotal, currency)}</td></tr>
      <tr><td>Achitat:</td><td>− ${formatCurrency(paidTotal, currency)}</td></tr>
      <tr class="total-due"><td>SOLD DE PLATĂ:</td><td>${formatCurrency(balanceDue, currency)}</td></tr>
    ` : `
      <tr class="total-due"><td>TOTAL DE PLATĂ:</td><td>${formatCurrency(documentTotal, currency)}</td></tr>
    `;

  // Footer
  const footerText = pfaFooter ? `<p>${escapeHtml(pfaFooter)}</p>` : '';
  const docNumber = doc.series && doc.number ? `${doc.series} ${doc.number}` : (doc.series || doc.number || '');

  return `<!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)} ${escapeHtml(docNumber)}</title>
<style>
  @page {
    size: A4;
    margin: 12mm;
  }
  body {
    font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
    font-size: 9.5pt;
    color: #17211f;
    margin: 0;
    padding: 0;
    line-height: 1.4;
  }
  .container {
    width: 100%;
    max-width: 186mm;
    margin: 0 auto;
    padding: 0;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: stretch;
    gap: 12mm;
    margin-bottom: 8mm;
    padding-bottom: 6mm;
    border-bottom: 2px solid #087f73;
  }
  .logo {
    display: block;
    max-width: 60mm;
    height: auto;
    max-height: 25mm;
    object-fit: contain;
    margin-bottom: 4mm;
    padding: 2mm;
    background-color: #fff;
  }
  .provider-info {
    flex: 1 1 58%;
    font-size: 8.7pt;
  }
  .provider-info h2 {
    font-size: 11pt;
    font-weight: 700;
    margin: 0 0 2px 0;
  }
  .provider-info p {
    margin: 0;
  }
  .invoice-title-block {
    flex: 0 0 58mm;
    text-align: right;
    font-size: 10pt;
    padding: 5mm;
    border: 1px solid #cfe1dd;
    border-radius: 3mm;
    background: #f3f8f6;
  }
  .invoice-title-block h1 {
    color: #0b4f47;
    font-size: 20pt;
    font-weight: 800;
    margin: 0 0 2px 0;
    letter-spacing: 1px;
  }
  .invoice-details {
    margin-top: 3mm;
    line-height: 1.65;
  }
  .client-section {
    margin: 0 0 6mm;
    padding: 4mm 5mm;
    border: 1px solid #dfe8e5;
    border-radius: 3mm;
    background: #fbfcfc;
  }
  .client-section h3 {
    font-size: 10pt;
    font-weight: 700;
    margin: 0 0 2px 0;
    color: #087f73;
    text-transform: uppercase;
    letter-spacing: 0.8px;
  }
  .client-section p {
    margin: 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 5mm;
    font-size: 8.3pt;
  }
  thead {
    display: table-header-group;
  }
  th, td {
    border: 1px solid #d5dfdc;
    padding: 2.6mm 2mm;
    text-align: left;
    vertical-align: top;
  }
  th {
    color: #fff;
    background-color: #0b4f47;
    font-weight: 700;
    text-align: center;
  }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  tr {
    page-break-inside: avoid;
  }
  .totals {
    margin-top: 8px;
    display: flex;
    justify-content: flex-end;
  }
  .totals-table {
    width: 58%;
    font-size: 10pt;
    border-collapse: collapse;
  }
  .totals-table td {
    border: none;
    border-bottom: 1px solid #e1e8e6;
    padding: 2mm 2.5mm;
  }
  .totals-table td:last-child {
    text-align: right;
    font-weight: 700;
  }
  .total-due {
    font-size: 12pt;
    font-weight: 800;
    color: #0b4f47;
    background: #eaf5f2;
  }
  .settlement {
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .payment-info {
    margin-top: 6mm;
    padding: 4mm 5mm;
    border-left: 3px solid #087f73;
    background: #f3f8f6;
    font-size: 9pt;
  }
  .notes {
    margin-top: 10px;
    font-size: 9pt;
  }
  .footer {
    margin-top: 8mm;
    text-align: center;
    font-size: 8pt;
    color: #333;
    border-top: 1px solid #ccd9d6;
    padding-top: 3mm;
  }
  .document-kicker { color: #087f73; font-size: 8pt; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
  .muted { color: #53635f; }
  @media print {
    .container {
      max-width: 100%;
    }
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="provider-info">
      ${logoUrl ? `<img src="${logoUrl}" alt="Logo" class="logo" />` : ''}
      <div class="document-kicker">Furnizor</div>
      <h2>${escapeHtml(pfaName)}</h2>
      ${pfaTitular ? `<p>Titular: ${escapeHtml(pfaTitular)}</p>` : ''}
      ${pfaCui ? `<p>CUI/CNP: ${escapeHtml(pfaCui)}</p>` : ''}
      ${pfaRegCom ? `<p>Nr. Reg. Com.: ${escapeHtml(pfaRegCom)}</p>` : ''}
      ${pfaAddress ? `<p>Adresă: ${escapeHtml(pfaAddress)}</p>` : ''}
      ${pfaCounty || pfaCity ? `<p>${escapeHtml(pfaCounty)} ${escapeHtml(pfaCity)}</p>` : ''}
      ${pfaPhone ? `<p>Tel: ${escapeHtml(pfaPhone)}</p>` : ''}
      ${pfaEmail ? `<p>Email: ${escapeHtml(pfaEmail)}</p>` : ''}
      ${pfaIban ? `<p>IBAN: ${escapeHtml(pfaIban)}</p>` : ''}
      ${pfaBank ? `<p>Banca: ${escapeHtml(pfaBank)}</p>` : ''}
    </div>
    <div class="invoice-title-block">
      <h1>${title}</h1>
      <div class="muted">Document comercial</div>
      <div class="invoice-details">
        <div><strong>Seria:</strong> ${escapeHtml(doc.series || '-')}</div>
        <div><strong>Nr.:</strong> ${escapeHtml(String(doc.number || '-'))}</div>
        <div><strong>Data emiterii:</strong> ${issueDate}</div>
        ${dueDate ? `<div><strong>Scadență:</strong> ${dueDate}</div>` : ''}
        ${paymentTerms ? `<div><strong>Termen plată:</strong> ${escapeHtml(paymentTerms)}</div>` : ''}
        <div><strong>Monedă:</strong> ${escapeHtml(currency)}</div>
      </div>
    </div>
  </div>

  <div class="client-section">
    <h3>Client / Beneficiar</h3>
    <p><strong>Denumire/Nume:</strong> ${escapeHtml(clientName)}</p>
    ${clientCui ? `<p><strong>CUI/CNP:</strong> ${escapeHtml(clientCui)}</p>` : ''}
    ${clientRegCom ? `<p><strong>Nr. Reg. Com.:</strong> ${escapeHtml(clientRegCom)}</p>` : ''}
    ${clientAddress ? `<p><strong>Adresă:</strong> ${escapeHtml(clientAddress)}</p>` : ''}
    ${clientCounty || clientCity ? `<p><strong>Localitate:</strong> ${escapeHtml(clientCounty)} ${escapeHtml(clientCity)}</p>` : ''}
    ${clientEmail ? `<p><strong>Email:</strong> ${escapeHtml(clientEmail)}</p>` : ''}
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:4%">Nr. crt.</th>
        <th style="width:32%">Denumire produs/serviciu</th>
        <th style="width:6%">UM</th>
        <th style="width:8%">Cant.</th>
        <th style="width:10%">Preț unitar</th>
        <th style="width:12%">Valoare fără TVA</th>
        <th style="width:6%">Cota TVA</th>
        <th style="width:10%">Valoare TVA</th>
        <th style="width:12%">Total cu TVA</th>
      </tr>
    </thead>
    <tbody>${linesHtml}</tbody>
  </table>

  <div class="settlement">
  <div class="totals">
    <table class="totals-table">
      ${vatSummary.map(s => `
        <tr><td>Bază TVA ${s.rate.toFixed(0)}%:</td><td>${formatCurrency(s.base, currency)}</td></tr>
        <tr><td>TVA ${s.rate.toFixed(0)}%:</td><td>${formatCurrency(s.vat, currency)}</td></tr>
      `).join('')}
      <tr><td>Subtotal fără TVA:</td><td>${formatCurrency(taxableBase, currency)}</td></tr>
      <tr><td>Total TVA:</td><td>${formatCurrency(vatTotal, currency)}</td></tr>
      ${finalTotalsRows}
    </table>
  </div>

  <div class="payment-info">
    <div class="document-kicker">Detalii de plată</div>
    <strong>Modalitate de plată:</strong> ${escapeHtml(paymentMethod)}<br>
    ${pfaIban ? `<strong>IBAN:</strong> ${escapeHtml(pfaIban)}<br>` : ''}
    ${pfaBank ? `<strong>Beneficiar:</strong> ${escapeHtml(pfaName)} – ${escapeHtml(pfaBank)}<br>` : ''}
    ${dueDate ? `<strong>Scadență:</strong> ${dueDate}` : ''}
  </div>

  ${notes ? `<div class="notes"><strong>Observații:</strong> ${escapeHtml(notes)}</div>` : ''}
  </div>

  <div class="footer">
    ${footerText}
    <p>${isProforma ? 'Proforma' : 'Factura'} ${escapeHtml(docNumber)} | Document generat electronic</p>
  </div>
</div>
</body>
</html>`;
}

/**
 * Generează HTML-ul pentru o factură A4
 * @param {object} invoice - datele facturii (cu client și linii incluse)
 * @param {object} pfaSettings - setările PFA (date furnizor)
 * @returns {string} HTML complet pentru printare
 */
export function generateInvoiceHtml(invoice, pfaSettings = {}) {
  return generateDocumentHtml(invoice, pfaSettings, false);
}

/**
 * Generează HTML pentru proformă (titlu PROFORMĂ, restul identic)
 * @param {object} proforma
 * @param {object} pfaSettings
 * @returns {string} HTML
 */
export function generateProformaHtml(proforma, pfaSettings = {}) {
  return generateDocumentHtml(proforma, pfaSettings, true);
}

/**
 * Printează HTML-ul folosind un iframe ascuns (fără pop-up)
 * @param {string} html - conținutul HTML complet
 */
async function printHtml(html) {
  const existingFrame = document.getElementById('print-frame');
  if (existingFrame) existingFrame.remove();

  const iframe = document.createElement('iframe');
  iframe.id = 'print-frame';
  iframe.style.cssText = 'position: fixed; width: 0; height: 0; border: none; visibility: hidden;';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  iframe.contentWindow.onafterprint = () => {
    setTimeout(() => iframe.remove(), 100);
  };

  const imagesReady = Promise.all(Array.from(doc.images).map(image => {
    if (image.complete) return Promise.resolve();
    return new Promise(resolve => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    });
  }));
  const fontsReady = doc.fonts?.ready || Promise.resolve();
  const timeout = new Promise(resolve => setTimeout(resolve, 2000));

  await Promise.race([Promise.all([imagesReady, fontsReady]), timeout]);
  iframe.contentWindow.focus();
  iframe.contentWindow.print();
}

/**
 * Deschide fereastra de printare pentru factură
 * @param {object} invoice - datele facturii
 * @param {object} pfaSettings - setările PFA
 */
export function printInvoice(invoice, pfaSettings = {}) {
  const html = generateInvoiceHtml(invoice, pfaSettings);
  printHtml(html);
}

/**
 * Deschide fereastra de printare pentru proformă
 * @param {object} proforma
 * @param {object} pfaSettings
 */
export function printProforma(proforma, pfaSettings = {}) {
  const html = generateProformaHtml(proforma, pfaSettings);
  printHtml(html);
}

function previewHtml(html, title) {
  const content = `
    <div class="document-preview-toolbar">
      <p id="preview-status" aria-live="polite">Se pregătește documentul…</p>
      <div class="flex gap-1">
        <button type="button" class="btn btn-primary" id="preview-print" disabled>Tipărește / Salvează PDF</button>
        <button type="button" class="btn btn-outline" id="preview-close">Închide</button>
      </div>
    </div>
    <iframe class="document-preview-frame" title="Previzualizare ${escapeHtml(title)}"></iframe>
  `;
  const { modalElement, close } = createModal({
    title: `Previzualizare ${title}`,
    content,
    size: 'lg',
    closeOnOverlayClick: false,
    skipCloseAll: true
  });
  const frame = modalElement.querySelector('.document-preview-frame');
  const printButton = modalElement.querySelector('#preview-print');
  const status = modalElement.querySelector('#preview-status');
  frame.addEventListener('load', () => {
    printButton.disabled = false;
    status.textContent = 'Documentul este pregătit pentru verificare și tipărire.';
  }, { once: true });
  frame.srcdoc = html;
  printButton.addEventListener('click', () => printHtml(html));
  modalElement.querySelector('#preview-close').addEventListener('click', close);
}

export function previewInvoice(invoice, pfaSettings = {}) {
  previewHtml(generateInvoiceHtml(invoice, pfaSettings), 'factură');
}

export function previewProforma(proforma, pfaSettings = {}) {
  previewHtml(generateProformaHtml(proforma, pfaSettings), 'proformă');
}
