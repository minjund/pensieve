#!/usr/bin/env node
'use strict';
/**
 * Detached background review.
 * Invoked by PostToolUse hook when nudge thresholds are hit.
 * Reads transcript, calls Claude CLI for extraction, appends entries via appendEntry.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { STATE_DIR } = require(path.join(ROOT, 'lib', 'paths'));
const { loadConfig } = require(path.join(ROOT, 'lib', 'config'));
const { resolveProjectSlug } = require(path.join(ROOT, 'lib', 'scope'));
const { appendEntry } = require(path.join(ROOT, 'lib', 'files'));
const { parseTranscriptFile } = require(path.join(ROOT, 'lib', 'session-indexer'));
const { callClaude, parseJsonStrict } = require(path.join(ROOT, 'lib', 'llm'));

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : '';
}

function logState(sessionId, payload) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const p = path.join(STATE_DIR, `${sessionId || 'default'}.bg.json`);
    fs.writeFileSync(p, JSON.stringify(payload, null, 2));
  } catch {}
}

function main() {
  const transcript = arg('transcript');
  const sessionId = arg('session') || 'default';
  const cwd = arg('cwd') || process.cwd();
  const cfg = loadConfig();
  if (!cfg.backgroundReviewEnabled || !cfg.useLlmExtractor) {
    logState(sessionId, { ok: false, reason: 'disabled', at: new Date().toISOString() });
    return;
  }
  const slug = resolveProjectSlug(cwd);
  const messages = parseTranscriptFile(transcript, { tail: cfg.transcriptTailLines });
  if (!messages.length) {
    logState(sessionId, { ok: false, reason: 'empty-transcript', at: new Date().toISOString() });
    return;
  }
  const tail = messages.slice(-30).map(m => `${m.role}: ${m.text}`).join('\n').slice(-12000);
  const targetHint = slug
    ? `Allowed targets: USER.md (global preferences only), MEMORY.md, FAILURES.md, CONVENTIONS.md, SKILLS.md (project[${slug}])`
    : `Allowed targets: USER.md, MEMORY.md, FAILURES.md, SKILLS.md, PROJECTS.md (all global)`;
  const prompt = `Background memory review. Extract DURABLE memory candidates from this Claude Code transcript tail. Return ONLY JSON array. No markdown.
Schema: [{"target":"USER.md|MEMORY.md|FAILURES.md|CONVENTIONS.md|SKILLS.md|PROJECTS.md","category":"preference|insight|failure|correction|convention","content":"short durable fact"}]
${targetHint}
Rules: save only stable future-useful info; ignore temporary task state; never include secrets/tokens/keys/passwords; prefer Korean if source is Korean.

Transcript:
${tail}`;
  const out = callClaude(prompt, { timeoutMs: cfg.llmTimeoutMs });
  const arr = parseJsonStrict(out);
  if (!Array.isArray(arr)) {
    logState(sessionId, { ok: false, reason: 'no-json', at: new Date().toISOString() });
    return;
  }
  const saved = [];
  for (const item of arr) {
    if (!item || typeof item.content !== 'string') continue;
    if (!/^(USER|MEMORY|FAILURES|CONVENTIONS|SKILLS|PROJECTS)\.md$/.test(item.target)) continue;
    const isGlobalOnly = item.target === 'USER.md' || item.target === 'PROJECTS.md';
    const r = appendEntry(item.target, item.content, {
      cwd,
      source: 'LLM:background',
      category: item.category || '',
      projectSlug: isGlobalOnly ? '' : slug,
    });
    if (r.ok) saved.push({ target: item.target, scope: r.scope });
  }
  logState(sessionId, { ok: true, saved, count: saved.length, at: new Date().toISOString() });
}

try { main(); } catch (e) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(path.join(STATE_DIR, 'background-error.log'),
      `[${new Date().toISOString()}] ${e && e.stack ? e.stack : String(e)}\n`, { flag: 'a' });
  } catch {}
}
