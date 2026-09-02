// js/modules/documents.js
// Modul Documente – gestionarea documentelor justificative
// UX îmbunătățit: skeleton loading, empty state, tooltips, descărcare fiabilă
// FIX: marcare coloane raw pentru renderTable (actions)

import { documentsApi } from '../api.js';
import { getSupabase } from '../supabase.js';
import { formatDateTime, showToast, escapeHtml } from '../utils.js';
import { createModal, renderTable, confirmDialog, renderSkeleton, renderEmptyState } from '../ui.js';

let currentDocuments = [];

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-heading"><h2>Documente</h2><p>Păstrează documentele justificative și fișierele asociate activității într-un singur loc.</p></div>
      <button class="btn btn-primary" id="upload-document-btn" title="Încarcă un document justificativ">↑ Încarcă document</button>
    </div>
    <div class="card">
      <div class="card-header">
        <div><span class="card-eyebrow">Arhivă digitală</span><h3>Documente atașate</h3></div>
        <button class="btn btn-outline btn-sm" id="refresh-documents" title="Reîncarcă lista">↻ Actualizează</button>
      </div>
      <div id="documents-list"></div>
    </div>
  `;

  document.getElementById('upload-document-btn').addEventListener('click', () => openUploadModal());
  document.getElementById('refresh-documents').addEventListener('click', loadDocuments);

  await loadDocuments();
}

export function destroy() {}

async function loadDocuments() {
  const listContainer = document.getElementById('documents-list');
  if (!listContainer) return;
  listContainer.innerHTML = renderSkeleton(5);

  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;

    currentDocuments = data || [];
    renderDocumentsList(listContainer);
  } catch (error) {
    console.error('Eroare la încărcarea documentelor:', error);
    listContainer.innerHTML = `<div class="alert alert-error">${escapeHtml(error.message || 'Nu am putut încărca documentele')}</div>`;
  }
}

function renderDocumentsList(container) {
  if (!currentDocuments || currentDocuments.length === 0) {
    container.innerHTML = renderEmptyState(
      'Nu ai documente justificative atașate.',
      'Încarcă primul document',
      () => openUploadModal()
    );
    return;
  }

  const headers = [
    { label: 'Nume fișier', key: 'filename' },
    { label: 'Tip', key: 'mime_type' },
    { label: 'Dimensiune', key: 'size' },
    { label: 'Data încărcării', key: 'created_at' },
    { label: 'Acțiuni', key: 'actions' }
  ];

  const rows = currentDocuments.map(doc => ({
    filename: doc.original_filename,
    mime_type: doc.mime_type || '-',
    size: (doc.file_size / 1024).toFixed(2) + ' KB',
    created_at: formatDateTime(doc.created_at),
    actions: `
      <div class="flex gap-1">
        <button class="btn btn-sm btn-outline" data-action="download" data-id="${doc.id}" data-path="${escapeHtml(doc.storage_path)}" title="Descarcă document">Descarcă</button>
        <button class="btn btn-sm btn-danger" data-action="archive" data-id="${doc.id}" title="Arhivează documentul neasociat">Arhivează</button>
      </div>
    `
  }));

  const totalSize = currentDocuments.reduce((sum, doc) => sum + parseFloat(doc.file_size || 0), 0);
  const formattedSize = totalSize >= 1024 * 1024 ? `${(totalSize / 1024 / 1024).toFixed(2)} MB` : `${(totalSize / 1024).toFixed(2)} KB`;
  container.innerHTML = `<div class="list-summary"><span><strong>${currentDocuments.length}</strong> ${currentDocuments.length === 1 ? 'document' : 'documente'}</span><span>Spațiu utilizat: <strong>${formattedSize}</strong></span></div>` + renderTable(headers, rows, { emptyMessage: 'Nu există documente', rawColumns: ['actions'] });

  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      const path = btn.getAttribute('data-path');

      if (action === 'download') {
        await downloadDocument(btn, path);
      } else if (action === 'archive') {
        const ok = await confirmDialog('Arhivezi acest document? Documentele asociate evidenței contabile nu pot fi arhivate.', { danger: true });
        if (ok) {
          try {
            await documentsApi.archive(id, 'Arhivat manual din interfață');
            showToast('Document arhivat', 'success');
            await loadDocuments();
          } catch (error) {
            showToast(error.message, 'error');
          }
        }
      }
    });
  });
}

async function downloadDocument(btn, storagePath) {
  const originalText = btn.textContent;
  try {
    btn.disabled = true;
    btn.textContent = 'Se descarcă...';

    const url = await documentsApi.getSignedUrl(storagePath);

    // Folosim un link temporar pentru a evita blocarea pop-up-urilor
    const link = document.createElement('a');
    link.href = url;
    link.download = '';
    link.target = '_blank';
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();

    showToast('Descărcare pornită', 'success');
  } catch (error) {
    console.error('Eroare descărcare:', error);
    showToast('Nu am putut descărca documentul: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function openUploadModal() {
  const content = `
    <form id="upload-form">
      <div class="form-section-heading"><span class="card-eyebrow">Fișier</span><h4>Alege documentul</h4><p>Dimensiunea maximă acceptată este 10 MB.</p></div>
      <div class="form-group">
        <label>Fișier *</label>
        <input type="file" name="file" required accept=".pdf,.xml,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.csv">
        <small>Max 10 MB. Formate permise: PDF, XML, imagini, documente Office.</small>
      </div>
      <div class="form-section-heading"><span class="card-eyebrow">Organizare</span><h4>Asociere și categorie</h4><p>Aceste informații te ajută să regăsești documentul ulterior.</p></div>
      <div class="form-group">
        <label>Asociază cu entitate (opțional)</label>
        <select name="entity_type" id="entity-type-select">
          <option value="">Fără asociere</option>
          <option value="invoice_id">Factură emisă</option>
          <option value="received_invoice_id">Factură primită</option>
          <option value="expense_id">Cheltuială</option>
          <option value="transaction_id">Tranzacție</option>
          <option value="client_id">Client</option>
          <option value="supplier_id">Furnizor</option>
          <option value="inventory_item_id">Element inventar</option>
          <option value="fixed_asset_id">Mijloc fix</option>
        </select>
      </div>
      <div class="form-group" id="entity-id-group" style="display:none;">
        <label>ID entitate</label>
        <input type="text" name="entity_id" placeholder="Introdu ID-ul entității (UUID)">
        <small>Găsești ID-ul în URL sau în detaliile entității.</small>
      </div>
      <div class="form-group">
        <label>Categorie stocare</label>
        <select name="category">
          <option value="invoices">Facturi emise</option>
          <option value="received-invoices">Facturi primite</option>
          <option value="expenses">Cheltuieli</option>
          <option value="contracts">Contracte</option>
          <option value="assets">Active</option>
          <option value="other">Altele</option>
        </select>
      </div>
      <div class="flex gap-1 mt-2">
        <button type="submit" class="btn btn-primary">Încarcă</button>
        <button type="button" class="btn btn-outline" id="upload-cancel">Anulează</button>
      </div>
    </form>
  `;

  const { modalElement, close } = createModal({ title: 'Încarcă document', content, closeOnOverlayClick: false });

  modalElement.querySelector('#upload-cancel').addEventListener('click', close);
  modalElement.querySelector('#entity-type-select').addEventListener('change', (e) => {
    const idGroup = modalElement.querySelector('#entity-id-group');
    if (e.target.value) {
      idGroup.style.display = '';
    } else {
      idGroup.style.display = 'none';
    }
  });

  modalElement.querySelector('#upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = modalElement.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Se încarcă...';
    }

    const form = e.target;
    const formData = new FormData(form);
    const file = formData.get('file');
    const entityType = formData.get('entity_type');
    const entityId = formData.get('entity_id') || null;
    const category = formData.get('category') || 'other';

    if (file.size > 10 * 1024 * 1024) {
      showToast('Fișierul este prea mare (max 10 MB)', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Încarcă';
      }
      return;
    }

    const allowedExtensions = ['pdf', 'xml', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xls', 'xlsx', 'csv'];
    const fileExt = file.name.split('.').pop().toLowerCase();
    if (!allowedExtensions.includes(fileExt)) {
      showToast('Format de fișier nepermis', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Încarcă';
      }
      return;
    }

    try {
      const metadata = {};
      if (entityType && entityId) {
        metadata.entityType = entityType;
        metadata.entityId = entityId;
      }
      metadata.category = category;

      await documentsApi.upload(file, metadata);
      showToast('Document încărcat cu succes', 'success');
      close();
      await loadDocuments();
    } catch (error) {
      showToast(error.message, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Încarcă';
      }
    }
  });
}
