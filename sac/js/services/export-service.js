// js/services/export-service.js
// Serviciu de export CSV și printare pentru rapoarte
// FIX: Aplică escapeHtml pentru toate valorile înainte de a le introduce în HTML.

import { escapeHtml } from '../utils.js';

export function protectSpreadsheetCell(value) {
  const text = String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function escapeCsvCell(value) {
  return `"${protectSpreadsheetCell(value ?? '').replace(/"/g, '""')}"`;
}

/**
 * Exportă datele ca fișier CSV
 * @param {string} filename - numele fișierului fără extensie
 * @param {Array} headers - array de obiecte { label, key }
 * @param {Array} rows - array de obiecte cu valorile
 */
export function exportToCsv(filename, headers, rows) {
  if (!rows || rows.length === 0) {
    console.warn('Nu există date pentru export');
    return;
  }

  const headerLabels = headers.map(h => h.label);
  const csvRows = [headerLabels];

  for (const row of rows) {
    const values = headers.map(h => {
      let val = row[h.key] !== undefined ? row[h.key] : '';
      // Pentru CSV, nu folosim innerHTML; doar convertim eventualele HTML la text
      if (typeof val === 'string' && val.includes('<')) {
        const div = document.createElement('div');
        div.innerHTML = val;
        val = div.textContent || '';
      }
      return escapeCsvCell(val);
    });
    csvRows.push(values);
  }

  const csvString = csvRows.map(row => row.join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Printează un tabel HTML într-o fereastră nouă
 * @param {string} title - titlul raportului
 * @param {Array} headers - array de obiecte { label, key }
 * @param {Array} rows - array de obiecte cu valorile
 */
export function printTable(title, headers, rows) {
  const printWindow = window.open('', '_blank', 'width=900,height=600');
  if (!printWindow) {
    console.error('Pop-up blocat');
    return;
  }

  const headersHtml = headers.map(h => `<th>${escapeHtml(h.label)}</th>`).join('');
  const rowsHtml = rows.map(row => {
    const cells = headers.map(h => {
      let val = row[h.key] !== undefined ? row[h.key] : '';
      // Escape pentru HTML
      if (typeof val === 'string' && val.includes('<')) {
        // Dacă e deja HTML, îl convertim la text
        const div = document.createElement('div');
        div.textContent = val;
        val = div.textContent || '';
      } else {
        val = String(val);
      }
      return `<td>${escapeHtml(val)}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${escapeHtml(title)}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { text-align: center; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
        th { background-color: #f5f5f5; }
      </style>
    </head>
    <body>
      <h1>${escapeHtml(title)}</h1>
      <table>
        <thead><tr>${headersHtml}</tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <script>
        window.onload = function() { window.print(); };
      <\/script>
    </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
}
