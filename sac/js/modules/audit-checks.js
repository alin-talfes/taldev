// js/modules/audit-checks.js
// Verificări deterministe, fără efecte secundare, pentru modulul Audit.

const TOLERANCE = 0.02;

export function runAuditChecks(snapshot, year) {
  const findings = [];
  const rules = [];
  const addRule = (id, category, label, issues, okText) => {
    findings.push(...issues);
    rules.push({ id, category, label, count: issues.length, severity: maxSeverity(issues), okText });
  };

  checkSources(snapshot, addRule);
  checkSettings(snapshot, addRule);
  checkPartners(snapshot, addRule);
  checkSeries(snapshot, year, addRule);
  checkInvoices(snapshot, year, addRule);
  checkReceivedInvoices(snapshot, year, addRule);
  checkTransactions(snapshot, addRule);
  checkAssets(snapshot, addRule);

  return { findings, rules };
}

function checkSources(s, addRule) {
  const issues = (s.sourceStatus || []).filter(x => !x.ok).map(x => issue(
    'error', 'Acoperire audit', `Sursa „${x.name}” nu a putut fi citită`, x.error || 'Eroare necunoscută', '#/dashboard'
  ));
  addRule('sources', 'Acoperire audit', 'Toate sursele necesare sunt accesibile', issues, 'Toate sursele au fost citite.');
}

function checkSettings(s, addRule) {
  const settings = s.settings;
  const missing = !settings ? ['configurarea PFA'] : [
    !text(settings.legal_name) && 'denumire PFA',
    !text(settings.titular_name) && 'titular',
    !text(settings.cui) && 'identificator fiscal'
  ].filter(Boolean);
  addRule('settings', 'Configurare', 'Datele PFA de bază sunt complete', missing.length ? [issue(
    'error', 'Configurare', 'Configurare PFA incompletă', `Lipsesc: ${missing.join(', ')}.`, '#/settings'
  )] : [], 'Identificarea PFA este completă.');

  const bankIssues = [];
  if (!s.bankAccounts.length) bankIssues.push(issue('warning', 'Configurare', 'Nu există cont bancar configurat', 'Verifică dacă operațiunile bancare și documentele necesită un cont implicit.', '#/settings'));
  const defaults = s.bankAccounts.filter(a => a.is_default === true);
  if (defaults.length > 1) bankIssues.push(issue('error', 'Configurare', 'Există mai multe conturi bancare implicite', `${defaults.length} conturi sunt marcate implicit.`, '#/settings'));
  if (settings?.default_bank_account_id && !s.bankAccounts.some(a => a.id === settings.default_bank_account_id)) {
    bankIssues.push(issue('error', 'Configurare', 'Contul bancar implicit nu mai există', 'Configurarea indică un cont bancar inexistent.', '#/settings'));
  }
  addRule('banks', 'Configurare', 'Conturile bancare sunt coerente', bankIssues, 'Configurarea conturilor bancare este coerentă.');
}

function checkPartners(s, addRule) {
  addRule('clients', 'Parteneri', 'Clienții nu au identificatori fiscali duplicați', duplicateTaxIds(s.clients, 'client', '#/clients'), 'Nu există CUI/CNP duplicat la clienți.');
  addRule('suppliers', 'Parteneri', 'Furnizorii nu au identificatori fiscali duplicați', duplicateTaxIds(s.suppliers, 'furnizor', '#/suppliers'), 'Nu există CUI/CNP duplicat la furnizori.');
}

function duplicateTaxIds(rows, label, route) {
  const map = new Map();
  for (const row of rows) {
    const id = text(row.cui).toUpperCase().replace(/\s+/g, '');
    if (!id) continue;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  }
  return [...map.entries()].filter(([, items]) => items.length > 1).map(([id, items]) => issue(
    'warning', 'Parteneri', `Identificator fiscal duplicat la ${label}i`, `${id} apare de ${items.length} ori.`, route
  ));
}

