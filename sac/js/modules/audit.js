// js/modules/audit.js
// Audit read-only: consistență internă + istoric audit_logs. Nu modifică date.

import {
  auditApi, settingsApi, bankAccountsApi, invoiceSeriesApi, clientsApi, suppliersApi,
  invoicesApi, receivedInvoicesApi, transactionsApi, fixedAssetsApi
} from '../api.js';
import { escapeHtml, formatDateTime } from '../utils.js';
import { renderSkeleton } from '../ui.js';
import { runAuditChecks } from './audit-checks.js';

const PAGE_SIZE = 500;
const MAX_PAGES = 40;
const AUDIT_LOG_LIMIT = 500;
const ORDER = { error: 0, warning: 1, info: 2 };
let year = new Date().getFullYear();
let findings = [], rules = [], logs = [], sourceStatus = [];
let severity = 'all', category = 'all';

export async function render(container, params = {}) {
  year = normalizeYear(params.year || year);
  container.innerHTML = `
    <div class="page-header">
      <div class="page-heading"><h2>Audit</h2><p>Control intern read-only pentru integritatea datelor și trasabilitatea modificărilor.</p></div>
      <div class="audit-header-actions">
        <label class="audit-year-control"><span>An verificat</span><select id="audit-year">${yearOptions()}</select></label>
        <button class="btn btn-outline" id="audit-export" type="button" disabled>Exportă CSV</button>
        <button class="btn btn-primary" id="audit-run" type="button">Rulează auditul</button>
      </div>
    </div>
    <div class="alert alert-info audit-scope-note"><strong>Domeniu:</strong> verificări tehnice și de consistență internă. Rezultatul nu certifică automat conformitatea fiscală sau contabilă.</div>
    <div id="audit-content">${renderSkeleton(6)}</div>`;
  container.querySelector('#audit-year').value = String(year);
  container.querySelector('#audit-year').addEventListener('change', e => { year = normalizeYear(e.target.value); runAudit(); });
  container.querySelector('#audit-run').addEventListener('click', runAudit);
  container.querySelector('#audit-export').addEventListener('click', exportCsv);
  await runAudit();
}

export function destroy() { findings = []; rules = []; logs = []; sourceStatus = []; severity = 'all'; category = 'all'; }

async function runAudit() {
  const content = document.getElementById('audit-content');
  const button = document.getElementById('audit-run');
  const exportButton = document.getElementById('audit-export');
  if (!content) return;
  button.disabled = true; button.textContent = 'Se verifică...'; exportButton.disabled = true;
  content.innerHTML = renderSkeleton(6);
  try {
    const snapshot = await loadSnapshot(year);
    sourceStatus = snapshot.sourceStatus;
    logs = snapshot.auditLogs.filter(x => yearOf(x.created_at) === year);
    ({ findings, rules } = runAuditChecks(snapshot, year));
    findings.sort((a,b) => (ORDER[a.severity] - ORDER[b.severity]) || a.category.localeCompare(b.category, 'ro'));
    severity = 'all'; category = 'all';
    renderResults(); exportButton.disabled = findings.length === 0;
  } catch (error) {
    console.error('Audit SAC:', error);
    content.innerHTML = `<div class="alert alert-error"><strong>Auditul nu a putut fi finalizat.</strong><br>${escapeHtml(error.message || 'Eroare necunoscută')}</div>`;
  } finally { button.disabled = false; button.textContent = 'Rulează auditul'; }
}

async function loadSnapshot(selectedYear) {
  const fromDate = `${selectedYear}-01-01`, toDate = `${selectedYear}-12-31`;
  const sources = [
    ['Setări PFA','settings',() => settingsApi.getSettings(),null],
    ['Conturi bancare','bankAccounts',() => bankAccountsApi.list(),[]],
    ['Serii facturi','invoiceSeries',() => invoiceSeriesApi.list(),[]],
    ['Clienți','clients',() => clientsApi.list({}),[]],
    ['Furnizori','suppliers',() => suppliersApi.list({}),[]],
    ['Facturi emise','invoices',() => loadAllInvoices({ fromDate, toDate }),[]],
    ['Facturi primite','receivedInvoices',() => receivedInvoicesApi.list({}),[]],
    ['Tranzacții','transactions',() => transactionsApi.list({ fromDate, toDate }),[]],
    ['Mijloace fixe','fixedAssets',() => fixedAssetsApi.list(),[]],
    ['Jurnal audit','auditLogs',() => auditApi.list(null, null, AUDIT_LOG_LIMIT),[]]
  ];
  const settled = await Promise.allSettled(sources.map(x => x[2]()));
  const snapshot = { sourceStatus: [] };
  settled.forEach((result, i) => {
    const [name,key,,fallback] = sources[i];
    if (result.status === 'fulfilled') { snapshot[key] = result.value ?? fallback; snapshot.sourceStatus.push({ name, ok:true }); }
    else { snapshot[key] = fallback; snapshot.sourceStatus.push({ name, ok:false, error:result.reason?.message || 'Eroare la citire' }); }
  });
  snapshot.bankAccounts = arr(snapshot.bankAccounts); snapshot.invoiceSeries = arr(snapshot.invoiceSeries);
  snapshot.clients = arr(snapshot.clients); snapshot.suppliers = arr(snapshot.suppliers); snapshot.invoices = arr(snapshot.invoices);
  snapshot.receivedInvoices = arr(snapshot.receivedInvoices); snapshot.transactions = arr(snapshot.transactions);
  snapshot.fixedAssets = arr(snapshot.fixedAssets); snapshot.auditLogs = arr(snapshot.auditLogs);
  return snapshot;
}

