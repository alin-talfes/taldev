// js/modules/settings.js
// Modul Configurare – gestionează datele PFA, conturile bancare, seriile de facturare și proforme.
// UX îmbunătățit: skeleton loading, empty state, tooltips, feedback la submit

import { settingsApi, bankAccountsApi, invoiceSeriesApi, proformaSeriesApi } from '../api.js';
import { getCurrentUser } from '../auth.js';
import { showToast, escapeHtml, isValidTaxId, isValidRomanianIBAN } from '../utils.js';
import { createModal, renderTable, confirmDialog } from '../ui.js';

let currentTab = 'general';
let pfaSettings = null;
let bankAccounts = [];
let invoiceSeriesList = [];
let proformaSeriesList = [];

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-heading"><h2>Configurare PFA</h2><p>Configurează datele care apar pe documente și regulile implicite folosite de aplicație.</p></div>
    </div>
    <nav class="report-tabs settings-tabs" aria-label="Secțiuni configurare">
      <button class="report-tab ${currentTab === 'general' ? 'active' : ''}" data-tab="general"><span aria-hidden="true">◎</span><span><strong>Date generale</strong><small>Identitate și contact</small></span></button>
      <button class="report-tab ${currentTab === 'fiscal' ? 'active' : ''}" data-tab="fiscal"><span aria-hidden="true">%</span><span><strong>Date fiscale</strong><small>TVA și termene</small></span></button>
      <button class="report-tab ${currentTab === 'bank' ? 'active' : ''}" data-tab="bank"><span aria-hidden="true">▤</span><span><strong>Conturi bancare</strong><small>IBAN și monede</small></span></button>
      <button class="report-tab ${currentTab === 'series' ? 'active' : ''}" data-tab="series"><span aria-hidden="true">#</span><span><strong>Serii facturare</strong><small>Numerotare facturi</small></span></button>
      <button class="report-tab ${currentTab === 'proforma-series' ? 'active' : ''}" data-tab="proforma-series"><span aria-hidden="true">◇</span><span><strong>Serii proforme</strong><small>Numerotare proforme</small></span></button>
    </nav>
    <div id="settings-content"></div>
  `;

  container.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab = btn.getAttribute('data-tab');
      render(container);
    });
  });

  await loadSettingsData();
  renderCurrentTab(container);
}

export function destroy() {}

async function loadSettingsData() {
  try {
    pfaSettings = await settingsApi.getSettings();
    if (!pfaSettings) {
      pfaSettings = {
        legal_name: '',
        titular_name: '',
        cui: '',
        reg_com: '',
        address: '',
        county: '',
        city: '',
        phone: '',
        email: '',
        fiscal_regime: 'real',
        vat_status: 'neinregistrat',
        vat_rate: null,
        default_currency: 'RON',
        default_payment_terms: 14,
        default_bank_account_id: null,
        invoice_footer_text: '',
        logo_url: 'files/header.png'
      };
    }

    bankAccounts = await bankAccountsApi.list();
    invoiceSeriesList = await invoiceSeriesApi.list();
    proformaSeriesList = await proformaSeriesApi.list();
  } catch (error) {
    console.error('Eroare la încărcarea setărilor:', error);
    showToast(error.message, 'error');
  }
}

function renderCurrentTab(container) {
  const content = container.querySelector('#settings-content');
  if (!content) return;

  switch (currentTab) {
    case 'general':
      renderGeneralTab(content);
      break;
    case 'fiscal':
      renderFiscalTab(content);
      break;
    case 'bank':
      renderBankTab(content);
      break;
    case 'series':
      renderSeriesTab(content);
      break;
    case 'proforma-series':
      renderProformaSeriesTab(content);
      break;
    default:
      renderGeneralTab(content);
  }
}

function renderGeneralTab(content) {
  content.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div><span class="card-eyebrow">Identitatea PFA</span><h3>Date generale</h3></div>
        <button class="btn btn-primary btn-sm" id="save-general" title="Salvează datele generale">Salvează modificările</button>
      </div>
      <form id="general-form">
        <div class="form-section-heading"><span class="card-eyebrow">Identificare</span><h4>Denumire și date fiscale de bază</h4><p>Aceste informații apar pe facturi și proforme.</p></div>
        <div class="form-row">
          <div class="form-group">
            <label>Denumire PFA *</label>
            <input type="text" name="legal_name" value="${escapeHtml(pfaSettings.legal_name || '')}" required>
          </div>
          <div class="form-group">
            <label>Titular *</label>
            <input type="text" name="titular_name" value="${escapeHtml(pfaSettings.titular_name || '')}" required>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Identificator fiscal (CUI/CNP) *</label>
            <input type="text" name="cui" value="${escapeHtml(pfaSettings.cui || '')}" required>
          </div>
          <div class="form-group">
            <label>Registrul Comerțului</label>
            <input type="text" name="reg_com" value="${escapeHtml(pfaSettings.reg_com || '')}">
          </div>
        </div>
        <div class="form-section-heading"><span class="card-eyebrow">Sediu</span><h4>Adresă și localitate</h4></div>
        <div class="form-group">
          <label>Adresă sediu</label>
          <input type="text" name="address" value="${escapeHtml(pfaSettings.address || '')}">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Județ</label>
            <input type="text" name="county" value="${escapeHtml(pfaSettings.county || '')}">
          </div>
          <div class="form-group">
            <label>Localitate</label>
            <input type="text" name="city" value="${escapeHtml(pfaSettings.city || '')}">
          </div>
        </div>
        <div class="form-section-heading"><span class="card-eyebrow">Contact și documente</span><h4>Date opționale</h4></div>
        <div class="form-row">
          <div class="form-group">
            <label>Telefon</label>
            <input type="tel" name="phone" value="${escapeHtml(pfaSettings.phone || '')}">
          </div>
          <div class="form-group">
            <label>Email</label>
            <input type="email" name="email" value="${escapeHtml(pfaSettings.email || '')}">
          </div>
        </div>
        <div class="form-group">
          <label>Text subsol factură</label>
          <textarea name="invoice_footer_text">${escapeHtml(pfaSettings.invoice_footer_text || '')}</textarea>
        </div>
      </form>
    </div>
  `;

  document.getElementById('save-general').addEventListener('click', async () => {
    const form = document.getElementById('general-form');
    const formData = new FormData(form);
    const updates = {
      legal_name: formData.get('legal_name'),
      titular_name: formData.get('titular_name'),
      cui: formData.get('cui'),
      reg_com: formData.get('reg_com'),
      address: formData.get('address'),
      county: formData.get('county'),
      city: formData.get('city'),
      phone: formData.get('phone'),
      email: formData.get('email'),
      logo_url: 'files/header.png',
      invoice_footer_text: formData.get('invoice_footer_text')
    };

    if (updates.cui && !isValidTaxId(updates.cui)) {
      showToast('Identificator fiscal invalid. Introduceți CUI (2-10 cifre) sau CNP (13 cifre).', 'error');
      return;
    }

    try {
      pfaSettings = await settingsApi.saveSettings(updates);
      showToast('Setări generale salvate', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  });
}

function renderFiscalTab(content) {
  content.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div><span class="card-eyebrow">Reguli implicite</span><h3>Date fiscale</h3></div>
        <button class="btn btn-primary btn-sm" id="save-fiscal" title="Salvează datele fiscale">Salvează modificările</button>
      </div>
      <form id="fiscal-form">
        <div class="form-section-heading"><span class="card-eyebrow">Încadrare fiscală</span><h4>Regim și TVA</h4><p>Verifică aceste valori împreună cu specialistul contabil.</p></div>
        <div class="form-group">
          <label>Regim fiscal *</label>
          <select name="fiscal_regime" required>
            <option value="real" ${pfaSettings.fiscal_regime === 'real' ? 'selected' : ''}>Sistem real</option>
            <option value="norma_de_venit" ${pfaSettings.fiscal_regime === 'norma_de_venit' ? 'selected' : ''}>Normă de venit</option>
            <option value="micro" ${pfaSettings.fiscal_regime === 'micro' ? 'selected' : ''}>Microîntreprindere</option>
          </select>
        </div>
        <div class="form-group">
          <label>Statut TVA *</label>
          <select name="vat_status" required>
            <option value="neinregistrat" ${pfaSettings.vat_status === 'neinregistrat' ? 'selected' : ''}>Neînregistrat în scop TVA</option>
            <option value="inregistrat" ${pfaSettings.vat_status === 'inregistrat' ? 'selected' : ''}>Înregistrat în scop TVA</option>
            <option value="scutit" ${pfaSettings.vat_status === 'scutit' ? 'selected' : ''}>Scutit de TVA</option>
          </select>
        </div>
        <div class="form-group">
          <label>Cota TVA implicită (%)</label>
          <input type="number" step="0.01" min="0" max="100" name="vat_rate" value="${pfaSettings.vat_rate || ''}" placeholder="Ex: 19">
        </div>
        <div class="form-section-heading"><span class="card-eyebrow">Valori implicite</span><h4>Facturare</h4></div>
        <div class="form-row">
          <div class="form-group">
            <label>Monedă implicită</label>
            <select name="default_currency">
              <option value="RON" ${pfaSettings.default_currency === 'RON' ? 'selected' : ''}>RON</option>
              <option value="EUR" ${pfaSettings.default_currency === 'EUR' ? 'selected' : ''}>EUR</option>
              <option value="USD" ${pfaSettings.default_currency === 'USD' ? 'selected' : ''}>USD</option>
            </select>
          </div>
          <div class="form-group">
            <label>Termen de plată implicit (zile)</label>
            <input type="number" min="0" name="default_payment_terms" value="${pfaSettings.default_payment_terms || 14}">
          </div>
        </div>
        <div class="alert alert-warning">
          <strong>Atenție:</strong> Setările fiscale trebuie verificate conform legislației în vigoare.
        </div>
      </form>
    </div>
  `;

  document.getElementById('save-fiscal').addEventListener('click', async () => {
    const form = document.getElementById('fiscal-form');
    const formData = new FormData(form);
    const updates = {
      fiscal_regime: formData.get('fiscal_regime'),
      vat_status: formData.get('vat_status'),
      vat_rate: formData.get('vat_rate') ? parseFloat(formData.get('vat_rate')) : null,
      default_currency: formData.get('default_currency'),
      default_payment_terms: parseInt(formData.get('default_payment_terms'))
    };

    try {
      pfaSettings = await settingsApi.saveSettings(updates);
      showToast('Setări fiscale salvate', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  });
}

function renderBankTab(content) {
  content.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div><span class="card-eyebrow">Încasări și plăți</span><h3>Conturi bancare</h3></div>
        <button class="btn btn-primary btn-sm" id="add-bank" title="Adaugă cont bancar">＋ Cont nou</button>
      </div>
      <div id="bank-list">
        ${renderBankAccountsTable(bankAccounts)}
      </div>
    </div>
  `;

  document.getElementById('add-bank').addEventListener('click', () => {
    openBankModal();
  });

  content.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      if (action === 'edit') {
        const account = bankAccounts.find(a => a.id === id);
        if (account) openBankModal(account);
      } else if (action === 'delete') {
        const ok = await confirmDialog('Sigur dorești să ștergi acest cont bancar?');
        if (ok) {
          try {
            await bankAccountsApi.remove(id);
            bankAccounts = await bankAccountsApi.list();
            renderBankTab(content);
            showToast('Cont șters', 'success');
          } catch (error) {
            showToast(error.message, 'error');
          }
        }
      }
    });
  });
}