function checkSeries(s, year, addRule) {
  const issued = s.invoices.filter(i => i.document_status !== 'DRAFT' && Number(yearOf(i.issue_date)) === Number(year));
  const issues = [];
  const active = s.invoiceSeries.filter(x => x.active === true && Number(x.year) === Number(year));
  if (!active.length && issued.length) issues.push(issue('error', 'Serii facturare', `Nu există serie activă pentru ${year}`, 'Există facturi emise în anul verificat, dar nicio serie activă configurată.', '#/settings'));
  for (const series of s.invoiceSeries.filter(x => Number(x.year) === Number(year))) {
    const maxUsed = issued.filter(i => text(i.series) === text(series.series)).map(i => integer(i.number)).filter(Number.isInteger).reduce((m, n) => Math.max(m, n), 0);
    if (maxUsed && Number(series.next_number) <= maxUsed) issues.push(issue(
      'error', 'Serii facturare', `Număr următor invalid pentru seria ${text(series.series)}`, `Număr următor: ${series.next_number}; maxim utilizat: ${maxUsed}.`, '#/settings'
    ));
  }
  addRule('series', 'Serii facturare', 'Numerotarea configurată este coerentă', issues, 'Nu au fost detectate contradicții în seriile de facturare.');
}

function checkInvoices(s, year, addRule) {
  const rows = s.invoices.filter(i => Number(yearOf(i.issue_date)) === Number(year));
  const identity = [];
  const reconciliation = [];
  const fx = [];
  const sequence = [];
  const seen = new Map();

  for (const inv of rows) {
    const id = invoiceId(inv);
    if (inv.document_status !== 'DRAFT' && (!text(inv.series) || integer(inv.number) === null)) identity.push(issue('error', 'Facturi emise', `Identitate incompletă: ${id}`, 'Factura emisă trebuie să aibă serie și număr.', '#/invoices'));
    if (!inv.client_id) identity.push(issue('error', 'Facturi emise', `Client lipsă: ${id}`, 'Factura nu are client asociat.', '#/invoices'));
    if (inv.due_date && inv.issue_date && inv.due_date < inv.issue_date) identity.push(issue('warning', 'Facturi emise', `Scadență înainte de emitere: ${id}`, 'Verifică datele documentului.', '#/invoices'));
    if (inv.document_status === 'DRAFT' && ageDays(inv.created_at) > 30) identity.push(issue('info', 'Facturi emise', `Ciornă veche: ${id}`, 'Ciorna are peste 30 de zile.', '#/invoices'));

    const key = inv.document_status === 'DRAFT' ? '' : `${text(inv.series).toUpperCase()}|${integer(inv.number)}|${yearOf(inv.issue_date)}`;
    if (key) {
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(inv);
    }

    const total = num(inv.total), paid = num(inv.paid_total), balance = num(inv.balance_due);
    if (Math.abs(total - paid - balance) > TOLERANCE) reconciliation.push(issue('error', 'Facturi emise', `Sold neconcordant: ${id}`, `Total ${fmt(total)}, achitat ${fmt(paid)}, sold ${fmt(balance)}.`, '#/invoices'));
    if (Array.isArray(inv.invoice_lines) && inv.invoice_lines.length) {
      const linesTotal = inv.invoice_lines.reduce((sum, line) => sum + num(line.total_amount), 0);
      if (Math.abs(linesTotal - total) > TOLERANCE) reconciliation.push(issue('error', 'Facturi emise', `Total linii neconcordant: ${id}`, `Linii ${fmt(linesTotal)} vs document ${fmt(total)}.`, '#/invoices'));
    }
    if (inv.payment_status === 'PAID' && Math.abs(balance) > TOLERANCE) reconciliation.push(issue('error', 'Facturi emise', `Status PAID cu sold: ${id}`, `Soldul este ${fmt(balance)}.`, '#/invoices'));
    if (text(inv.currency).toUpperCase() !== 'RON' && inv.document_status !== 'DRAFT' && (!(num(inv.document_exchange_rate) > 0) || !inv.document_exchange_rate_date)) {
      fx.push(issue('warning', 'Facturi emise', `Curs valutar incomplet: ${id}`, 'Factura în valută nu are curs și/sau data cursului documentului.', '#/invoices'));
    }
  }

  for (const items of seen.values()) if (items.length > 1) identity.push(issue('error', 'Facturi emise', 'Serie/număr duplicat', `${invoiceId(items[0])} apare de ${items.length} ori.`, '#/invoices'));
  sequence.push(...sequenceGaps(rows));

  addRule('invoice-id', 'Facturi emise', 'Identitatea și datele documentelor sunt coerente', identity, 'Identitatea facturilor este coerentă.');
  addRule('invoice-recon', 'Facturi emise', 'Totalurile și soldurile se reconciliază', reconciliation, 'Totalurile și soldurile facturilor se reconciliază.');
  addRule('invoice-seq', 'Facturi emise', 'Numerotarea nu are goluri evidente', sequence, 'Nu au fost detectate goluri de numerotare în intervalele analizate.');
  addRule('invoice-fx', 'Facturi emise', 'Facturile valutare au curs document', fx, 'Facturile valutare au informațiile de curs disponibile.');
}

