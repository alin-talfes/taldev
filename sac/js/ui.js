// js/ui.js
// Componente UI reutilizabile – cu skeleton loading și empty states
// Suport pentru beforeClose async în createModal.
// Fix: createModal acceptă skipCloseAll pentru a nu închide modalul principal
// atunci când confirmDialog este afișat peste el.

import { escapeHtml } from './utils.js';

let dirtyState = false;

export function markDirty() { dirtyState = true; }
export function clearDirty() { dirtyState = false; }
export function isDirty() { return dirtyState; }

export function createModal({
  title,
  content,
  onClose,
  beforeClose,
  size = 'md',
  closeOnOverlayClick = false,
  skipCloseAll = false
}) {
  const previouslyFocused = document.activeElement;
  if (!skipCloseAll) {
    closeAllModals();
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';
  const titleId = 'modal-title-' + Math.random().toString(36).slice(2, 10);
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.setAttribute('tabindex', '-1');
  if (size === 'lg') modal.style.maxWidth = '900px';
  if (size === 'sm') modal.style.maxWidth = '400px';

  modal.innerHTML = `
    <div class="modal-header">
      <h3 id="${titleId}">${escapeHtml(title)}</h3>
      <button class="modal-close" aria-label="Închide">&times;</button>
    </div>
    <div class="modal-body">
      ${content}
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');

  requestAnimationFrame(() => {
    const firstFocusable = modal.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]');
    (firstFocusable || modal).focus();
  });

  let closed = false;
  const finalizeClose = () => {
    if (closed) return false;
    closed = true;
    document.removeEventListener('keydown', handleKeydown);
    overlay.remove();
    if (!document.querySelector('.modal-overlay')) document.body.classList.remove('modal-open');
    if (previouslyFocused && previouslyFocused.isConnected && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus();
    }
    if (onClose) onClose();
    return true;
  };

  const close = async () => {
    if (closed) return false;
    if (beforeClose) {
      try {
        const canClose = await beforeClose();
        if (canClose === false) return false;
      } catch (error) {
        console.warn('Eroare în beforeClose:', error);
        return false;
      }
    }
    return finalizeClose();
  };

  const closeBtn = modal.querySelector('.modal-close');
  if (closeBtn) closeBtn.addEventListener('click', close);

  if (closeOnOverlayClick) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  const handleKeydown = async (e) => {
    const overlays = Array.from(document.querySelectorAll('.modal-overlay'));
    if (overlays[overlays.length - 1] !== overlay) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      await close();
      return;
    }
    if (e.key === 'Tab') {
      const focusable = Array.from(modal.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (focusable.length === 0) {
        e.preventDefault();
        modal.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', handleKeydown);
  overlay._forceClose = finalizeClose;

  return { modalElement: modal, overlay, close };
}

export function closeAllModals() {
  const overlays = document.querySelectorAll('.modal-overlay');
  overlays.forEach(overlay => {
    if (typeof overlay._forceClose === 'function') overlay._forceClose();
    else overlay.remove();
  });
  if (!document.querySelector('.modal-overlay')) document.body.classList.remove('modal-open');
}

export function confirmDialog(message, options = {}) {
  const {
    title = 'Confirmare',
    confirmText = 'Confirmă',
    cancelText = 'Anulează',
    danger = false
  } = options;

  return new Promise((resolve) => {
    let settled = false;
    const content = `
      <p>${escapeHtml(message)}</p>
      <div class="flex gap-2 mt-2">
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-yes">${escapeHtml(confirmText)}</button>
        <button class="btn btn-outline" id="confirm-no">${escapeHtml(cancelText)}</button>
      </div>
    `;

    // Folosim skipCloseAll pentru a nu închide modalul principal
    const { modalElement, close } = createModal({
      title,
      content,
      skipCloseAll: true,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }
    });

    modalElement.querySelector('#confirm-yes').addEventListener('click', () => {
      settled = true;
      resolve(true);
      close();
    });
    modalElement.querySelector('#confirm-no').addEventListener('click', () => {
      settled = true;
      resolve(false);
      close();
    });
  });
}

export function renderSkeleton(rows = 5) {
  let html = '<div class="skeleton-wrapper" role="status" aria-live="polite"><span class="sr-only">Se încarcă datele…</span>';
  for (let i = 0; i < rows; i++) {
    html += `
      <div class="skeleton-row">
        <div class="skeleton-line w-20"></div>
        <div class="skeleton-line w-40"></div>
        <div class="skeleton-line w-15"></div>
        <div class="skeleton-line w-25"></div>
      </div>
    `;
  }
  html += '</div>';
  return html;
}

export function renderEmptyState(message, actionLabel = null, onAction = null) {
  if (!actionLabel || !onAction) {
    return `<div class="empty-state"><span class="empty-state-icon" aria-hidden="true">◇</span><p>${escapeHtml(message)}</p></div>`;
  }

  const id = 'empty-action-' + Math.random().toString(36).substr(2, 8);
  setTimeout(() => {
    const btn = document.getElementById(id);
    if (btn && typeof onAction === 'function') {
      btn.addEventListener('click', onAction);
    }
  }, 0);

  return `
    <div class="empty-state">
      <span class="empty-state-icon" aria-hidden="true">＋</span>
      <p>${escapeHtml(message)}</p>
      <button id="${id}" class="btn btn-primary btn-sm mt-2">${escapeHtml(actionLabel)}</button>
    </div>
  `;
}

export function renderTable(headers, rows, options = {}) {
  const { emptyMessage = 'Nu există date', tableClass = '', rawColumns = [] } = options;

  if (!rows || rows.length === 0) {
    return `<div class="text-center mt-2" style="padding: 20px; color: var(--color-text-secondary);">${escapeHtml(emptyMessage)}</div>`;
  }

  let html = `<div class="table-container"><table class="${tableClass}">`;

  html += '<thead><tr>';
  for (const header of headers) {
    const label = typeof header === 'string' ? header : header.label;
    const align = typeof header === 'object' && header.align ? ` style="text-align: ${header.align}"` : '';
    html += `<th${align}>${escapeHtml(label)}</th>`;
  }
  html += '</tr></thead>';

  html += '<tbody>';
  for (const row of rows) {
    html += '<tr>';
    for (const header of headers) {
      const key = typeof header === 'string' ? header : header.key;
      const value = row[key] !== undefined ? row[key] : '';
      const align = typeof header === 'object' && header.align ? ` style="text-align: ${header.align}"` : '';
      if (rawColumns.includes(key)) {
        html += `<td${align}>${value}</td>`;
      } else {
        html += `<td${align}>${escapeHtml(String(value))}</td>`;
      }
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';

  return html;
}

export function renderBadge(status, type = 'muted') {
  const cssClass = `badge badge-${type}`;
  return `<span class="${cssClass}">${escapeHtml(status)}</span>`;
}

const STATUS_LABELS_RO = {
  DRAFT: 'Ciornă',
  ISSUED: 'Emisă',
  CORRECTED: 'Corectată',
  STORNED: 'Stornată',
  VOIDED: 'Anulată',
  ARCHIVED: 'Arhivată',
  UNPAID: 'Neachitată',
  PARTIALLY_PAID: 'Achitată parțial',
  PAID: 'Achitată',
  OVERDUE: 'Restantă',
  NOT_GENERATED: 'Negenerat',
  GENERATED: 'Generat',
  VALID: 'Valid',
  INVALID: 'Nevalid',
  NEEDS_VERIFICATION: 'Necesită verificare',
  NOT_SUBMITTED: 'Nedepus',
  SUBMITTED: 'Depus',
  ACCEPTED: 'Acceptat',
  REJECTED: 'Respins',
  PENDING: 'În așteptare',
  CONFIRMED: 'Confirmată',
  CANCELLED: 'Anulată',
  REVERSED: 'Inversată',
  DEDUCTIBLE: 'Deductibilă',
  PARTIALLY_DEDUCTIBLE: 'Parțial deductibilă',
  NON_DEDUCTIBLE: 'Nedeductibilă',
  RECEIVED: 'Primită',
  CONVERTED: 'Convertită',
  ACTIVE: 'Activ',
  CONSUMED: 'Consumat',
  DAMAGED: 'Deteriorat',
  SOLD: 'Vândut',
  WRITTEN_OFF: 'Scăzut din gestiune',
  FULLY_DEPRECIATED: 'Amortizat integral',
  DISPOSED: 'Scos din evidență',
  INACTIVE: 'Inactiv',
  RETIRED: 'Retras',
  RESERVED: 'Rezervat',
  cancelled: 'Anulat',
  draft: 'Ciornă',
  acquired: 'Achiziționat',
  in_service: 'În funcțiune',
  depreciating: 'În amortizare',
  fully_depreciated: 'Amortizat integral',
  sold: 'Vândut',
  scrapped: 'Casat',
  disposed: 'Scos din evidență',
  OWN_CONTRIBUTION: 'Aport propriu',
  OWN_CONTRIBUTION_RETURN: 'Restituire aport',
  RECEIPT: 'Încasare',
  PAYMENT: 'Plată',
  REFUND_IN: 'Rambursare încasată',
  REFUND_OUT: 'Rambursare plătită',
  OTHER_IN: 'Altă încasare',
  OTHER_OUT: 'Altă plată',
  ADJUSTMENT: 'Ajustare',
  INCOME: 'Venit',
  DEDUCTIBLE_EXPENSE: 'Cheltuială deductibilă',
  NON_DEDUCTIBLE_EXPENSE: 'Cheltuială nedeductibilă',
  CASH_MOVEMENT: 'Mișcare de numerar',
  BANK: 'Transfer bancar',
  CASH: 'Numerar',
  CARD: 'Card',
  OTHER: 'Altă metodă',
  IN: 'Încasare',
  OUT: 'Plată',
  NORMAL: 'Normală',
  STORNO: 'Storno',
  CORRECTION: 'Corecție',
  LINEAR: 'Liniară',
  DEGRESSIVE: 'Degresivă',
  NONE: 'Fără amortizare'
};

const STATUS_ICONS = {
  OVERDUE: '⚠️',
  NEEDS_VERIFICATION: '⚠️',
  INVALID: '⚠️',
  REJECTED: '⚠️',
  DAMAGED: '⚠️'
};

export function getStatusLabel(status) {
  if (status === null || status === undefined || status === '') return '-';
  return STATUS_LABELS_RO[status] || String(status).replaceAll('_', ' ').toLocaleLowerCase('ro-RO');
}

export function getStatusBadgeType(status) {
  const map = {
    'DRAFT': 'muted',
    'ISSUED': 'info',
    'CORRECTED': 'warning',
    'STORNED': 'danger',
    'VOIDED': 'muted',
    'ARCHIVED': 'muted',
    'UNPAID': 'danger',
    'PARTIALLY_PAID': 'warning',
    'PAID': 'success',
    'OVERDUE': 'danger',
    'NOT_GENERATED': 'muted',
    'GENERATED': 'info',
    'VALID': 'success',
    'INVALID': 'danger',
    'NEEDS_VERIFICATION': 'warning',
    'NOT_SUBMITTED': 'muted',
    'SUBMITTED': 'info',
    'ACCEPTED': 'success',
    'REJECTED': 'danger',
    'PENDING': 'warning',
    'CONFIRMED': 'success',
    'CANCELLED': 'muted',
    'REVERSED': 'warning',
    'DEDUCTIBLE': 'success',
    'PARTIALLY_DEDUCTIBLE': 'warning',
    'NON_DEDUCTIBLE': 'danger',
    'RECEIVED': 'info',
    'CONVERTED': 'info',
    'ACTIVE': 'success',
    'CONSUMED': 'muted',
    'DAMAGED': 'danger',
    'SOLD': 'info',
    'WRITTEN_OFF': 'warning',
    'FULLY_DEPRECIATED': 'warning',
    'DISPOSED': 'muted',
    'INACTIVE': 'muted',
    'in_service': 'success',
    'depreciating': 'info',
    'scrapped': 'warning',
    'OWN_CONTRIBUTION': 'info',
    'OWN_CONTRIBUTION_RETURN': 'warning'
  };
  return map[status] || 'muted';
}

export function renderStatusBadge(status) {
  const type = getStatusBadgeType(status);
  const icon = STATUS_ICONS[status] ? `${STATUS_ICONS[status]} ` : '';
  return renderBadge(`${icon}${getStatusLabel(status)}`, type);
}

export function renderPagination({ currentPage, totalPages, onPageChange }) {
  if (totalPages <= 1) return '';

  let html = '<div class="pagination flex gap-1 mt-2">';
  html += `<button class="btn btn-sm btn-outline" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>&laquo; Înapoi</button>`;

  const maxVisible = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);

  if (endPage - startPage < maxVisible - 1) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="btn btn-sm ${i === currentPage ? 'btn-primary' : 'btn-outline'}" data-page="${i}">${i}</button>`;
  }

  html += `<button class="btn btn-sm btn-outline" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>Înainte &raquo;</button>`;
  html += '</div>';

  setTimeout(() => {
    const container = document.querySelector('.pagination');
    if (container) {
      container.querySelectorAll('button[data-page]').forEach(btn => {
        btn.addEventListener('click', () => {
          const page = parseInt(btn.getAttribute('data-page'));
          if (!isNaN(page) && page >= 1 && page <= totalPages) onPageChange(page);
        });
      });
    }
  }, 0);

  return html;
}