function openBankModal(account = null) {
  const isEdit = !!account;
  const title = isEdit ? 'Editează cont bancar' : 'Adaugă cont bancar';
  const formHtml = `
    <form id="bank-form">
      <div class="form-group">
        <label>IBAN *</label>
        <input type="text" name="iban" value="${account ? escapeHtml(account.iban) : ''}" required>
      </div>
      <div class="form-group">
        <label>Bancă</label>
        <input type="text" name="bank_name" value="${account ? escapeHtml(account.bank_name || '') : ''}">
      </div>
      <div class="form-group">
        <label>Monedă</label>
        <select name="currency">
          <option value="RON" ${account && account.currency === 'RON' ? 'selected' : ''}>RON</option>
          <option value="EUR" ${account && account.currency === 'EUR' ? 'selected' : ''}>EUR</option>
          <option value="USD" ${account && account.currency === 'USD' ? 'selected' : ''}>USD</option>
        </select>
      </div>
      <div class="form-group">
        <label>
          <input type="checkbox" name="is_active" ${account ? (account.is_active ? 'checked' : '') : 'checked'}>
          Activ
        </label>
      </div>
      <div class="form-group">
        <label>
          <input type="checkbox" name="is_default" ${account ? (account.is_default ? 'checked' : '') : ''}>
          Cont implicit
        </label>
      </div>
      <div class="flex gap-1 mt-2">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Actualizează' : 'Adaugă'}</button>
        <button type="button" class="btn btn-outline" id="bank-cancel">Anulează</button>
      </div>
    </form>
  `;

  const { modalElement, close } = createModal({ title, content: formHtml, closeOnOverlayClick: false });

  modalElement.querySelector('#bank-cancel').addEventListener('click', close);

  modalElement.querySelector('#bank-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = modalElement.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Se salvează...';
    }

    const form = e.target;
    const formData = new FormData(form);
    const data = {
      iban: formData.get('iban'),
      bank_name: formData.get('bank_name') || '',
      currency: formData.get('currency') || 'RON',
      is_active: formData.get('is_active') === 'on',
      is_default: formData.get('is_default') === 'on'
    };

    if (data.iban && !isValidRomanianIBAN(data.iban)) {
      showToast('IBAN invalid. Introduceți un IBAN românesc valid.', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isEdit ? 'Actualizează' : 'Adaugă';
      }
      return;
    }

    try {
      if (isEdit) {
        await bankAccountsApi.update(account.id, data);
        showToast('Cont actualizat', 'success');
      } else {
        await bankAccountsApi.create(data);
        showToast('Cont adăugat', 'success');
      }
      bankAccounts = await bankAccountsApi.list();
      close();
      renderBankTab(document.querySelector('#settings-content'));
    } catch (error) {
      showToast(error.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isEdit ? 'Actualizează' : 'Adaugă';
      }
    }
  });
}