function sequenceGaps(rows) {
  const groups = new Map();
  for (const inv of rows.filter(i => i.document_status !== 'DRAFT')) {
    const series = text(inv.series); const n = integer(inv.number); const year = yearOf(inv.issue_date);
    if (!series || n === null || !year) continue;
    const key = `${series.toUpperCase()}|${year}`;
    if (!groups.has(key)) groups.set(key, { series, year, numbers: new Set() });
    groups.get(key).numbers.add(n);
  }
  const issues = [];
  for (const g of groups.values()) {
    const nums = [...g.numbers].sort((a,b) => a-b);
    if (nums.length < 2 || nums.at(-1) - nums[0] > 5000) continue;
    const missing = [];
    for (let n = nums[0]; n <= nums.at(-1) && missing.length < 20; n++) if (!g.numbers.has(n)) missing.push(n);
    if (missing.length) issues.push(issue('warning', 'Facturi emise', `Goluri în seria ${g.series}/${g.year}`, `Numere lipsă: ${missing.join(', ')}${missing.length === 20 ? '…' : ''}.`, '#/invoices'));
  }
  return issues;
}

function checkReceivedInvoices(s, year, addRule) {
  const rows = s.receivedInvoices.filter(i => Number(yearOf(i.document_date)) === Number(year));
  const issues = []; const seen = new Map();
  for (const inv of rows) {
    const id = receivedId(inv);
    if (!inv.supplier_id) issues.push(issue('error', 'Facturi primite', `Furnizor lipsă: ${id}`, 'Factura primită nu are furnizor asociat.', '#/received-invoices'));
    if (inv.due_date && inv.document_date && inv.due_date < inv.document_date) issues.push(issue('warning', 'Facturi primite', `Scadență înainte de document: ${id}`, 'Verifică datele facturii.', '#/received-invoices'));
    const total = num(inv.total), paid = num(inv.paid_total), balance = num(inv.balance_due);
    if (Math.abs(total - paid - balance) > TOLERANCE) issues.push(issue('error', 'Facturi primite', `Sold neconcordant: ${id}`, `Total ${fmt(total)}, plătit ${fmt(paid)}, sold ${fmt(balance)}.`, '#/received-invoices'));
    if (Array.isArray(inv.received_invoice_lines) && inv.received_invoice_lines.length) {
      const linesTotal = inv.received_invoice_lines.reduce((sum, line) => sum + num(line.total_amount), 0);
      if (Math.abs(linesTotal - total) > TOLERANCE) issues.push(issue('error', 'Facturi primite', `Total linii neconcordant: ${id}`, `Linii ${fmt(linesTotal)} vs document ${fmt(total)}.`, '#/received-invoices'));
    }
    if (inv.deductible_status === 'NEEDS_VERIFICATION') issues.push(issue('warning', 'Facturi primite', `Deductibilitate neverificată: ${id}`, 'Tratamentul fiscal este încă marcat „Necesită verificare”.', '#/received-invoices'));
    if (inv.deductible_status === 'PARTIALLY_DEDUCTIBLE' && !(num(inv.deductibility_percent) > 0 || num(inv.deductibility_limit) > 0)) issues.push(issue('error', 'Facturi primite', `Deductibilitate parțială incompletă: ${id}`, 'Lipsește procentul sau limita de deductibilitate.', '#/received-invoices'));
    if (text(inv.currency).toUpperCase() !== 'RON' && inv.document_status !== 'DRAFT' && (!(num(inv.document_exchange_rate) > 0) || !inv.document_exchange_rate_date)) issues.push(issue('warning', 'Facturi primite', `Curs valutar incomplet: ${id}`, 'Documentul în valută nu are curs și/sau data cursului.', '#/received-invoices'));
    const key = `${inv.supplier_id || ''}|${text(inv.series).toUpperCase()}|${text(inv.number).toUpperCase()}|${yearOf(inv.document_date)}`;
    if (!seen.has(key)) seen.set(key, []); seen.get(key).push(inv);
  }
  for (const items of seen.values()) if (items.length > 1) issues.push(issue('error', 'Facturi primite', 'Factură furnizor duplicată', `${receivedId(items[0])} apare de ${items.length} ori pentru același furnizor.`, '#/received-invoices'));
  addRule('received', 'Facturi primite', 'Documentele primite sunt coerente', issues, 'Nu au fost detectate neconcordanțe evidente la facturile primite.');
}

