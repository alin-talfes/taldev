// RO e-Factura: UBL 2.1 / EN 16931 / CIUS-RO 1.0.1.
// Deterministic generator: refuses incomplete parties or unreconciled totals.

import { round2 } from '../utils.js';

export const CIUS_RO_CUSTOMIZATION_ID =
  'urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1';
export const EFACTURA_EXPORT_VALIDATED = true;

const PROFILE_ID = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';
const DEFAULT_BUYER_TAX_ID = '0000000000000';

const COUNTY_CODES = new Map([
  ['ALBA','AB'],['ARAD','AR'],['ARGES','AG'],['ARGEȘ','AG'],['BACAU','BC'],['BACĂU','BC'],['BIHOR','BH'],
  ['BISTRITA-NASAUD','BN'],['BISTRIȚA-NĂSĂUD','BN'],['BOTOSANI','BT'],['BOTOȘANI','BT'],['BRASOV','BV'],
  ['BRAȘOV','BV'],['BRAILA','BR'],['BRĂILA','BR'],['BUZAU','BZ'],['BUZĂU','BZ'],['CARAS-SEVERIN','CS'],
  ['CARAȘ-SEVERIN','CS'],['CALARASI','CL'],['CĂLĂRAȘI','CL'],['CLUJ','CJ'],['CONSTANTA','CT'],['CONSTANȚA','CT'],
  ['COVASNA','CV'],['DAMBOVITA','DB'],['DÂMBOVIȚA','DB'],['DOLJ','DJ'],['GALATI','GL'],['GALAȚI','GL'],
  ['GIURGIU','GR'],['GORJ','GJ'],['HARGHITA','HR'],['HUNEDOARA','HD'],['IALOMITA','IL'],['IALOMIȚA','IL'],
  ['IASI','IS'],['IAȘI','IS'],['ILFOV','IF'],['MARAMURES','MM'],['MARAMUREȘ','MM'],['MEHEDINTI','MH'],
  ['MEHEDINȚI','MH'],['MURES','MS'],['MUREȘ','MS'],['NEAMT','NT'],['NEAMȚ','NT'],['OLT','OT'],['PRAHOVA','PH'],
  ['SATU MARE','SM'],['SALAJ','SJ'],['SĂLAJ','SJ'],['SIBIU','SB'],['SUCEAVA','SV'],['TELEORMAN','TR'],
  ['TIMIS','TM'],['TIMIȘ','TM'],['TULCEA','TL'],['VASLUI','VS'],['VALCEA','VL'],['VÂLCEA','VL'],['VRANCEA','VN'],
  ['BUCURESTI','B'],['BUCUREȘTI','B'],['MUNICIPIUL BUCURESTI','B'],['MUNICIPIUL BUCUREȘTI','B']
]);

const UNIT_CODES = new Map([
  ['BUC','C62'],['BUCATA','C62'],['BUCATI','C62'],['BUCATĂ','C62'],['BUCĂȚI','C62'],['H87','H87'],['C62','C62'],
  ['ORA','HUR'],['ORE','HUR'],['H','HUR'],['HUR','HUR'],['ZI','DAY'],['ZILE','DAY'],['DAY','DAY'],
  ['LUNA','MON'],['LUNI','MON'],['MON','MON'],['KG','KGM'],['KGM','KGM'],['L','LTR'],['LITRU','LTR'],
  ['LITRI','LTR'],['LTR','LTR'],['M','MTR'],['MTR','MTR'],['MP','MTK'],['M2','MTK'],['MTK','MTK'],['SET','SET']
]);

