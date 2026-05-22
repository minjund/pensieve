'use strict';
const fs = require('fs');
const path = require('path');
const { DB_PATH, HERMES_DIR, GLOBAL_MEMORY_DIR } = require('./paths');

let Database = null;
let resolved = false;

function loadDriver() {
  if (resolved) return Database;
  resolved = true;
  try { Database = require('better-sqlite3'); return Database; } catch {}
  try { Database = require(path.join(HERMES_DIR, 'node_modules', 'better-sqlite3')); return Database; } catch {}
  Database = null;
  return null;
}

function ensureDirs() {
  fs.mkdirSync(GLOBAL_MEMORY_DIR, { recursive: true });
  fs.mkdirSync(HERMES_DIR, { recursive: true });
}

function openDb(readonly = false) {
  const Drv = loadDriver();
  if (!Drv) return null;
  ensureDirs();
  let db;
  try { db = new Drv(DB_PATH, readonly ? { readonly: true } : {}); }
  catch { return null; }
  try { db.pragma('journal_mode = WAL'); } catch {}
  return db;
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created TEXT NOT NULL,
      scope TEXT NOT NULL,
      project TEXT,
      target TEXT NOT NULL,
      source TEXT,
      category TEXT,
      content TEXT NOT NULL,
      is_extended INTEGER DEFAULT 0
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content, target UNINDEXED, scope UNINDEXED, project UNINDEXED, source UNINDEXED, category UNINDEXED, created UNINDEXED,
      content='memories', content_rowid='id'
    );
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content, target, scope, project, source, category, created)
      VALUES (new.id, new.content, new.target, new.scope, new.project, new.source, new.category, new.created);
    END;
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, target, scope, project, source, category, created)
      VALUES('delete', old.id, old.content, old.target, old.scope, old.project, old.source, old.category, old.created);
    END;

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      project TEXT,
      first_ts TEXT,
      last_ts TEXT,
      message_count INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS session_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      project TEXT,
      role TEXT,
      ts TEXT,
      content TEXT NOT NULL,
      UNIQUE(session_id, ts, role, content)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS session_fts USING fts5(
      content, role UNINDEXED, session_id UNINDEXED, project UNINDEXED, ts UNINDEXED,
      content='session_messages', content_rowid='id'
    );
    CREATE TRIGGER IF NOT EXISTS session_ai AFTER INSERT ON session_messages BEGIN
      INSERT INTO session_fts(rowid, content, role, session_id, project, ts)
      VALUES (new.id, new.content, new.role, new.session_id, new.project, new.ts);
    END;
    CREATE TRIGGER IF NOT EXISTS session_ad AFTER DELETE ON session_messages BEGIN
      INSERT INTO session_fts(session_fts, rowid, content, role, session_id, project, ts)
      VALUES('delete', old.id, old.content, old.role, old.session_id, old.project, old.ts);
    END;
  `);
}

function migrateSchema(db) {
  // Add is_extended column on existing installs (idempotent).
  try {
    const cols = db.prepare(`PRAGMA table_info(memories)`).all();
    const hasExt = cols.some(c => c.name === 'is_extended');
    if (!hasExt) {
      try { db.exec(`ALTER TABLE memories ADD COLUMN is_extended INTEGER DEFAULT 0`); } catch {}
    }
  } catch {}
}

function withDb(fn) {
  const db = openDb(false);
  if (!db) return null;
  try {
    ensureSchema(db);
    migrateSchema(db);
    return fn(db);
  } finally {
    try { db.close(); } catch {}
  }
}

function mirrorMemory({ scope, project, target, source, category, content }) {
  return withDb(db => {
    db.prepare(
      `INSERT INTO memories(created, scope, project, target, source, category, content)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(new Date().toISOString(), scope || 'global', project || '', target, source || '', category || '', content);
    return true;
  }) || false;
}