function checkTransactions(s, addRule) {
  const issues = [];
  for (const tx of s.transactions) {
    const id = `${tx.transaction_date || '-'} · ${text(tx.description || tx.counterparty_name || tx.transaction_type || tx.id)}`;
    if (tx.status === 'CONFIRMED' && !(num(tx.amount) > 0)) issues.push(issue('error', 'Tranzacții', `Sumă nevalidă: ${id}`, 'Tranzacția confirmată nu are sumă pozitivă.', '#/other-operations'));
    if (tx.status === 'CONFIRMED' && tx.payment_method === 'BANK' && !tx.bank_account_id) issues.push(issue('warning', 'Tranzacții', `Cont bancar lipsă: ${id}`, 'Tranzacția bancară confirmată nu are cont asociat.', '#/other-operations'));
    if (tx.status === 'CONFIRMED' && text(tx.currency).toUpperCase() !== 'RON' && !(num(tx.bank_amount_ron ?? tx.amount_ron) > 0)) issues.push(issue('warning', 'Tranzacții', `Echivalent RON lipsă: ${id}`, 'Tranzacția valutară confirmată nu are echivalent RON pozitiv.', '#/other-operations'));
    if (Array.isArray(tx.transaction_allocations)) {
      const allocated = tx.transaction_allocations.reduce((sum, a) => sum + num(a.allocated_amount), 0);
      if (allocated - num(tx.amount) > TOLERANCE) issues.push(issue('error', 'Tranzacții', `Alocări peste sumă: ${id}`, `Alocat ${fmt(allocated)} din ${fmt(tx.amount)}.`, '#/other-operations'));
    }
    if (tx.status === 'PENDING' && ageDays(tx.created_at || tx.transaction_date) > 7) issues.push(issue('info', 'Tranzacții', `Operațiune pending veche: ${id}`, 'Operațiunea este neconfirmată de peste 7 zile.', '#/other-operations'));
  }
  addRule('transactions', 'Tranzacții', 'Tranzacțiile și alocările sunt coerente', issues, 'Tranzacțiile analizate nu au neconcordanțe evidente.');
}

