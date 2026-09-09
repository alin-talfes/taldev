import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('modulul Audit este legat în navigare și router', () => {
  const indexHtml = readFileSync('index.html', 'utf8');
  const router = readFileSync('js/router.js', 'utf8');

  assert.match(indexHtml, /href="#\/audit"\s+data-route="audit"/);
  assert.match(indexHtml, /css\/audit\.css/);
  assert.match(router, /import \* as audit from '\.\/modules\/audit\.js';/);
  assert.match(router, /'audit': \{ title: 'Audit', render: audit\.render, destroy: audit\.destroy \}/);
});

test('modulul Audit este read-only și folosește jurnalul existent', () => {
  const auditModule = readFileSync('js/modules/audit.js', 'utf8');

  assert.match(auditModule, /auditApi\.list/);
  assert.match(auditModule, /loadAllInvoices/);
  assert.match(auditModule, /Exportă CSV/);
  assert.doesNotMatch(auditModule, /\.(?:insert|update|delete)\s*\(|Api\.(?:create|update|remove|save|issue|confirm|cancel)\s*\(/);
});
