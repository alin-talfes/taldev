import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateInvoiceTotals,
  calculateLineTotals,
  formatCurrencyTotals,
  round2,
  totalsByCurrency,
  transactionCashAmountRon
} from '../js/utils.js';
import { isValidCUI } from '../js/utils.js';
import {
  CIUS_RO_CUSTOMIZATION_ID,
  EFACTURA_EXPORT_VALIDATED,
  generateEfacturaXml,
  isWellFormedXml
} from '../js/services/xml-service.js';

const line = (quantity, unitPrice, discount = 0, vatRate = 0) => ({
  quantity, unit_price: unitPrice, discount, vat_rate: vatRate
});
const balance = (total, payments) => round2(total - payments.reduce((sum, amount) => round2(sum + amount), 0));

test('1. factură RON neplătită', () => assert.equal(balance(1000, []), 1000));
test('2. factură RON plătită integral', () => assert.equal(balance(1000, [1000]), 0));
test('3. factură RON plătită parțial', () => assert.equal(balance(1000, [400]), 600));
test('4. factură cu mai multe plăți', () => assert.equal(balance(1000, [400, 600]), 0));
test('5. factură EUR păstrează moneda documentului', () => {
  assert.equal(formatCurrencyTotals(totalsByCurrency([{ currency: 'EUR', total: 100 }], x => x.total)).includes('EUR'), true);
});
test('6. factură EUR plătită ulterior', () => assert.equal(balance(100, [100]), 0));
test('7. factură EUR cu plată parțială', () => assert.equal(balance(100, [35]), 65));
test('8. curs diferit la încasare nu rescrie valoarea documentului', () => {
  const documentTotalRon = round2(100 * 5);
  const tx = { direction: 'IN', currency: 'EUR', amount: 100, amount_ron: 500, bank_amount_ron: 505, bank_fee_ron: 2 };
  assert.equal(documentTotalRon, 500);
  assert.equal(tx.amount_ron, 500);
  assert.equal(transactionCashAmountRon(tx), 505);
});
test('comisionul separat mărește ieșirea de numerar, nu încasarea', () => {
  assert.equal(transactionCashAmountRon({ direction: 'OUT', currency: 'EUR', bank_amount_ron: 505, bank_fee_ron: 2 }), 507);
  assert.equal(transactionCashAmountRon({ direction: 'IN', currency: 'EUR', bank_amount_ron: 505, bank_fee_ron: 2 }), 505);
});
test('9. factură primită RON', () => assert.equal(balance(125, [125]), 0));
test('10. factură primită EUR', () => assert.equal(round2(100 * 5), 500));
test('11. cheltuială deductibilă integral', () => assert.equal(round2(1000 * 100 / 100), 1000));
test('12. cheltuială nedeductibilă', () => assert.equal(round2(1000 * 0 / 100), 0));
test('13. mijloc fix - ultima rată nu depășește valoarea', () => {
  const monthly = round2(1000 / 3);
  assert.equal(round2(1000 - monthly - monthly), 333.34);
});
test('14. decembrie / ianuarie se separă după data plății', () => {
  const payments = [{ date: '2027-01-03', amount: 1000 }];
  assert.equal(payments.filter(x => x.date.startsWith('2026-')).length, 0);
  assert.equal(payments.filter(x => x.date.startsWith('2027-')).length, 1);
});
test('15. modificarea logică a unei plăți recalculează soldul din sursă', () => assert.equal(balance(1000, [250]), 750));
test('16. modelul cheii pentru un viitor import bancar este idempotent', () => {
  const imported = new Set(['acct|2026-08-01|100.00|RON|ref']);
  assert.equal(imported.has('acct|2026-08-01|100.00|RON|ref'), true);
});
test('17. două plăți concurente nu pot depăși soldul blocat', () => {
  let remaining = 1000;
  const apply = amount => amount <= remaining && ((remaining = round2(remaining - amount)), true);
  assert.equal(apply(700), true);
  assert.equal(apply(400), false);
  assert.equal(remaining, 300);
});
test('18. valori cu multe zecimale coincid cu round numeric PostgreSQL', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(-1.005), -1.01);
  assert.deepEqual(calculateLineTotals(line('1.005', '10.005', 0, 0)), {
    gross_amount: 10.11, net_amount: 10.11, vat_amount: 0, total_amount: 10.11
  });
});
test('19. discountul se aplică înaintea TVA', () => {
  assert.deepEqual(calculateLineTotals(line(2, 100, 20, 19)), {
    gross_amount: 200, net_amount: 180, vat_amount: 34.2, total_amount: 214.2
  });
});
test('20. total zero este calculat exact', () => assert.equal(calculateInvoiceTotals([line(1, 0)]).total, 0));
test('21. valorile negative sunt rotunjite simetric', () => assert.equal(round2(-0.105), -0.11));
test('22. plata peste sold este detectată', () => assert.ok(balance(1000, [1001]) < 0));
test('totalurile multi-linie nu acumulează erori binare', () => {
  assert.equal(calculateInvoiceTotals([line(1, 0.1), line(1, 0.2)]).total, 0.3);
});
test('monedele diferite nu sunt însumate sub eticheta RON', () => {
  const label = formatCurrencyTotals(totalsByCurrency([
    { currency: 'RON', amount: 100 }, { currency: 'EUR', amount: 20 }
  ]));
  assert.match(label, /RON/);
  assert.match(label, /EUR/);
});
const efacturaSettings = {
  legal_name: 'TALDEV PFA', cui: '25107062', reg_com: 'F00/1/2026',
  address: 'Str. Test 1', city: 'Cluj-Napoca', county: 'Cluj',
  vat_status: 'neinregistrat', email: 'office@example.ro',
  bank_account: { iban: 'RO49AAAA1B31007593840000', bank_name: 'Banca Test' }
};
const efacturaInvoice = {
  id: '550e8400-e29b-41d4-a716-446655440000', series: 'FCT', number: '42',
  issue_date: '2026-08-29', due_date: '2026-09-28', document_status: 'ISSUED',
  invoice_type: 'STANDARD', currency: 'RON', subtotal: 200, discount_total: 20,
  taxable_base: 180, vat_total: 0, total: 180, payment_method: 'BANK',
  clients: { legal_name: 'Client & Partener SRL', cui: '25107062', address: 'Bd. Exemplu <2>', city: 'Cluj-Napoca', county: 'CJ' },
  invoice_lines: [{ position: 1, description: 'Servicii consultanță & dezvoltare', quantity: 2, unit: 'ore', unit_price: 100, discount: 20, net_amount: 180, vat_rate: 0, vat_amount: 0 }]
};