function searchMemories(query, opts = {}) {
  const db = openDb(true);
  if (!db) return null;
  try {
    ensureSchema(db);
    const q = String(query || '').replace(/"/g, ' ').trim();
    if (!q) return [];
    const limit = Math.max(1, Math.min(100, opts.limit || 20));
    const filters = [];
    const params = [q];
    if (opts.target) { filters.push('target = ?'); params.push(opts.target); }
    if (opts.scope) { filters.push('scope = ?'); params.push(opts.scope); }
    if (opts.project) { filters.push('project = ?'); params.push(opts.project); }
    const where = filters.length ? ' AND ' + filters.join(' AND ') : '';
    const sql = `SELECT target, scope, project, source, category, created,
                        snippet(memories_fts, 0, '[', ']', '...', 12) AS snippet
                 FROM memories_fts
                 WHERE memories_fts MATCH ?${where}
                 ORDER BY rank LIMIT ${limit}`;
    return db.prepare(sql).all(...params);
  } catch { return []; }
  finally { try { db.close(); } catch {} }
}

function searchSessions(query, opts = {}) {
  const db = openDb(true);
  if (!db) return null;
  try {
    ensureSchema(db);
    const q = String(query || '').replace(/"/g, ' ').trim();
    if (!q) return [];
    const limit = Math.max(1, Math.min(100, opts.limit || 20));
    const filters = [];
    const params = [q];
    if (opts.project) { filters.push('project = ?'); params.push(opts.project); }
    if (opts.role) { filters.push('role = ?'); params.push(opts.role); }
    const where = filters.length ? ' AND ' + filters.join(' AND ') : '';
    const sql = `SELECT session_id, role, project, ts,
                        snippet(session_fts, 0, '[', ']', '...', 18) AS snippet
                 FROM session_fts
                 WHERE session_fts MATCH ?${where}
                 ORDER BY rank LIMIT ${limit}`;
    return db.prepare(sql).all(...params);
  } catch { return []; }
  finally { try { db.close(); } catch {} }
}

function getStats() {
  const db = openDb(true);
  if (!db) return null;
  try {
    ensureSchema(db);
    const memCount = db.prepare('SELECT COUNT(*) AS n FROM memories').get().n;
    const sessCount = db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
    const msgCount = db.prepare('SELECT COUNT(*) AS n FROM session_messages').get().n;
    const byProject = db.prepare('SELECT project, COUNT(*) AS n FROM memories GROUP BY project').all();
    return { memCount, sessCount, msgCount, byProject };
  } catch { return null; }
  finally { try { db.close(); } catch {} }
}

function deleteMemoryByContent({ scope, project, target, content }) {
  return withDb(db => {
    const info = db.prepare(
      `DELETE FROM memories WHERE target = ? AND scope = ? AND project = ? AND content = ?`
    ).run(target, scope || 'global', project || '', content);
    return info.changes;
  }) || 0;
}

function markAsExtended({ scope, project, target, content }) {
  return withDb(db => {
    const info = db.prepare(
      `UPDATE memories SET is_extended = 1
       WHERE target = ? AND scope = ? AND project = ? AND content = ?`
    ).run(target, scope || 'global', project || '', content);
    if (info.changes > 0) return info.changes;
    // If not present yet (e.g. mirror skipped), insert as extended row.
    db.prepare(
      `INSERT INTO memories(created, scope, project, target, source, category, content, is_extended)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(new Date().toISOString(), scope || 'global', project || '', target, 'evicted', '', content);
    return 1;
  }) || 0;
}

function searchExtended(query, opts = {}) {
  const db = openDb(true);
  if (!db) return null;
  try {
    ensureSchema(db);
    migrateSchema(db);
    const q = String(query || '').replace(/"/g, ' ').trim();
    const limit = Math.max(1, Math.min(100, opts.limit || 20));
    const filters = ['m.is_extended = 1'];
    const params = [];
    if (q) {
      // Use FTS for ranking then filter by is_extended via join on rowid.
      const filtersFts = [];
      const paramsFts = [q];
      if (opts.target) { filtersFts.push('target = ?'); paramsFts.push(opts.target); }
      if (opts.scope) { filtersFts.push('scope = ?'); paramsFts.push(opts.scope); }
      if (opts.project) { filtersFts.push('project = ?'); paramsFts.push(opts.project); }
      const where = filtersFts.length ? ' AND ' + filtersFts.join(' AND ') : '';
      const sql = `SELECT m.target, m.scope, m.project, m.source, m.category, m.created,
                          snippet(memories_fts, 0, '[', ']', '...', 12) AS snippet
                   FROM memories_fts
                   JOIN memories m ON m.id = memories_fts.rowid
                   WHERE memories_fts MATCH ?${where} AND m.is_extended = 1
                   ORDER BY rank LIMIT ${limit}`;
      return db.prepare(sql).all(...paramsFts);
    }
    if (opts.target) { filters.push('target = ?'); params.push(opts.target); }
    if (opts.scope) { filters.push('scope = ?'); params.push(opts.scope); }
    if (opts.project) { filters.push('project = ?'); params.push(opts.project); }
    const where = ' WHERE ' + filters.join(' AND ');
    const sql = `SELECT target, scope, project, source, category, created,
                        substr(content, 1, 200) AS snippet
                 FROM memories m${where}
                 ORDER BY id DESC LIMIT ${limit}`;
    return db.prepare(sql).all(...params);
  } catch { return []; }
  finally { try { db.close(); } catch {} }
}

function deleteMemoryForTarget({ scope, project, target }) {
  return withDb(db => {
    const info = db.prepare(
      `DELETE FROM memories WHERE target = ? AND scope = ? AND project = ?`
    ).run(target, scope || 'global', project || '');
    return info.changes;
  }) || 0;
}

module.exports = {
  loadDriver,
  openDb,
  ensureSchema,
  migrateSchema,
  withDb,
  mirrorMemory,
  searchMemories,
  searchSessions,
  getStats,
  deleteMemoryByContent,
  deleteMemoryForTarget,
  markAsExtended,
  searchExtended,
  DB_PATH,
};
