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
const { createSkill } = require(path.join(ROOT, 'lib', 'skills'));
const noiseDetector = require(path.join(ROOT, 'lib', 'noise-detector'));

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
  const skillExtraction = cfg.skillAutoExtract !== false
    ? `
Also, if the transcript shows a COMPLETED multi-step problem-solving procedure that is reusable (not a one-off bug fix), include up to 2 skill candidates under "skills".
Each skill MUST have: name (kebab-case, 2-40 chars), description (one line), trigger (slash command like /foo or trigger phrase), when_to_use, procedure_steps, pitfalls (optional), verification_steps (optional).
DO NOT propose skills for trivial single-step tasks. DO NOT duplicate existing skill names you saw in the transcript.

Return shape: {"memories":[...], "skills":[{"name":"...","description":"...","trigger":"...","when_to_use":"...","procedure_steps":"...","pitfalls":"...","verification_steps":"..."}]}`
    : '\nReturn shape: {"memories":[...]} (skills extraction disabled)';
  const prompt = `Background memory review. Extract DURABLE memory candidates from this Claude Code transcript tail. Return ONLY JSON. No markdown fences.
Memory schema: [{"target":"USER.md|MEMORY.md|FAILURES.md|CONVENTIONS.md|SKILLS.md|PROJECTS.md","category":"preference|insight|failure|correction|convention","content":"short durable fact"}]
${targetHint}
Rules: save only stable future-useful info; ignore temporary task state; never include secrets/tokens/keys/passwords; prefer Korean if source is Korean.
${skillExtraction}

Transcript:
${tail}`;
  const out = callClaude(prompt, { timeoutMs: cfg.llmTimeoutMs });
  const parsed = parseJsonStrict(out);
  // Back-compat: accept either array (old shape) or {memories, skills} object.
  let memoriesArr = null;
  let skillsArr = [];
  if (Array.isArray(parsed)) {
    memoriesArr = parsed;
  } else if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.memories)) memoriesArr = parsed.memories;
    if (Array.isArray(parsed.skills)) skillsArr = parsed.skills;
  }
  if (!Array.isArray(memoriesArr)) {
    logState(sessionId, { ok: false, reason: 'no-json', at: new Date().toISOString() });
    return;
  }
  const saved = [];
  for (const item of memoriesArr) {
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
  const skillsCreated = [];
  if (cfg.skillAutoExtract !== false && Array.isArray(skillsArr)) {
    for (const sk of skillsArr.slice(0, 2)) {
      if (!sk || typeof sk.name !== 'string' || typeof sk.description !== 'string') continue;
      if (!sk.when_to_use || !sk.procedure_steps) continue;
      const scopeChoice = slug ? 'project' : 'global';
      const r = createSkill({
        scope: scopeChoice,
        project: scopeChoice === 'project' ? slug : '',
        name: sk.name,
        description: sk.description,
        trigger: sk.trigger || '',
        sections: {
          when_to_use: sk.when_to_use,
          procedure_steps: sk.procedure_steps,
          pitfalls: sk.pitfalls || '',
          verification_steps: sk.verification_steps || '',
        },
        allowConflicts: false,
      });
      skillsCreated.push({ name: sk.name, ok: r.ok, reason: r.reason || null, scope: scopeChoice });
    }
  }
  let cleaned = 0;
  if (cfg.autoCleanNoise !== false) {
    try {
      const r = noiseDetector.cleanAll({ slug, dryRun: false, silent: true });
      cleaned = r.totalRemoved || 0;
    } catch {}
  }
  logState(sessionId, { ok: true, saved, count: saved.length, skills: skillsCreated, cleaned, at: new Date().toISOString() });
}

try { main(); } catch (e) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(path.join(STATE_DIR, 'background-error.log'),
      `[${new Date().toISOString()}] ${e && e.stack ? e.stack : String(e)}\n`, { flag: 'a' });
  } catch {}
}