function renderBankAccountsTable(accounts) {
  if (!accounts || accounts.length === 0) {
    return '<p class="text-center" style="color: var(--color-text-secondary); padding: 20px;">Nu există conturi bancare</p>';
  }

  const headers = [
    { label: 'IBAN', key: 'iban' },
    { label: 'Bancă', key: 'bank_name' },
    { label: 'Monedă', key: 'currency' },
    { label: 'Stare', key: 'status' },
    { label: 'Acțiuni', key: 'actions' }
  ];

  const rows = accounts.map(acc => ({
    iban: acc.iban,
    bank_name: acc.bank_name || '-',
    currency: acc.currency,
    status: `${acc.is_default ? '<span class="badge badge-info">Implicit</span> ' : ''}${acc.is_active ? '<span class="badge badge-success">Activ</span>' : '<span class="badge badge-muted">Inactiv</span>'}`,
    actions: `
      <div class="flex gap-1">
        <button class="btn btn-sm btn-outline" data-action="edit" data-id="${acc.id}" title="Editează cont">Editează</button>
        <button class="btn btn-sm btn-danger" data-action="delete" data-id="${acc.id}" title="Șterge cont">Șterge</button>
      </div>
    `
  }));

  return renderTable(headers, rows, { emptyMessage: 'Nu există conturi bancare', rawColumns: ['status', 'actions'] });
}

