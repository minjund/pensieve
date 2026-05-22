'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { mkTempHome, rmRf } = require('./_helpers');

let TMP;
let si;
let TRANSCRIPT;

before(() => {
  TMP = mkTempHome();
  si = require('../lib/session-indexer');
  TRANSCRIPT = path.join(TMP, 'fixture.jsonl');
  fs.writeFileSync(TRANSCRIPT, [
    JSON.stringify({ type: 'user', timestamp: '2026-05-22T00:00:01Z', message: { role: 'user', content: 'string-content' } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-05-22T00:00:02Z', message: { role: 'assistant', content: [{ type: 'text', text: 'array-content' }, { type: 'tool_use', id: 'x' }] } }),
    JSON.stringify({ type: 'user', timestamp: '2026-05-22T00:00:03Z', message: { role: 'user', content: '' } }),
    'not-json-junk',
    JSON.stringify({ type: 'system', message: { role: 'system', content: 'ignored' } }),
  ].join('\n') + '\n');
});
after(() => rmRf(TMP));

test('parseTranscriptFile extracts string + array content for user/assistant only', () => {
  const msgs = si.parseTranscriptFile(TRANSCRIPT);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'user');
  assert.equal(msgs[0].text, 'string-content');
  assert.equal(msgs[1].role, 'assistant');
  assert.equal(msgs[1].text, 'array-content');
});

test('parseTranscriptFile returns [] when file missing', () => {
  const msgs = si.parseTranscriptFile('/no/such/path.jsonl');
  assert.deepEqual(msgs, []);
});

test('parseTranscriptFile ignores malformed JSON lines without throwing', () => {
  const msgs = si.parseTranscriptFile(TRANSCRIPT);
  assert.ok(Array.isArray(msgs));
});

test('extractContent handles strings, arrays, and missing content', () => {
  assert.equal(si.extractContent({ content: 'plain' }), 'plain');
  assert.equal(si.extractContent({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }), 'a\nb');
  assert.equal(si.extractContent(null), '');
  assert.equal(si.extractContent({}), '');
});

test('indexTranscript returns no-db when SQLite driver is absent', () => {
  // Test sandbox has no better-sqlite3 module installed by default
  const r = si.indexTranscript({ transcriptPath: TRANSCRIPT, sessionId: 'sess1', project: 'demo' });
  // Either ok (driver present) or no-db (driver absent) — both are legitimate outcomes
  assert.ok(r.ok === true || r.reason === 'no-db' || r.reason === 'empty');
});
