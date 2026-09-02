// js/utils.js
// Funcții utilitare reutilizabile
// Include validări reale pentru CUI, CNP, IBAN și IBAN românesc.

/**
 * Rotunjește un număr la 2 zecimale (pentru monedă)
 */
export function round2(value) {
  return Number(toScaledInteger(value, 2)) / 100;
}

/**
 * Convertește o valoare zecimală într-un întreg scalat și rotunjește
 * jumătățile în sens opus lui zero, la fel ca PostgreSQL round(numeric, n).
 * Evită diferențele binare de tip 0.1 + 0.2 pentru sumele monetare.
 */
function toScaledInteger(value, scale = 2) {
  const normalized = String(value ?? 0).trim().replace(',', '.');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return 0n;

  const negative = normalized.startsWith('-');
  const unsigned = normalized.replace(/^[+-]/, '');
  const [wholeRaw = '0', fractionRaw = ''] = unsigned.split('.');
  const whole = wholeRaw || '0';
  const kept = fractionRaw.slice(0, scale).padEnd(scale, '0');
  const discarded = fractionRaw.slice(scale);
  const factor = 10n ** BigInt(scale);
  let scaled = BigInt(whole) * factor + BigInt(kept || '0');

  if (discarded && discarded[0] >= '5') scaled += 1n;
  return negative ? -scaled : scaled;
}

function divideRoundHalfAwayFromZero(numerator, denominator) {
  if (denominator <= 0n) throw new Error('Divizor invalid');
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const rounded = quotient + (remainder * 2n >= denominator ? 1n : 0n);
  return negative ? -rounded : rounded;
}

/**
 * Formatează o sumă ca monedă
 */