function renderSeriesTab(content) {
  content.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div><span class="card-eyebrow">Numerotare documente</span><h3>Serii de facturare</h3></div>
        <button class="btn btn-primary btn-sm" id="add-series" title="Adaugă serie de facturare">＋ Serie nouă</button>
      </div>
      <div id="series-list">
        ${renderInvoiceSeriesTable(invoiceSeriesList)}
      </div>
    </div>
  `;

  document.getElementById('add-series').addEventListener('click', () => {
    openInvoiceSeriesModal();
  });

  content.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      if (action === 'edit') {
        const series = invoiceSeriesList.find(s => s.id === id);
        if (series) openInvoiceSeriesModal(series);
      } else if (action === 'delete') {
        const ok = await confirmDialog('Sigur dorești să dezactivezi această serie? Facturile existente nu vor fi afectate.');
        if (ok) {
          try {
            await invoiceSeriesApi.update(id, { active: false });
            invoiceSeriesList = await invoiceSeriesApi.list();
            renderSeriesTab(content);
            showToast('Serie dezactivată', 'success');
          } catch (error) {
            showToast(error.message, 'error');
          }
        }
      }
    });
  });
}

function openInvoiceSeriesModal(series = null) {
  const isEdit = !!series;
  const title = isEdit ? 'Editează serie' : 'Adaugă serie';
  const currentYear = new Date().getFullYear();
  const formHtml = `
    <form id="series-form">
      <div class="form-group">
        <label>Seria *</label>
        <input type="text" name="series" value="${series ? escapeHtml(series.series) : ''}" required placeholder="Ex: FCT">
      </div>
      <div class="form-group">
        <label>An *</label>
        <input type="number" name="year" value="${series ? series.year : currentYear}" required min="2020" max="2100">
      </div>
      <div class="form-group">
        <label>Număr următor *</label>
        <input type="number" name="next_number" value="${series ? series.next_number : 1}" required min="1">
      </div>
      <div class="form-group">
        <label>
          <input type="checkbox" name="active" ${series ? (series.active ? 'checked' : '') : 'checked'}>
          Activă
        </label>
      </div>
      <div class="flex gap-1 mt-2">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Actualizează' : 'Adaugă'}</button>
        <button type="button" class="btn btn-outline" id="series-cancel">Anulează</button>
      </div>
    </form>
  `;

  const { modalElement, close } = createModal({ title, content: formHtml, closeOnOverlayClick: false });

  modalElement.querySelector('#series-cancel').addEventListener('click', close);

  modalElement.querySelector('#series-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = modalElement.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Se salvează...';
    }

    const form = e.target;
    const formData = new FormData(form);
    const data = {
      series: formData.get('series'),
      year: parseInt(formData.get('year')),
      next_number: parseInt(formData.get('next_number')),
      active: formData.get('active') === 'on'
    };

    try {
      if (isEdit) {
        await invoiceSeriesApi.update(series.id, data);
        showToast('Serie actualizată', 'success');
      } else {
        await invoiceSeriesApi.create(data);
        showToast('Serie adăugată', 'success');
      }
      invoiceSeriesList = await invoiceSeriesApi.list();
      close();
      renderSeriesTab(document.querySelector('#settings-content'));
    } catch (error) {
      showToast(error.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isEdit ? 'Actualizează' : 'Adaugă';
      }
    }
  });
}

function renderInvoiceSeriesTable(seriesList) {
  if (!seriesList || seriesList.length === 0) {
    return '<p class="text-center" style="color: var(--color-text-secondary); padding: 20px;">Nu există serii de facturare</p>';
  }

  const headers = [
    { label: 'Seria', key: 'series' },
    { label: 'An', key: 'year' },
    { label: 'Număr următor', key: 'next_number' },
    { label: 'Stare', key: 'status' },
    { label: 'Acțiuni', key: 'actions' }
  ];

  const rows = seriesList.map(s => ({
    series: s.series,
    year: s.year,
    next_number: s.next_number,
    status: s.active ? '<span class="badge badge-success">Activă</span>' : '<span class="badge badge-muted">Inactivă</span>',
    actions: `
      <div class="flex gap-1">
        <button class="btn btn-sm btn-outline" data-action="edit" data-id="${s.id}" title="Editează serie">Editează</button>
        <button class="btn btn-sm btn-danger" data-action="delete" data-id="${s.id}" title="Dezactivează serie">Dezactivează</button>
      </div>
    `
  }));

  return renderTable(headers, rows, { emptyMessage: 'Nu există serii de facturare', rawColumns: ['status', 'actions'] });
}

// ------------------ SERII PROFORME ------------------
function renderProformaSeriesTab(content) {
  content.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div><span class="card-eyebrow">Numerotare documente</span><h3>Serii de proforme</h3></div>
        <button class="btn btn-primary btn-sm" id="add-proforma-series" title="Adaugă serie de proforme">＋ Serie nouă</button>
      </div>
      <div id="proforma-series-list">
        ${renderProformaSeriesTable(proformaSeriesList)}
      </div>
    </div>
  `;

  document.getElementById('add-proforma-series').addEventListener('click', () => {
    openProformaSeriesModal();
  });

  content.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      if (action === 'edit') {
        const series = proformaSeriesList.find(s => s.id === id);
        if (series) openProformaSeriesModal(series);
      } else if (action === 'delete') {
        const ok = await confirmDialog('Sigur dorești să dezactivezi această serie de proforme?');
        if (ok) {
          try {
            await proformaSeriesApi.update(id, { active: false });
            proformaSeriesList = await proformaSeriesApi.list();
            renderProformaSeriesTab(content);
            showToast('Serie dezactivată', 'success');
          } catch (error) {
            showToast(error.message, 'error');
          }
        }
      }
    });
  });
}