async function loadAllInvoices(filters) {
  const all = []; let page = 1; let expected = 0;
  while (page <= MAX_PAGES) {
    const result = await invoicesApi.list({ ...filters, page, pageSize: PAGE_SIZE });
    const rows = arr(result?.data); expected = Number(result?.count ?? rows.length); all.push(...rows);
    if (rows.length < PAGE_SIZE || all.length >= expected) break; page++;
  }
  if (expected && all.length < expected) throw new Error(`Audit incomplet: ${all.length} din ${expected} facturi încărcate.`);
  return all;
}

function renderResults() {
  const content = document.getElementById('audit-content'); if (!content) return;
  const counts = countSeverity(findings); const ok = rules.filter(r => r.count === 0).length;
  const coverage = sourceStatus.filter(x => x.ok).length;
  const status = counts.error ? ['Necesită remediere','danger'] : counts.warning ? ['Cu observații','warning'] : ['Fără probleme detectate','success'];
  const categories = [...new Set(findings.map(x => x.category))].sort((a,b) => a.localeCompare(b,'ro'));
  content.innerHTML = `
    <div class="card audit-status-card audit-status-${status[1]}">
      <div><span class="card-eyebrow">Rezultat audit ${year}</span><h3>${status[0]}</h3><p>${findings.length ? `${findings.length} constatări necesită verificare.` : 'Nu au fost identificate neconcordanțe de regulile implementate.'}</p></div>
      <div class="audit-coverage"><strong>${coverage}/${sourceStatus.length}</strong><span>surse accesibile</span></div>
    </div>
    <div class="audit-summary-grid">
      ${summary('Critice', counts.error, 'Necesită prioritate','danger')}${summary('Atenționări', counts.warning, 'Necesită verificare','warning')}${summary('Informative', counts.info, 'De urmărit','info')}${summary('Reguli trecute', ok, `din ${rules.length}`,'success')}
    </div>
    <div class="card audit-filter-card"><div class="filters-row">
      <div class="form-group"><label for="audit-severity">Severitate</label><select id="audit-severity"><option value="all">Toate</option><option value="error">Critic</option><option value="warning">Atenționare</option><option value="info">Informativ</option></select></div>
      <div class="form-group"><label for="audit-category">Categorie</label><select id="audit-category"><option value="all">Toate</option>${categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select></div>
    </div></div>
    <div id="audit-findings"></div>
    ${renderRules()}
    ${renderLogs()}`;
  content.querySelector('#audit-severity').addEventListener('change', e => { severity = e.target.value; renderFindings(); });
  content.querySelector('#audit-category').addEventListener('change', e => { category = e.target.value; renderFindings(); });
  renderFindings();
}

function renderFindings() {
  const el = document.getElementById('audit-findings'); if (!el) return;
  const visible = findings.filter(x => (severity === 'all' || x.severity === severity) && (category === 'all' || x.category === category));
  if (!visible.length) { el.innerHTML = `<div class="card audit-empty-card"><strong>Nicio constatare pentru filtrele selectate.</strong><span>Schimbă filtrele sau rulează din nou auditul.</span></div>`; return; }
  el.innerHTML = `<div class="audit-findings-list">${visible.map(x => `<article class="audit-finding audit-finding-${x.severity}"><div class="audit-finding-main"><div class="audit-finding-meta"><span class="audit-severity audit-severity-${x.severity}">${severityLabel(x.severity)}</span><span class="audit-category">${escapeHtml(x.category)}</span></div><h4>${escapeHtml(x.title)}</h4><p>${escapeHtml(x.detail)}</p></div>${x.route ? `<a class="btn btn-sm btn-outline" href="${x.route}">Deschide modulul</a>` : ''}</article>`).join('')}</div>`;
}