function checkAssets(s, addRule) {
  const issues = []; const inventoryNumbers = new Map();
  for (const asset of s.fixedAssets) {
    const id = text(asset.name || asset.inventory_number || asset.id);
    if (!text(asset.inventory_number)) issues.push(issue('warning', 'Mijloace fixe', `Număr de inventar lipsă: ${id}`, 'Mijlocul fix nu are număr de inventar.', '#/fixed-assets'));
    else {
      const key = text(asset.inventory_number).toUpperCase();
      if (!inventoryNumbers.has(key)) inventoryNumbers.set(key, []); inventoryNumbers.get(key).push(asset);
    }
    const acquisition = num(asset.acquisition_value), accumulated = num(asset.accumulated_depreciation);
    if (!(acquisition > 0)) issues.push(issue('error', 'Mijloace fixe', `Valoare de intrare nevalidă: ${id}`, 'Valoarea de achiziție trebuie să fie pozitivă.', '#/fixed-assets'));
    if (accumulated - acquisition > TOLERANCE) issues.push(issue('error', 'Mijloace fixe', `Amortizare peste valoarea de intrare: ${id}`, `Amortizare ${fmt(accumulated)} vs valoare ${fmt(acquisition)}.`, '#/fixed-assets'));
    if (asset.depreciation_method !== 'NONE' && ['depreciating','in_service'].includes(asset.status)) {
      if (!(num(asset.useful_life_months ?? asset.useful_life) > 0)) issues.push(issue('warning', 'Mijloace fixe', `Durată de utilizare lipsă: ${id}`, 'Mijlocul fix în amortizare nu are durată utilă pozitivă.', '#/fixed-assets'));
      if (!asset.depreciation_start_date) issues.push(issue('warning', 'Mijloace fixe', `Data amortizării lipsește: ${id}`, 'Lipsește data începerii amortizării.', '#/fixed-assets'));
      if (asset.depreciation_start_date && asset.acquisition_date && asset.depreciation_start_date < asset.acquisition_date) issues.push(issue('error', 'Mijloace fixe', `Amortizare înainte de achiziție: ${id}`, 'Data începerii amortizării este anterioară achiziției.', '#/fixed-assets'));
    }
  }
  for (const [n, items] of inventoryNumbers) if (items.length > 1) issues.push(issue('error', 'Mijloace fixe', `Număr de inventar duplicat: ${n}`, `Este folosit de ${items.length} mijloace fixe.`, '#/fixed-assets'));
  addRule('assets', 'Mijloace fixe', 'Registrul mijloacelor fixe este coerent', issues, 'Nu au fost detectate neconcordanțe evidente la mijloacele fixe.');
}

function issue(severity, category, title, detail, route) { return { severity, category, title, detail, route }; }
function maxSeverity(items) { return items.some(x => x.severity === 'error') ? 'error' : items.some(x => x.severity === 'warning') ? 'warning' : items.some(x => x.severity === 'info') ? 'info' : 'ok'; }
function text(v) { return v == null ? '' : String(v).trim(); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function integer(v) { const s = text(v); if (!/^-?\d+$/.test(s)) return null; const n = Number(s); return Number.isSafeInteger(n) ? n : null; }
function yearOf(v) { if (!v) return null; const m = String(v).match(/^(\d{4})-/); if (m) return Number(m[1]); const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.getFullYear(); }
function ageDays(v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? 0 : Math.floor((Date.now() - d.getTime()) / 86400000); }
function fmt(v) { return num(v).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function invoiceId(i) { return text(i.series) && integer(i.number) !== null ? `${text(i.series)}-${integer(i.number)}` : text(i.id).slice(0,8) || 'fără ID'; }
function receivedId(i) { return `${text(i.series) ? `${text(i.series)}-` : ''}${text(i.number) || text(i.id).slice(0,8) || 'fără ID'}`; }
