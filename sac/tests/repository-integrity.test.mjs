import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const SUPABASE_JS_VERSION = '2.112.4';
const CDN_URL = `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${SUPABASE_JS_VERSION}/dist/umd/supabase.min.js`;

test('metadatele aplicației folosesc numele repo-ului activ', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(packageJson.name, 'taldev-sac');
});

test('ambele căi de încărcare folosesc aceeași versiune Supabase JS', () => {
  const indexHtml = readFileSync('index.html', 'utf8');
  const supabaseLoader = readFileSync('js/supabase.js', 'utf8');

  assert.ok(indexHtml.includes(CDN_URL));
  assert.ok(supabaseLoader.includes(CDN_URL));
  assert.doesNotMatch(indexHtml + supabaseLoader, /@supabase\/supabase-js@2\.45\.0/);
});

test('istoricul local conține exact 27 de migrații cu versiuni și nume unice', () => {
  const migrations = readdirSync('supabase/migrations')
    .filter(file => file.endsWith('.sql'))
    .sort();

  assert.equal(migrations.length, 27);
  assert.equal(new Set(migrations.map(file => file.split('_', 1)[0])).size, migrations.length);
  assert.equal(new Set(migrations.map(file => file.replace(/^\d+_/, ''))).size, migrations.length);
});