function renderRules() {
  return `<div class="card audit-rules-card"><div class="card-header"><div><span class="card-eyebrow">Controale executate</span><h3>Reguli verificate</h3></div><span class="badge badge-muted">${rules.length}</span></div><div class="audit-rule-list">${rules.map(r => `<div class="audit-rule-row"><span class="audit-rule-status audit-rule-${r.severity}">${r.count ? severityLabel(r.severity) : 'OK'}</span><div><strong>${escapeHtml(r.label)}</strong><small>${escapeHtml(r.count ? `${r.count} constatări` : r.okText)}</small></div><span class="audit-rule-count">${r.count}</span></div>`).join('')}</div></div>`;
}

function renderLogs() {
  const visible = logs.slice(0,100);
  return `<div class="card audit-log-card"><div class="card-header"><div><span class="card-eyebrow">Trasabilitate</span><h3>Jurnal modificări ${year}</h3></div><span class="badge badge-muted">${logs.length}</span></div>${!visible.length ? '<p class="audit-empty-inline">Nu există evenimente audit disponibile pentru anul selectat.</p>' : `<div class="table-container audit-log-table-wrap"><table class="audit-log-table"><thead><tr><th>Data</th><th>Acțiune</th><th>Entitate</th><th>Actor</th><th>Detalii</th></tr></thead><tbody>${visible.map(l => `<tr><td>${escapeHtml(formatDateTime(l.created_at))}</td><td><span class="audit-log-action">${escapeHtml(action(l))}</span></td><td>${escapeHtml(entity(l))}</td><td>${escapeHtml(actor(l))}</td><td>${escapeHtml(change(l))}</td></tr>`).join('')}</tbody></table></div>${logs.length > 100 ? '<p class="audit-log-note">Sunt afișate primele 100 de evenimente.</p>' : ''}`}</div>`;
}

function action(l) { const v = text(l.action || l.operation || l.event_type || l.change_type).toUpperCase(); return ({INSERT:'Creare',CREATE:'Creare',UPDATE:'Modificare',DELETE:'Ștergere',ISSUE:'Emitere',CONFIRM:'Confirmare'})[v] || v || 'Eveniment'; }
function entity(l) { const t = text(l.entity_type || l.table_name || l.entity || 'entitate'); const id = text(l.entity_id || l.record_id || l.row_id); return `${t}${id ? ` · ${id.slice(0,8)}` : ''}`; }
function actor(l) { return text(l.user_email || l.actor_email || l.changed_by_email || l.user_id || l.actor_user_id || l.changed_by) || 'Utilizator autentificat'; }
function change(l) { const data = object(l.event_data) || object(l.metadata) || object(l.new_data); if (data) { const keys = Object.keys(data); if (keys.length) return keys.slice(0,6).join(', ') + (keys.length > 6 ? '…' : ''); } return text(l.details || l.description || l.message || l.reason) || '-'; }
function object(v) { if (v && typeof v === 'object' && !Array.isArray(v)) return v; if (typeof v === 'string') try { const p = JSON.parse(v); return p && typeof p === 'object' && !Array.isArray(p) ? p : null; } catch {} return null; }

function exportCsv() {
  if (!findings.length) return;
  const rows = [['An','Severitate','Categorie','Constatare','Detalii','Rută'], ...findings.map(x => [year,severityLabel(x.severity),x.category,x.title,x.detail,x.route || ''])];
  const csv = '\uFEFF' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `audit-sac-${year}.csv`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}

function summary(label,value,help,variant) { return `<div class="card audit-summary-card audit-summary-${variant}"><span>${label}</span><strong>${value || 0}</strong><small>${help}</small></div>`; }
function countSeverity(items) { return items.reduce((a,x) => (a[x.severity]++, a), { error:0, warning:0, info:0 }); }
function severityLabel(v) { return ({error:'Critic',warning:'Atenționare',info:'Informativ',ok:'OK'})[v] || v; }
function yearOptions() { const now = new Date().getFullYear(); return [...new Set([year,now,now-1,now-2,now-3,now-4])].filter(x => x >= 2000 && x <= now+1).sort((a,b)=>b-a).map(x => `<option value="${x}">${x}</option>`).join(''); }
function normalizeYear(v) { const now = new Date().getFullYear(), n = Number.parseInt(v,10); return Number.isInteger(n) && n >= 2000 && n <= now+1 ? n : now; }
function yearOf(v) { if (!v) return null; const m = String(v).match(/^(\d{4})-/); if (m) return Number(m[1]); const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.getFullYear(); }
function csvCell(v) { return `"${String(v ?? '').replace(/"/g,'""')}"`; }
function text(v) { return v == null ? '' : String(v).trim(); }
function arr(v) { return Array.isArray(v) ? v : []; }