export function renderForm(fields) {
  let html = '<form id="dynamic-form">';
  for (const field of fields) {
    const { name, label, type = 'text', value = '', required = false, options = [], placeholder = '', step } = field;
    const requiredAttr = required ? 'required' : '';
    const valueAttr = value !== undefined && value !== null ? ` value="${escapeHtml(String(value))}"` : '';
    const placeholderAttr = placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : '';
    const stepAttr = step ? ` step="${step}"` : '';

    html += '<div class="form-group">';
    html += `<label for="field-${escapeHtml(name)}">${escapeHtml(label)}${required ? ' *' : ''}</label>`;

    if (type === 'select') {
      html += `<select id="field-${escapeHtml(name)}" name="${escapeHtml(name)}" ${requiredAttr}>`;
      html += '<option value="">Selectează...</option>';
      for (const opt of options) {
        const optValue = typeof opt === 'object' ? opt.value : opt;
        const optLabel = typeof opt === 'object' ? (opt.label || opt.value) : opt;
        const selected = String(optValue) === String(value) ? 'selected' : '';
        html += `<option value="${escapeHtml(String(optValue))}" ${selected}>${escapeHtml(optLabel)}</option>`;
      }
      html += '</select>';
    } else if (type === 'textarea') {
      html += `<textarea id="field-${escapeHtml(name)}" name="${escapeHtml(name)}" ${requiredAttr} ${placeholderAttr}>${escapeHtml(String(value))}</textarea>`;
    } else if (type === 'number') {
      html += `<input type="number" id="field-${escapeHtml(name)}" name="${escapeHtml(name)}" ${requiredAttr} ${valueAttr} ${placeholderAttr} ${stepAttr}>`;
    } else if (type === 'date') {
      html += `<input type="date" id="field-${escapeHtml(name)}" name="${escapeHtml(name)}" ${requiredAttr} ${valueAttr}>`;
    } else if (type === 'checkbox') {
      const checked = value ? 'checked' : '';
      html += `<input type="checkbox" id="field-${escapeHtml(name)}" name="${escapeHtml(name)}" ${checked}>`;
    } else {
      html += `<input type="${type}" id="field-${escapeHtml(name)}" name="${escapeHtml(name)}" ${requiredAttr} ${valueAttr} ${placeholderAttr}>`;
    }

    html += '</div>';
  }
  html += '</form>';
  return html;
}

export function getFormValues(formElement) {
  const values = {};
  const formData = new FormData(formElement);
  for (const [key, value] of formData.entries()) values[key] = value;
  return values;
}

export function renderLoader(message = 'Se încarcă...') {
  return `<div class="text-center" style="padding: 40px; color: var(--color-text-secondary);">${escapeHtml(message)}</div>`;
}

export function renderError(message) {
  return `<div class="alert alert-error">${escapeHtml(message)}</div>`;
}
