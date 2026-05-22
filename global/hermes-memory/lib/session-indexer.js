'use strict';
const fs = require('fs');
const { withDb } = require('./db');
const { loadConfig } = require('./config');

function safeJson(line) { try { return JSON.parse(line); } catch { return null; } }

function extractContent(message) {
  if (!message) return '';
  const c = message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map(part => {
      if (!part) return '';
      if (typeof part === 'string') return part;
      if (part.type === 'text' && typeof part.text === 'string') return part.text;
      if (typeof part.text === 'string') return part.text;
      return '';
    }).filter(Boolean).join('\n');
  }
  return '';
}

function parseTranscriptFile(filePath, opts = {}) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const tail = opts.tail && opts.tail > 0 ? lines.slice(-opts.tail) : lines;
  const out = [];
  for (const line of tail) {
    const obj = safeJson(line);
    if (!obj) continue;
    const ts = obj.timestamp || obj.ts || '';
    if (obj.type === 'user' && obj.message && obj.message.role === 'user') {
      const text = extractContent(obj.message).trim();
      if (text) out.push({ role: 'user', text, ts });
    } else if (obj.type === 'assistant' && obj.message && obj.message.role === 'assistant') {
      const text = extractContent(obj.message).trim();
      if (text) out.push({ role: 'assistant', text, ts });
    }
  }
  return out;
}

function indexTranscript({ transcriptPath, sessionId, project, tail }) {
  if (!transcriptPath) return { ok: false, reason: 'no-path' };
  const cfg = loadConfig();
  if (!cfg.indexSessions) return { ok: false, reason: 'disabled' };
  const limit = typeof tail === 'number' ? tail : cfg.sessionTailMessagesPerFlush;
  const messages = parseTranscriptFile(transcriptPath, { tail: limit });
  if (!messages.length) return { ok: false, reason: 'empty' };

  const result = withDb(db => {
    const insertMsg = db.prepare(
      `INSERT OR IGNORE INTO session_messages(session_id, project, role, ts, content)
       VALUES (?, ?, ?, ?, ?)`
    );
    const upsertSession = db.prepare(
      `INSERT INTO sessions(session_id, project, first_ts, last_ts, message_count)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         project = excluded.project,
         last_ts = excluded.last_ts,
         message_count = sessions.message_count + excluded.message_count`
    );
    let inserted = 0;
    const txn = db.transaction(rows => {
      for (const m of rows) {
        const info = insertMsg.run(sessionId || 'unknown', project || '', m.role, m.ts || '', m.text);
        if (info.changes > 0) inserted += 1;
      }
    });
    txn(messages);
    const first = messages[0].ts || new Date().toISOString();
    const last = messages[messages.length - 1].ts || new Date().toISOString();
    upsertSession.run(sessionId || 'unknown', project || '', first, last, inserted);
    return inserted;
  });

  if (result === null) return { ok: false, reason: 'no-db' };
  return { ok: true, inserted: result, total: messages.length };
}

module.exports = {
  parseTranscriptFile,
  indexTranscript,
  extractContent,
};
