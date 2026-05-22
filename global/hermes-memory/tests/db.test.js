'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { mkTempHome, rmRf, REPO_ROOT } = require('./_helpers');

let TMP, db, hasDriver;

before(() => {
  TMP = mkTempHome();
  // Symlink/copy node_modules from repo if present so better-sqlite3 is reachable
  const repoNm = path.join(REPO_ROOT, 'node_modules');
  const targetNm = path.join(TMP, '.claude', 'hermes-memory', 'node_modules');
  try {
    if (fs.existsSync(repoNm) && !fs.existsSync(targetNm)) {
      fs.mkdirSync(path.dirname(targetNm), { recursive: true });
      try { fs.symlinkSync(repoNm, targetNm, 'junction'); }
      catch { fs.cpSync(repoNm, targetNm, { recursive: true }); }
    }
  } catch {}
  db = require('../lib/db');
  hasDriver = db.loadDriver() !== null;
});
after(() => rmRf(TMP));

test('FTS5 schema can be created (or skip if driver absent)', () => {
  if (!hasDriver) { console.log('  skip: better-sqlite3 not installed'); return; }
  const inserted = db.mirrorMemory({ scope: 'global', project: '', target: 'USER.md', source: 'test', category: 'preference', content: 'fts-test-content-alpha' });
  assert.equal(inserted, true);
});

test('searchMemories returns matching row via FTS5', () => {
  if (!hasDriver) { console.log('  skip: no driver'); return; }
  const rows = db.searchMemories('fts-test-content-alpha');
  assert.ok(Array.isArray(rows));
  assert.ok(rows.length >= 1);
  assert.match(rows[0].snippet, /\[fts-test-content-alpha\]/);
});

test('deleteMemoryByContent removes the row', () => {
  if (!hasDriver) { console.log('  skip: no driver'); return; }
  const removed = db.deleteMemoryByContent({ scope: 'global', project: '', target: 'USER.md', content: 'fts-test-content-alpha' });
  assert.ok(removed >= 1);
  const rows = db.searchMemories('fts-test-content-alpha');
  assert.equal(rows.length, 0);
});

test('getStats returns counts (zero baseline ok)', () => {
  if (!hasDriver) { console.log('  skip: no driver'); return; }
  const s = db.getStats();
  assert.ok(s);
  assert.ok(typeof s.memCount === 'number');
});