export function validateEfacturaInput(invoice, pfaSettings = {}) {
  const errors = [];
  const lines = invoice?.invoice_lines || [];
  const client = invoice?.clients || {};
  const credit = isCreditNote(invoice);
  required(errors, invoice?.id, 'Factura nu are identificator intern.');
  required(errors, invoice?.series, 'Seria facturii lipsește.');
  required(errors, invoice?.number, 'Numărul facturii lipsește.');
  required(errors, validIsoDate(invoice?.issue_date), 'Data emiterii este invalidă.');
  if (!credit) required(errors, validIsoDate(invoice?.due_date), 'Data scadenței este invalidă.');
  required(errors, /^[A-Z]{3}$/.test(String(invoice?.currency || '')), 'Moneda documentului nu este ISO 4217.');
  required(errors, ['ISSUED','STORNED','CORRECTED'].includes(invoice?.document_status), 'Se pot exporta numai documente emise.');
  required(errors, lines.length > 0, 'Factura nu are linii.');
  validateParty(errors, pfaSettings, 'Furnizor', true);
  validateParty(errors, client, 'Client', false);
  if (credit) required(errors, invoice?.corrects_invoice_id || invoice?.storno_for_invoice_id,
    'Nota de credit nu are referință la factura inițială.');

  let lineNet = 0;
  let lineVat = 0;
  lines.forEach((line, index) => {
    const prefix = `Linia ${index + 1}`;
    required(errors, String(line?.description || '').trim(), `${prefix}: descrierea lipsește.`);
    required(errors, finitePositiveAbs(line?.quantity), `${prefix}: cantitatea trebuie să fie nenulă.`);
    required(errors, finiteNonNegative(line?.unit_price), `${prefix}: prețul unitar este invalid.`);
    const gross = round2(Math.abs(Number(line.quantity)) * Number(line.unit_price));
    const discount = round2(Math.abs(Number(line.discount || 0)));
    required(errors, discount <= gross, `${prefix}: discountul depășește valoarea brută.`);
    const expectedNet = round2(gross - discount);
    const expectedVat = round2(expectedNet * Math.abs(Number(line.vat_rate || 0)) / 100);
    required(errors, closeMoney(Math.abs(Number(line.net_amount)), expectedNet), `${prefix}: netul este inconsistent.`);
    required(errors, closeMoney(Math.abs(Number(line.vat_amount || 0)), expectedVat), `${prefix}: TVA este inconsistentă.`);
    lineNet = round2(lineNet + expectedNet);
    lineVat = round2(lineVat + expectedVat);
  });
  required(errors, closeMoney(Math.abs(Number(invoice?.taxable_base)), lineNet), 'Baza impozabilă nu corespunde liniilor.');
  required(errors, closeMoney(Math.abs(Number(invoice?.vat_total || 0)), lineVat), 'TVA totală nu corespunde liniilor.');
  required(errors, closeMoney(Math.abs(Number(invoice?.total)), round2(lineNet + lineVat)), 'Totalul nu corespunde liniilor.');
  if (String(pfaSettings?.vat_status || 'neinregistrat') === 'neinregistrat') {
    required(errors, lineVat === 0, 'PFA neînregistrat în scopuri de TVA nu poate colecta TVA.');
  }
  if (String(invoice?.currency) !== 'RON') {
    required(errors, Number(invoice?.document_exchange_rate) > 0, 'Factura în valută nu are cursul documentului.');
    required(errors, validIsoDate(invoice?.document_exchange_rate_date), 'Data cursului este invalidă.');
  }
  return errors;
}

