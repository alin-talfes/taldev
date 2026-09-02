import { getSupabase } from '../supabase.js';
import { escapeHtml, round2, showToast } from '../utils.js';

const bnrRateCache = new Map();

export function normalizeBnrRate(data, currency, operationDate) {
  const rate = Number(data?.rate);
  const rateDate = String(data?.rate_date || '');
  const returnedCurrency = String(data?.currency || '').toUpperCase();
  if (!Number.isFinite(rate) || rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(rateDate)) {
    throw new Error('Răspuns invalid primit de la serviciul de curs BNR.');
  }
  if (returnedCurrency && returnedCurrency !== currency) {
    throw new Error('Serviciul BNR a returnat o altă monedă decât cea solicitată.');
  }
  if (rateDate >= operationDate) {
    throw new Error('Data cursului BNR trebuie să fie anterioară datei operațiunii.');
  }
  return { rate, rateDate, source: String(data?.source || 'BNR') };
}

export async function getBnrRate(currency, operationDate) {
  const code = String(currency || '').toUpperCase();
  if (!['EUR', 'USD'].includes(code)) throw new Error('Cursul automat este disponibil pentru EUR și USD.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(operationDate || ''))) throw new Error('Selectează data operațiunii.');
  const cacheKey = `${code}:${operationDate}`;
  if (bnrRateCache.has(cacheKey)) return bnrRateCache.get(cacheKey);

  const supabase = await getSupabase();
  const { data, error } = await supabase.functions.invoke('bnr-rate', {
    body: { currency: code, operation_date: operationDate }
  });
  if (error) {
    console.error('Eroare Edge Function bnr-rate:', error);
    throw new Error('Cursul BNR nu a putut fi preluat automat.');
  }
  if (data?.error) throw new Error(data.error);
  const result = normalizeBnrRate(data, code, operationDate);
  bnrRateCache.set(cacheKey, result);
  return result;
}

export function bindBnrRateAutofill(form, options = {}) {
  if (!form) return;
  const currencyInput = options.currency || form.elements[options.currencyName || 'currency'];
  const dateInput = form.elements[options.dateName || 'date'];
  const rateInput = form.elements[options.rateName || 'exchange_rate'];
  const rateDateInput = form.elements[options.rateDateName || 'exchange_rate_date'];
  const sourceInput = form.elements[options.sourceName || 'exchange_rate_source'];
  const status = form.querySelector(options.statusSelector || '[data-bnr-rate-status]');
  if (!dateInput || !rateInput || !rateDateInput || !sourceInput) return;

  let requestId = 0;
  const setStatus = (message, state = '') => {
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  };
  const refresh = async () => {
    const currency = String(typeof currencyInput === 'string' ? currencyInput : currencyInput?.value || '').toUpperCase();
    const operationDate = dateInput.value;
    const currentRequest = ++requestId;
    if (currency === 'RON') {
      rateInput.value = '';
      rateDateInput.value = '';
      sourceInput.value = '';
      setStatus('Pentru RON nu este necesar curs valutar.');
      return;
    }
    if (!['EUR', 'USD'].includes(currency) || !operationDate) {
      setStatus('Selectează EUR/USD și data operațiunii pentru completarea automată.');
      return;
    }

    rateInput.readOnly = true;
    rateDateInput.readOnly = true;
    sourceInput.readOnly = true;
    setStatus(`Se preia cursul BNR pentru ${currency}…`, 'loading');
    try {
      const result = await getBnrRate(currency, operationDate);
      if (currentRequest !== requestId) return;
      rateInput.value = String(result.rate);
      rateDateInput.value = result.rateDate;
      sourceInput.value = result.source;
      rateInput.dispatchEvent(new Event('input', { bubbles: true }));
      setStatus(`Curs BNR ${result.rate.toFixed(4)} RON din ${result.rateDate}.`, 'success');
    } catch (error) {
      if (currentRequest !== requestId) return;
      rateInput.readOnly = false;
      rateDateInput.readOnly = false;
      sourceInput.readOnly = false;
      setStatus(`${error.message} Câmpurile pot fi completate manual.`, 'error');
      showToast(error.message, 'error');
    }
  };

  if (typeof currencyInput !== 'string') currencyInput?.addEventListener('change', refresh);
  dateInput.addEventListener('change', refresh);
  void refresh();
}

export function fxFieldsHtml(currency) {
  const code = String(currency || 'RON').toUpperCase();
  if (code === 'RON') return '';
  return `
    <div class="alert alert-info">Documentul rămâne în ${escapeHtml(code)}; echivalentul fiscal în RON este calculat și validat în baza de date.</div>
    <div class="form-row"><div class="form-group"><label>Curs contabil BNR *</label><input type="number" name="exchange_rate" min="0.000001" step="0.000001" required></div><div class="form-group"><label>Data cursului *</label><input type="date" name="exchange_rate_date" required></div></div>
    <div class="alert alert-info" data-bnr-rate-status>Se pregătește preluarea automată a cursului BNR…</div>
    <div class="form-row"><div class="form-group"><label>Sursă curs *</label><input name="exchange_rate_source" value="BNR" required></div><div class="form-group"><label>Sumă bancară în RON</label><input type="number" name="bank_amount_ron" min="0.01" step="0.01" placeholder="Gol pentru cont în valută"></div></div>
    <div class="form-row"><div class="form-group"><label>Sumă în moneda contului</label><input type="number" name="bank_settlement_amount" min="0.01" step="0.01"></div><div class="form-group"><label>Moneda contului</label><select name="bank_settlement_currency"><option value="RON">RON</option><option value="${escapeHtml(code)}">${escapeHtml(code)}</option><option value="EUR">EUR</option><option value="USD">USD</option></select></div></div>
    <div class="form-row"><div class="form-group"><label>Comision bancar separat (RON)</label><input type="number" name="bank_fee_ron" min="0" step="0.01" value="0"></div><div class="form-group"><label>Tratament diferență conversie</label><select name="fx_fiscal_treatment"><option value="">Necesită verificare</option><option value="DEDUCTIBLE_EXPENSE">Cheltuială deductibilă</option><option value="NON_DEDUCTIBLE_EXPENSE">Cheltuială nedeductibilă</option><option value="INCOME">Venit</option><option value="CASH_MOVEMENT">Doar mișcare de numerar</option></select></div></div>
    <div class="alert alert-info" data-fx-preview>Echivalent contabil: — RON · diferență conversie: — RON</div>`;
}

export function bindFxPreview(form) {
  const output = form?.querySelector('[data-fx-preview]');
  if (!output) return;
  const refresh = () => {
    const fiscal = round2((Number(form.elements.amount?.value) || 0) * (Number(form.elements.exchange_rate?.value) || 0));
    const bank = Number(form.elements.bank_amount_ron?.value) || 0;
    output.textContent = `Echivalent contabil: ${fiscal.toFixed(2)} RON · diferență conversie: ${bank ? round2(bank - fiscal).toFixed(2) : '—'} RON`;
  };
  form.addEventListener('input', refresh); refresh();
}

export function readFxParams(formData, currency) {
  if (String(currency || 'RON').toUpperCase() === 'RON') return {};
  const num = (name) => formData.get(name) === '' || formData.get(name) === null ? null : Number(formData.get(name));
  return { exchangeRate: num('exchange_rate'), exchangeRateDate: formData.get('exchange_rate_date') || null,
    exchangeRateSource: formData.get('exchange_rate_source')?.trim() || 'BNR', bankAmountRon: num('bank_amount_ron'),
    bankSettlementAmount: num('bank_settlement_amount'), bankSettlementCurrency: formData.get('bank_settlement_currency') || null,
    bankFeeRon: num('bank_fee_ron') || 0, fxFiscalTreatment: formData.get('fx_fiscal_treatment') || null };
}
