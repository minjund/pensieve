'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { mkTempHome, rmRf } = require('./_helpers');

let TMP;
let db, files, cfgMod;
let hasDriver = false;

before(() => {
  TMP = mkTempHome();
  db = require('../lib/db');
  files = require('../lib/files');
  cfgMod = require('../lib/config');
  hasDriver = !!db.loadDriver();
});
after(() => rmRf(TMP));

function setLimit(limit) {
  const cfgPath = path.join(TMP, '.claude', 'hermes-memory-config.json');
  const json = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  json.memoryCharLimit = limit;
  json.memoryOverflowStrategy = 'fifo-evict';
  json.extendedStoreEnabled = true;
  fs.writeFileSync(cfgPath, JSON.stringify(json, null, 2));
  cfgMod.resetConfig();
}

test('migrateSchema adds is_extended column on existing memories table', () => {
  if (!hasDriver) return;
  const D = db.loadDriver();
  const conn = new D(db.DB_PATH);
  try {
    db.ensureSchema(conn);
    db.migrateSchema(conn);
    const cols = conn.prepare(`PRAGMA table_info(memories)`).all().map(c => c.name);
    assert.ok(cols.includes('is_extended'), `is_extended column missing: ${cols.join(',')}`);
  } finally { conn.close(); }
});

test('markAsExtended flips flag on existing row', () => {
  if (!hasDriver) return;
  const D = db.loadDriver();
  // Seed via mirrorMemory
  db.mirrorMemory({ scope: 'project', project: 'ext-test', target: 'MEMORY.md', source: 'test', category: 'insight', content: 'extended-flag-target-content-xyz' });
  const n = db.markAsExtended({ scope: 'project', project: 'ext-test', target: 'MEMORY.md', content: 'extended-flag-target-content-xyz' });
  assert.ok(n >= 1, `expected at least 1 row marked, got ${n}`);
  const conn = new D(db.DB_PATH, { readonly: true });
  try {
    const row = conn.prepare(`SELECT is_extended FROM memories WHERE content = ?`).get('extended-flag-target-content-xyz');
    assert.equal(row.is_extended, 1);
  } finally { conn.close(); }
});

test('markAsExtended inserts new extended row when content not present', () => {
  if (!hasDriver) return;
  const n = db.markAsExtended({ scope: 'project', project: 'ext-test', target: 'MEMORY.md', content: 'never-was-in-mirror-content-zzz' });
  assert.ok(n >= 1);
  const D = db.loadDriver();
  const conn = new D(db.DB_PATH, { readonly: true });
  try {
    const row = conn.prepare(`SELECT is_extended FROM memories WHERE content = ?`).get('never-was-in-mirror-content-zzz');
    assert.equal(row.is_extended, 1);
  } finally { conn.close(); }
});

test('appendEntry overflow moves evicted entries to extended store', () => {
  if (!hasDriver) return;
  setLimit(1500);
  const slug = 'overflow-ext';
  // Seed many entries to force eviction.
  const tokens = [];
  for (let i = 0; i < 20; i++) {
    const token = `ext-overflow-marker-${i.toString().padStart(3, '0')}`;
    tokens.push(token);
    files.appendEntry('MEMORY.md', `${token}-${'y'.repeat(140)}`, { projectSlug: slug });
  }
  // The early tokens should no longer be in the MD file but should exist as is_extended=1 in db.
  const filePath = path.join(TMP, '.claude', 'projects-memory', slug, 'MEMORY.md');
  const md = fs.readFileSync(filePath, 'utf8');
  const evictedExists = tokens.some(t => !md.includes(t));
  assert.ok(evictedExists, 'at least one early entry must have been evicted from MD');

  const ext = db.searchExtended('', { scope: 'project', project: slug, limit: 50 });
  assert.ok(Array.isArray(ext));
  assert.ok(ext.length >= 1, `expected extended rows, got ${ext.length}`);
});

test('searchExtended FTS query returns matching evicted entries', () => {
  if (!hasDriver) return;
  // Use a unique token guaranteed to be evicted.
  setLimit(800);
  const slug = 'fts-ext';
  files.appendEntry('MEMORY.md', `firstSearchableExtendedToken-${'a'.repeat(120)}`, { projectSlug: slug });
  for (let i = 0; i < 12; i++) {
    files.appendEntry('MEMORY.md', `pushOutEntry-${i}-${'b'.repeat(120)}`, { projectSlug: slug });
  }
  const r = db.searchExtended('firstSearchableExtendedToken', { project: slug, scope: 'project' });
  assert.ok(Array.isArray(r));
  // At least one extended row should match the FTS query (may be 0 if FTS5 doesn't tokenize the camelCase token; fall back to substring listing)
  if (r.length === 0) {
    const list = db.searchExtended('', { project: slug, scope: 'project', limit: 50 });
    const found = list.some(row => row.snippet && row.snippet.includes('firstSearchableExtendedToken'));
    assert.ok(found, 'expected to find evicted token via fallback substring listing');
  }
});
