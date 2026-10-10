import assert from 'node:assert/strict';
import test from 'node:test';
import { validateFile, buildStoragePath } from '../js/services/storage-service.js';

const fakeFile = (name, type, size = 1024) => ({ name, type, size });

test('acceptă fișier PDF cu MIME corespunzător', () => {
  assert.deepEqual(validateFile(fakeFile('factura.pdf', 'application/pdf')), { valid: true });
});

test('acceptă tipuri Office uzuale și metadata MIME lipsă', () => {
  assert.deepEqual(
    validateFile(fakeFile('registru.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
    { valid: true }
  );
  assert.deepEqual(validateFile(fakeFile('document.pdf', '')), { valid: true });
});

test('respinge extensii și fișiere invalide', () => {
  assert.equal(validateFile(fakeFile('script.html', 'text/html')).valid, false);
  assert.equal(validateFile(fakeFile('fără-extensie', 'application/pdf')).valid, false);
  assert.equal(validateFile(null).valid, false);
  assert.equal(validateFile({ name: 'factura.pdf', size: -1, type: 'application/pdf' }).valid, false);
});

test('respinge MIME nepermis și neconcordanțe între extensie și MIME', () => {
  assert.match(
    validateFile(fakeFile('factura.pdf', 'text/html')).error,
    /Tip MIME nepermis/
  );
  assert.match(
    validateFile(fakeFile('factura.pdf', 'image/png')).error,
    /nu corespunde/
  );
});

test('respinge fișiere peste limita implicită și respectă limita configurată', () => {
  assert.match(
    validateFile(fakeFile('factura.pdf', 'application/pdf', 10 * 1024 * 1024 + 1)).error,
    /prea mare/
  );
  assert.equal(
    validateFile(fakeFile('factura.pdf', 'application/pdf', 2048), { maxSize: 2048 }).valid,
    true
  );
});

test('calea de stocare folosește UUID-ul proprietarului și categorii permise', () => {
  assert.equal(
    buildStoragePath('550e8400-e29b-41d4-a716-446655440000', 'invoices', 'ab.pdf'),
    '550e8400-e29b-41d4-a716-446655440000/invoices/ab.pdf'
  );
  assert.equal(
    buildStoragePath('550e8400-e29b-41d4-a716-446655440000', 'invoices/../../', 'a b?.pdf'),
    '550e8400-e29b-41d4-a716-446655440000/other/ab.pdf'
  );
  assert.throws(() => buildStoragePath('user-123', 'invoices', 'a.pdf'), /UUID valid/);
  assert.throws(() => buildStoragePath('550e8400-e29b-41d4-a716-446655440000', 'other', '!!!'), /Numele fișierului/);
});