function openProformaSeriesModal(series = null) {
  const isEdit = !!series;
  const title = isEdit ? 'Editează serie proforme' : 'Adaugă serie proforme';
  const currentYear = new Date().getFullYear();
  const formHtml = `
    <form id="proforma-series-form">
      <div class="form-group">
        <label>Seria *</label>
        <input type="text" name="series" value="${series ? escapeHtml(series.series) : ''}" required placeholder="Ex: PROF">
      </div>
      <div class="form-group">
        <label>An *</label>
        <input type="number" name="year" value="${series ? series.year : currentYear}" required min="2020" max="2100">
      </div>
      <div class="form-group">
        <label>Număr următor *</label>
        <input type="number" name="next_number" value="${series ? series.next_number : 1}" required min="1">
      </div>
      <div class="form-group">
        <label>
          <input type="checkbox" name="active" ${series ? (series.active ? 'checked' : '') : 'checked'}>
          Activă
        </label>
      </div>
      <div class="flex gap-1 mt-2">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Actualizează' : 'Adaugă'}</button>
        <button type="button" class="btn btn-outline" id="proforma-series-cancel">Anulează</button>
      </div>
    </form>
  `;

  const { modalElement, close } = createModal({ title, content: formHtml, closeOnOverlayClick: false });

  modalElement.querySelector('#proforma-series-cancel').addEventListener('click', close);

  modalElement.querySelector('#proforma-series-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = modalElement.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Se salvează...';
    }

    const form = e.target;
    const formData = new FormData(form);
    const data = {
      series: formData.get('series'),
      year: parseInt(formData.get('year')),
      next_number: parseInt(formData.get('next_number')),
      active: formData.get('active') === 'on'
    };

    try {
      if (isEdit) {
        await proformaSeriesApi.update(series.id, data);
        showToast('Serie actualizată', 'success');
      } else {
        await proformaSeriesApi.create(data);
        showToast('Serie adăugată', 'success');
      }
      proformaSeriesList = await proformaSeriesApi.list();
      close();
      renderProformaSeriesTab(document.querySelector('#settings-content'));
    } catch (error) {
      showToast(error.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isEdit ? 'Actualizează' : 'Adaugă';
      }
    }
  });
}

function renderProformaSeriesTable(seriesList) {
  if (!seriesList || seriesList.length === 0) {
    return '<p class="text-center" style="color: var(--color-text-secondary); padding: 20px;">Nu există serii de proforme</p>';
  }

  const headers = [
    { label: 'Seria', key: 'series' },
    { label: 'An', key: 'year' },
    { label: 'Număr următor', key: 'next_number' },
    { label: 'Stare', key: 'status' },
    { label: 'Acțiuni', key: 'actions' }
  ];

  const rows = seriesList.map(s => ({
    series: s.series,
    year: s.year,
    next_number: s.next_number,
    status: s.active ? '<span class="badge badge-success">Activă</span>' : '<span class="badge badge-muted">Inactivă</span>',
    actions: `
      <div class="flex gap-1">
        <button class="btn btn-sm btn-outline" data-action="edit" data-id="${s.id}" title="Editează serie">Editează</button>
        <button class="btn btn-sm btn-danger" data-action="delete" data-id="${s.id}" title="Dezactivează serie">Dezactivează</button>
      </div>
    `
  }));

  return renderTable(headers, rows, { emptyMessage: 'Nu există serii de proforme', rawColumns: ['status', 'actions'] });
}