export function formatCurrency(amount, currency = 'RON') {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '-';
  try {
    return new Intl.NumberFormat('ro-RO', {
      style: 'currency',
      currency: currency || 'RON',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(num);
  } catch {
    return `${num.toFixed(2)} ${currency || 'RON'}`;
  }
}

/**
 * Formatează o dată în format românesc (zz.ll.aaaa)
 */
export function formatDate(date) {
  if (!date) return '-';
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split('-');
    return `${day}.${month}.${year}`;
  }
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '-';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}.${month}.${year}`;
}

/**
 * Formatează data și ora
 */
export function formatDateTime(date) {
  if (!date) return '-';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '-';
  return formatDate(d) + ' ' + d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Convertește o dată din format ISO în input date (yyyy-mm-dd)
 */
export function toInputDate(date) {
  if (!date) return '';
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Validează un email
 */
export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Validează un CUI românesc (cod unic de înregistrare)
 * Algoritm oficial: cifra de control = suma produselor ponderate modulo 11
 */
export function isValidCUI(cui) {
  if (!cui) return false;
  const clean = String(cui).toUpperCase().replace(/^RO/, '').replace(/\s/g, '');
  if (!/^\d{2,10}$/.test(clean)) return false;

  const controlDigit = Number(clean.at(-1));
  const body = clean.slice(0, -1).padStart(9, '0');
  const weights = [7, 5, 3, 2, 1, 7, 5, 3, 2];
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
  const remainder = (sum * 10) % 11;
  const expected = remainder === 10 ? 0 : remainder;
  return expected === controlDigit;
}

/**
 * Validează un CNP românesc
 */
export function isValidCNP(cnp) {
  if (!cnp) return false;
  const clean = String(cnp).replace(/\s/g, '');
  if (!/^\d{13}$/.test(clean)) return false;

  const controlWeights = [2, 7, 9, 1, 4, 6, 3, 5, 8, 2, 7, 9];
  const controlDigit = parseInt(clean.charAt(12), 10);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(clean.charAt(i), 10) * controlWeights[i];
  }
  const remainder = sum % 11;
  const expected = remainder === 10 ? 1 : remainder;
  return expected === controlDigit;
}

/**
 * Validează un identificator fiscal românesc (CUI sau CNP)
 */
export function isValidTaxId(value) {
  if (!value) return false;
  const clean = String(value).replace(/\s/g, '');
  if (/^\d{13}$/.test(clean)) {
    return isValidCNP(clean);
  }
  return isValidCUI(clean);
}

/**
 * Validează un IBAN generic (internațional)
 */
export function isValidIBAN(iban) {
  if (!iban) return true;
  const clean = iban.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length < 15 || clean.length > 34) return false;

  const rearranged = clean.slice(4) + clean.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (char) => (char.charCodeAt(0) - 55).toString());
  let remainder = digits;
  while (remainder.length > 2) {
    const part = remainder.slice(0, 9);
    remainder = (parseInt(part, 10) % 97).toString() + remainder.slice(9);
  }
  return parseInt(remainder, 10) % 97 === 1;
}

/**
 * Validează un IBAN românesc strict.
 * Format: RO + 2 cifre de control + 4 caractere bancă + 16 caractere cont = 24 caractere.
 */
export function isValidRomanianIBAN(iban) {
  if (!iban) return true;
  const clean = iban.toUpperCase().replace(/\s/g, '');
  if (clean.length !== 24) return false;
  if (!clean.startsWith('RO')) return false;
  return isValidIBAN(clean);
}

/**
 * Afișează un mesaj de eroare în consolă
 */
export function logError(message, error) {
  console.error(message, error);
}

/**
 * Generează un UUID v4 (pentru idempotency key)
 */
export function generateIdempotencyKey() {
  return crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
}

/**
 * Debounce pentru a limita apelurile
 */
export function debounce(fn, delay = 300) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Calculează totalurile unei linii de factură
 */
export function calculateLineTotals(line) {
  const quantityHundredths = toScaledInteger(line.quantity, 2);
  const unitPriceCents = toScaledInteger(line.unit_price, 2);
  const discountCents = toScaledInteger(line.discount, 2);
  const vatRateHundredths = toScaledInteger(line.vat_rate, 2);

  const grossCents = divideRoundHalfAwayFromZero(quantityHundredths * unitPriceCents, 100n);
  const netCents = grossCents - discountCents;
  const vatCents = divideRoundHalfAwayFromZero(netCents * vatRateHundredths, 10000n);
  const totalCents = netCents + vatCents;

  return {
    gross_amount: Number(grossCents) / 100,
    net_amount: Number(netCents) / 100,
    vat_amount: Number(vatCents) / 100,
    total_amount: Number(totalCents) / 100
  };
}

/**
 * Calculează totalurile generale din linii
 */
export function calculateInvoiceTotals(lines) {
  let subtotal = 0;
  let discountTotal = 0;
  let taxableBase = 0;
  let vatTotal = 0;
  let total = 0;

  for (const line of lines) {
    const totals = calculateLineTotals(line);
    subtotal = round2(subtotal + totals.gross_amount);
    discountTotal = round2(discountTotal + round2(line.discount));
    taxableBase += totals.net_amount;
    vatTotal += totals.vat_amount;
    total += totals.total_amount;
  }

  return {
    subtotal: round2(subtotal),
    discount_total: round2(discountTotal),
    taxable_base: round2(taxableBase),
    vat_total: round2(vatTotal),
    total: round2(total)
  };
}

/** Grupează sume fără a combina monede incompatibile. */
export function totalsByCurrency(rows, valueSelector = row => row.amount) {
  const totals = new Map();
  for (const row of rows || []) {
    const currency = String(row.currency || 'RON').toUpperCase();
    totals.set(currency, round2((totals.get(currency) || 0) + Number(valueSelector(row) || 0)));
  }
  return totals;
}

export function formatCurrencyTotals(totals, emptyCurrency = 'RON') {
  const entries = totals instanceof Map ? [...totals.entries()] : Object.entries(totals || {});
  if (!entries.length) return formatCurrency(0, emptyCurrency);
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => formatCurrency(amount, currency))
    .join(' + ');
}

/** Echivalentul RON folosit exclusiv pentru KPI de cash-flow, nu pentru valoarea documentului. */
export function transactionCashAmountRon(transaction) {
  const base = transaction.bank_amount_ron ?? transaction.amount_ron ??
    (String(transaction.currency || 'RON').toUpperCase() === 'RON' ? transaction.amount : null);
  if (base === null || base === undefined || !Number.isFinite(Number(base))) return null;
  const outgoingFee = transaction.direction === 'OUT' ? Number(transaction.bank_fee_ron || 0) : 0;
  return round2(Number(base) + outgoingFee);
}

/**
 * Escape HTML pentru a preveni XSS
 */
export function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Afișează un mesaj de tip toast (simplu)
 */
export function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 6px;
    color: #fff;
    background-color: ${type === 'success' ? '#2e7d32' : type === 'error' ? '#c62828' : type === 'warning' ? '#f59e0b' : '#0288d1'};
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    z-index: 9999;
    font-size: 0.9rem;
  `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

/**
 * Formatează un număr de zile ca string
 */
export function formatDays(days) {
  if (days === null || days === undefined) return '-';
  if (days < 0) return `${Math.abs(days)} zile rămase`;
  if (days === 0) return 'azi';
  return `${days} zile restante`;
}
/**
 * Sanitizează textul pentru filtrele PostgREST.
 * Elimină caracterele care pot strica sintaxa filtrelor.
 */
export function sanitizeSearch(value) {
  if (!value) return '';
  return String(value)
    .replace(/[(),"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
