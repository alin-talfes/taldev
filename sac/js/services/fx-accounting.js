import { escapeHtml, round2 } from '../utils.js';

export function fxFieldsHtml(currency) {
  const code = String(currency || 'RON').toUpperCase();
  if (code === 'RON') return '';
  return `
    <div class="alert alert-info">Documentul rămâne în ${escapeHtml(code)}; echivalentul fiscal în RON este calculat și validat în baza de date.</div>
    <div class="form-row"><div class="form-group"><label>Curs contabil BNR *</label><input type="number" name="exchange_rate" min="0.000001" step="0.000001" required></div><div class="form-group"><label>Data cursului *</label><input type="date" name="exchange_rate_date" required></div></div>
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