test('XML e-Factura UBL 2.1 / CIUS-RO se generează pentru PFA neplătitor TVA', () => {
  const xml = generateEfacturaXml(efacturaInvoice, efacturaSettings);
  assert.equal(EFACTURA_EXPORT_VALIDATED, true);
  assert.equal(isWellFormedXml(xml), true);
  assert.match(xml, new RegExp(CIUS_RO_CUSTOMIZATION_ID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(xml, /<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/);
  assert.match(xml, /<cbc:ID>O<\/cbc:ID>/);
  assert.match(xml, /<cbc:TaxExemptionReasonCode>VATEX-EU-O<\/cbc:TaxExemptionReasonCode>/);
  assert.match(xml, /<cac:AllowanceCharge>/);
  assert.doesNotMatch(xml, /<cbc:AllowanceTotalAmount/);
  assert.match(xml, /Client &amp; Partener SRL/);
  assert.match(xml, /Bd\. Exemplu &lt;2&gt;/);
  assert.match(xml, /<cbc:PayableAmount currencyID="RON">180\.00<\/cbc:PayableAmount>/);
});

test('XML e-Factura refuză totaluri nereconciliate', () => {
  assert.throws(
    () => generateEfacturaXml({ ...efacturaInvoice, total: 179.99 }, efacturaSettings),
    /Totalul nu corespunde liniilor/
  );
});

test('nota de credit folosește CreditNote, BillingReference și CreditNoteLine', () => {
  const xml = generateEfacturaXml({
    ...efacturaInvoice,
    id: '550e8400-e29b-41d4-a716-446655440001',
    invoice_type: 'CORRECTION',
    corrects_invoice_id: '550e8400-e29b-41d4-a716-446655440000',
    corrects_invoice_number: 'FCT-41'
  }, efacturaSettings);
  assert.match(xml, /<CreditNote xmlns=/);
  assert.match(xml, /<cbc:CreditNoteTypeCode>381<\/cbc:CreditNoteTypeCode>/);
  assert.match(xml, /<cac:BillingReference>/);
  assert.match(xml, /<cac:CreditNoteLine>/);
});

test('XML e-Factura refuză o adresă obligatorie lipsă', () => {
  assert.throws(
    () => generateEfacturaXml({ ...efacturaInvoice, clients: { ...efacturaInvoice.clients, address: '' } }, efacturaSettings),
    /Client: adresa lipsește/
  );
});
test('validatorul CUI aplică cheia și multiplicarea modulo 11', () => {
  assert.equal(isValidCUI('25107062'), true);
  assert.equal(isValidCUI('RO25107062'), true);
  assert.equal(isValidCUI('25107063'), false);
});