export function generateEfacturaXml(invoice, pfaSettings = {}) {
  const errors = validateEfacturaInput(invoice, pfaSettings);
  if (errors.length) throw new Error(`RO e-Factura nu poate fi generată:\n- ${errors.join('\n- ')}`);
  const credit = isCreditNote(invoice);
  const currency = String(invoice.currency).toUpperCase();
  const lines = invoice.invoice_lines || [];
  const client = invoice.clients || {};
  const nonVat = String(pfaSettings.vat_status || 'neinregistrat') === 'neinregistrat';
  const root = credit ? 'CreditNote' : 'Invoice';
  const lineTag = credit ? 'CreditNoteLine' : 'InvoiceLine';
  const quantityTag = credit ? 'CreditedQuantity' : 'InvoicedQuantity';
  const documentId = `${String(invoice.series).trim()}-${String(invoice.number).trim()}`;
  const total = moneyAbs(invoice.total);
  const taxable = moneyAbs(invoice.taxable_base);
  const vatTotal = moneyAbs(invoice.vat_total || 0);
  const rate = Number(invoice.document_exchange_rate || 1);
  const xml = ['<?xml version="1.0" encoding="UTF-8"?>'];
  xml.push(`<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">`);
  xml.push(tag('cbc:CustomizationID', CIUS_RO_CUSTOMIZATION_ID), tag('cbc:ProfileID', PROFILE_ID), tag('cbc:ID', documentId));
  xml.push(tag('cbc:IssueDate', isoDate(invoice.issue_date)));
  if (!credit) xml.push(tag('cbc:DueDate', isoDate(invoice.due_date)));
  xml.push(tag(`cbc:${credit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'}`, credit ? '381' : '380'));
  if (invoice.notes) xml.push(tag('cbc:Note', String(invoice.notes).slice(0, 300)));
  xml.push(tag('cbc:DocumentCurrencyCode', currency));
  if (currency !== 'RON') xml.push(tag('cbc:TaxCurrencyCode', 'RON'));
  xml.push(tag('cbc:BuyerReference', buyerReference(client)));
  if (credit) {
    const original = invoice.corrects_invoice_number || invoice.corrects_invoice_id || invoice.storno_for_invoice_id;
    xml.push(`<cac:BillingReference><cac:InvoiceDocumentReference>${tag('cbc:ID', original)}</cac:InvoiceDocumentReference></cac:BillingReference>`);
  }
  xml.push(partyXml('AccountingSupplierParty', pfaSettings, true));
  xml.push(partyXml('AccountingCustomerParty', client, false));
  xml.push(`<cac:Delivery><cac:DeliveryLocation>${addressXml(client)}</cac:DeliveryLocation></cac:Delivery>`);
  if (!credit) {
    xml.push(paymentMeansXml(invoice, pfaSettings, documentId));
    xml.push(`<cac:PaymentTerms>${tag('cbc:Note', `Scadență: ${isoDate(invoice.due_date)}`)}</cac:PaymentTerms>`);
  }
  xml.push(taxTotalXml(currency, vatTotal, buildTaxGroups(lines, nonVat)));
  if (currency !== 'RON') xml.push(`<cac:TaxTotal>${moneyTag('cbc:TaxAmount', round2(vatTotal * rate), 'RON')}</cac:TaxTotal>`);
  xml.push('<cac:LegalMonetaryTotal>', moneyTag('cbc:LineExtensionAmount', taxable, currency));
  xml.push(moneyTag('cbc:TaxExclusiveAmount', taxable, currency), moneyTag('cbc:TaxInclusiveAmount', total, currency));
  // Line discounts are already represented by cac:AllowanceCharge on each line
  // and are therefore not repeated as a document-level allowance (BR-CO-11).
  xml.push(moneyTag('cbc:PrepaidAmount', 0, currency), moneyTag('cbc:PayableAmount', total, currency), '</cac:LegalMonetaryTotal>');

  lines.forEach((line, index) => {
    const quantity = Math.abs(Number(line.quantity));
    const discount = moneyAbs(line.discount || 0);
    const category = taxCategory(line, nonVat);
    xml.push(`<cac:${lineTag}>`, tag('cbc:ID', line.position || index + 1));
    xml.push(`<cbc:${quantityTag} unitCode="${attr(unitCode(line.unit))}">${decimal(quantity, 4)}</cbc:${quantityTag}>`);
    xml.push(moneyTag('cbc:LineExtensionAmount', moneyAbs(line.net_amount), currency));
    if (discount > 0) {
      xml.push('<cac:AllowanceCharge>', tag('cbc:ChargeIndicator', 'false'), tag('cbc:AllowanceChargeReason', 'Discount comercial'));
      xml.push(moneyTag('cbc:Amount', discount, currency), moneyTag('cbc:BaseAmount', round2(quantity * Number(line.unit_price)), currency), '</cac:AllowanceCharge>');
    }
    xml.push('<cac:Item>', tag('cbc:Description', String(line.description).slice(0, 200)), tag('cbc:Name', String(line.description).slice(0, 100)));
    xml.push('<cac:ClassifiedTaxCategory>', tag('cbc:ID', category.code), tag('cbc:Percent', decimal(category.rate, 2)));
    if (category.exemptionCode) xml.push(tag('cbc:TaxExemptionReasonCode', category.exemptionCode));
    if (category.exemptionReason) xml.push(tag('cbc:TaxExemptionReason', category.exemptionReason));
    xml.push('<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>');
    xml.push('<cac:Price>', moneyTag('cbc:PriceAmount', Number(line.unit_price), currency));
    xml.push(`<cbc:BaseQuantity unitCode="${attr(unitCode(line.unit))}">1</cbc:BaseQuantity></cac:Price>`, `</cac:${lineTag}>`);
  });
  xml.push(`</${root}>`);
  return xml.join('\n');
}

export function isWellFormedXml(xmlString) {
  if (typeof DOMParser === 'undefined') return typeof xmlString === 'string' && /^<\?xml[^>]*>\s*<(Invoice|CreditNote)\b/.test(xmlString) && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xmlString);
  try { return !new DOMParser().parseFromString(xmlString, 'application/xml').querySelector('parsererror'); } catch { return false; }
}

export function downloadXml(xmlString, filename) {
  const blob = new Blob([xmlString], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}

function validateParty(errors, party, label, supplier) {
  required(errors, String(party?.legal_name || '').trim(), `${label}: denumirea legală lipsește.`);
  required(errors, String(party?.address || '').trim(), `${label}: adresa lipsește.`);
  required(errors, String(party?.city || '').trim(), `${label}: localitatea lipsește.`);
  required(errors, countyCode(party?.county), `${label}: județul nu poate fi mapat la ISO 3166-2 RO.`);
  if (supplier) required(errors, /^\d{2,10}$/.test(digits(party?.cui)), `${label}: este necesar un CUI, nu CNP.`);
}

function partyXml(role, party, supplier) {
  const name = String(party.legal_name).trim();
  const fiscal = digits(party.cui);
  const vatId = normalizeVat(party.vat_number || (supplier && party.vat_status !== 'neinregistrat' ? party.cui : ''));
  const legalId = supplier ? (String(party.reg_com || '').trim() || fiscal) : (fiscal.length <= 10 && fiscal ? fiscal : DEFAULT_BUYER_TAX_ID);
  const taxId = vatId || (supplier ? fiscal : (fiscal.length <= 10 && fiscal ? fiscal : DEFAULT_BUYER_TAX_ID));
  const out = [`<cac:${role}><cac:Party>`];
  if (fiscal.length <= 10 && fiscal) out.push(`<cbc:EndpointID schemeID="9947">${escapeXml(fiscal)}</cbc:EndpointID>`);
  out.push(`<cac:PartyName>${tag('cbc:Name', name)}</cac:PartyName>`, addressXml(party));
  out.push(`<cac:PartyTaxScheme>${tag('cbc:CompanyID', taxId)}<cac:TaxScheme>${tag('cbc:ID', vatId ? 'VAT' : 'NOT_EU_VAT')}</cac:TaxScheme></cac:PartyTaxScheme>`);
  out.push(`<cac:PartyLegalEntity>${tag('cbc:RegistrationName', name)}${tag('cbc:CompanyID', legalId)}</cac:PartyLegalEntity>`);
  if (party.email || party.phone) out.push(`<cac:Contact>${party.phone ? tag('cbc:Telephone', party.phone) : ''}${party.email ? tag('cbc:ElectronicMail', party.email) : ''}</cac:Contact>`);
  out.push(`</cac:Party></cac:${role}>`);
  return out.join('');
}

function addressXml(party) {
  const code = countyCode(party.county);
  const city = code === 'B' ? normalizeBucharestSector(party.city) : String(party.city).trim();
  const country = String(party.country_code || 'RO').toUpperCase();
  return `<cac:PostalAddress>${tag('cbc:StreetName', party.address)}${tag('cbc:CityName', city)}${party.postal_code ? tag('cbc:PostalZone', party.postal_code) : ''}${tag('cbc:CountrySubentity', `${country}-${code}`)}<cac:Country>${tag('cbc:IdentificationCode', country)}</cac:Country></cac:PostalAddress>`;
}

function paymentMeansXml(invoice, settings, documentId) {
  const bank = settings.bank_account || settings.default_bank_account || null;
  const method = String(invoice.payment_method || 'BANK').toUpperCase();
  const code = method === 'CASH' ? '10' : method === 'CARD' ? '48' : '30';
  let account = '';
  if (code === '30' && bank?.iban) account = `<cac:PayeeFinancialAccount>${tag('cbc:ID', String(bank.iban).replace(/\s/g, '').toUpperCase())}${bank.bank_name ? `<cac:FinancialInstitutionBranch>${tag('cbc:Name', bank.bank_name)}</cac:FinancialInstitutionBranch>` : ''}</cac:PayeeFinancialAccount>`;
  return `<cac:PaymentMeans>${tag('cbc:PaymentMeansCode', code)}${tag('cbc:PaymentID', documentId)}${account}</cac:PaymentMeans>`;
}

function taxTotalXml(currency, total, groups) {
  return `<cac:TaxTotal>${moneyTag('cbc:TaxAmount', total, currency)}${groups.map(group => `<cac:TaxSubtotal>${moneyTag('cbc:TaxableAmount', group.taxable, currency)}${moneyTag('cbc:TaxAmount', group.tax, currency)}<cac:TaxCategory>${tag('cbc:ID', group.code)}${tag('cbc:Percent', decimal(group.rate, 2))}${group.exemptionCode ? tag('cbc:TaxExemptionReasonCode', group.exemptionCode) : ''}${group.exemptionReason ? tag('cbc:TaxExemptionReason', group.exemptionReason) : ''}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`).join('')}</cac:TaxTotal>`;
}

function buildTaxGroups(lines, nonVat) {
  const groups = new Map();
  lines.forEach(line => {
    const category = taxCategory(line, nonVat);
    const key = `${category.code}|${category.rate}|${category.exemptionCode || ''}`;
    const group = groups.get(key) || { ...category, taxable: 0, tax: 0 };
    group.taxable = round2(group.taxable + moneyAbs(line.net_amount));
    group.tax = round2(group.tax + moneyAbs(line.vat_amount || 0));
    groups.set(key, group);
  });
  return [...groups.values()];
}

function taxCategory(line, nonVat) {
  if (nonVat) return { code:'O', rate:0, exemptionCode:'VATEX-EU-O', exemptionReason:'Not subject to VAT' };
  const rate = Math.abs(Number(line.vat_rate || 0));
  const category = String(line.vat_category || '').toUpperCase();
  if (category === 'EXEMPT') return { code:'E', rate:0, exemptionCode:'VATEX-EU-132', exemptionReason:'Exempt from VAT' };
  if (category === 'ZERO') return { code:'Z', rate:0 };
  if (category === 'REVERSE_CHARGE') return { code:'AE', rate:0, exemptionCode:'VATEX-EU-AE', exemptionReason:'Reverse charge' };
  if (category === 'NONE' || category === 'NOT_TAXED') return { code:'O', rate:0, exemptionCode:'VATEX-EU-O', exemptionReason:'Not subject to VAT' };
  return { code:'S', rate };
}

function countyCode(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (/^(AB|AR|AG|BC|BH|BN|BT|BV|BR|BZ|CS|CL|CJ|CT|CV|DB|DJ|GL|GR|GJ|HR|HD|IL|IS|IF|MM|MH|MS|NT|OT|PH|SM|SJ|SB|SV|TR|TM|TL|VS|VL|VN|B)$/.test(raw)) return raw;
  return COUNTY_CODES.get(raw) || '';
}
function normalizeBucharestSector(city) { const raw=String(city||'').trim().toUpperCase().replace(/\s+/g,''); const match=raw.match(/(?:SECTOR(?:UL)?)([1-6])/); return match ? `SECTOR${match[1]}` : raw; }
function buyerReference(client) { const fiscal=digits(client.cui); return fiscal.length<=10 && fiscal ? fiscal : 'B2C'; }
function unitCode(unit) { const raw=String(unit||'C62').trim().toUpperCase().replace(/[.]/g,''); return UNIT_CODES.get(raw)||'C62'; }
function isCreditNote(invoice) { return ['STORNO','CORRECTION'].includes(String(invoice?.invoice_type||'').toUpperCase()); }
function normalizeVat(value) { const raw=String(value||'').replace(/\s/g,'').toUpperCase(); return raw ? (raw.startsWith('RO') ? raw : `RO${digits(raw)}`) : ''; }
function digits(value) { return String(value||'').replace(/\D/g,''); }
function validIsoDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value||'').slice(0,10)); }
function isoDate(value) { return String(value).slice(0,10); }
function finitePositiveAbs(value) { return Number.isFinite(Number(value)) && Math.abs(Number(value))>0; }
function finiteNonNegative(value) { return Number.isFinite(Number(value)) && Number(value)>=0; }
function closeMoney(left,right) { return Number.isFinite(left) && round2(left) === round2(right); }
function moneyAbs(value) { return round2(Math.abs(Number(value)||0)); }
function decimal(value,places) { return Number(value||0).toFixed(places).replace(/(?:\.0+|(?:(\.\d*?)0+))$/,'$1'); }
function moneyTag(name,value,currency) { return `<${name} currencyID="${attr(currency)}">${Number(value||0).toFixed(2)}</${name}>`; }
function tag(name,value) { return `<${name}>${escapeXml(value)}</${name}>`; }
function required(errors,condition,message) { if (!condition) errors.push(message); }
function attr(value) { return escapeXml(value).replace(/'/g,'&apos;'); }
function escapeXml(value) { return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
