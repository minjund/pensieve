#!/usr/bin/env node
'use strict';
/**
 * Claude Code Hermes-like memory hook v0.5.
 * Events:
 *   UserPromptSubmit -> classify+save + inject memory context
 *   Stop/SubagentStop/PreCompact -> transcript scan + LLM extractor + session index
 *   PostToolUse -> counter; spawn detached background-review when threshold hit
 */
const fs = require('fs');
const path = require('path');
const { STATE_DIR, HERMES_DIR } = require(path.join(__dirname, '..', 'lib', 'paths'));
const { loadConfig } = require(path.join(__dirname, '..', 'lib', 'config'));
const { resolveProjectSlug } = require(path.join(__dirname, '..', 'lib', 'scope'));
const { classifyAndSave } = require(path.join(__dirname, '..', 'lib', 'classify'));
const { appendEntry, listMemoryFiles, consolidateFileSimilar } = require(path.join(__dirname, '..', 'lib', 'files'));
const { composeContext } = require(path.join(__dirname, '..', 'lib', 'inject'));
const { parseTranscriptFile, indexTranscript } = require(path.join(__dirname, '..', 'lib', 'session-indexer'));
const { callClaude, parseJsonStrict } = require(path.join(__dirname, '..', 'lib', 'llm'));
const noiseDetector = require(path.join(__dirname, '..', 'lib', 'noise-detector'));

function readStdin() { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } }
function parseJson(s) { try { return JSON.parse(s || '{}'); } catch { return {}; } }
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function writeText(p, s) { ensureDir(path.dirname(p)); fs.writeFileSync(p, s, 'utf8'); }

function stateFile(sessionId) { return path.join(STATE_DIR, `${sessionId || 'default'}.json`); }
function loadState(sessionId) { return parseJson(readText(stateFile(sessionId))); }
function saveState(sessionId, data) { writeText(stateFile(sessionId), JSON.stringify(data, null, 2)); }

function emitContext(eventName, text) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext: text }
  }));
}

function memorySaveSummary(saved) {
  if (!saved.length) return '';
  const first = saved.find(s => s && typeof s.content === 'string' && s.content.trim()) || saved[0];
  const raw = (first && first.content ? first.content : '').replace(/\s+/g, ' ').trim();
  const snippet = raw.length > 80 ? raw.slice(0, 77) + '...' : raw;
  const more = saved.length > 1 ? ` (+${saved.length - 1})` : '';
  return `<memory-save-notice>${snippet}${more}</memory-save-notice>`;
}

// SessionStart: inject the heavy "frozen snapshot" once. It persists for the whole
// session (Claude Code re-runs this on --resume), so per-turn injection stays light.
function handleSessionStart(data) {
  const cwd = data.cwd || process.cwd();
  const slug = resolveProjectSlug(cwd);
  const { text: ctx } = composeContext(cwd, { projectSlug: slug });
  emitContext('SessionStart', ctx);
}

function handleUserPrompt(data) {
  const cwd = data.cwd || process.cwd();
  const cfg = loadConfig();
  const slug = resolveProjectSlug(cwd);
  const prompt = data.user_prompt || data.prompt || '';
  const meta = { cwd, projectSlug: slug, source: 'UserPromptSubmit' };

  const saved = classifyAndSave(prompt, meta);
  const saveNotice = memorySaveSummary(saved);
  // Light per-turn (snapshot already carries the heavy memory via SessionStart) +
  // auto-recall keyed on the current prompt.
  const { text: ctx, slug: usedSlug } = composeContext(cwd, {
    projectSlug: slug,
    saveNotice,
    prompt,
    light: cfg.perTurnLight !== false,
  });

  const state = loadState(data.session_id);
  state.promptCount = (state.promptCount || 0) + 1;
  state.turnsSinceReview = (state.turnsSinceReview || 0) + 1;
  state.lastProject = usedSlug;
  saveState(data.session_id, state);

  // Trigger background review if turn threshold hit
  maybeSpawnBackgroundReview(state, data, cwd);

  emitContext('UserPromptSubmit', ctx);
}

function runLlmExtractor(messages, data, slug) {
  const cfg = loadConfig();
  if (!cfg.useLlmExtractor) return [];
  const tail = messages.slice(-30).map(m => `${m.role}: ${m.text}`).join('\n').slice(-12000);
  if (!tail.trim()) return [];
  const targetHint = slug
    ? `Allowed targets: USER.md (global preferences only), MEMORY.md, FAILURES.md, CONVENTIONS.md, SKILLS.md (in project[${slug}])`
    : `Allowed targets: USER.md, MEMORY.md, FAILURES.md, SKILLS.md, PROJECTS.md (all global, no active project)`;
  const prompt = `Extract durable memory candidates from this Claude Code transcript tail. Return ONLY JSON array. No markdown.
Schema: [{"target":"USER.md|MEMORY.md|FAILURES.md|CONVENTIONS.md|SKILLS.md|PROJECTS.md","category":"preference|insight|failure|correction|convention","content":"short durable fact"}]
${targetHint}
Rules: save only stable future-useful info; ignore temporary task state; never include secrets/tokens/keys/passwords; prefer Korean if source is Korean.

Transcript:
${tail}`;
  const out = callClaude(prompt, { timeoutMs: cfg.llmTimeoutMs, requireExtractor: true });
  const arr = parseJsonStrict(out);
  if (!Array.isArray(arr)) return [];
  return arr.filter(x => x && typeof x.content === 'string'
    && /^(USER|MEMORY|FAILURES|CONVENTIONS|SKILLS|PROJECTS)\.md$/.test(x.target));
}

function handleStopLike(data) {
  const cwd = data.cwd || process.cwd();
  const slug = resolveProjectSlug(cwd);
  const cfg = loadConfig();

  let saved = [];
  const messages = parseTranscriptFile(data.transcript_path, { tail: cfg.transcriptTailLines });

  const llmItems = runLlmExtractor(messages, data, slug);
  for (const item of llmItems) {
    const isGlobalOnly = item.target === 'USER.md' || item.target === 'PROJECTS.md';
    const r = appendEntry(item.target, item.content, {
      cwd,
      source: `LLM:${data.hook_event_name || 'Stop'}`,
      category: item.category || '',
      projectSlug: isGlobalOnly ? '' : slug,
    });
    if (r.ok) saved.push({ target: item.target, scope: r.scope });
  }

  for (const m of messages) {
    if (m.role !== 'user') continue;
    const r = classifyAndSave(m.text, {
      cwd,
      projectSlug: slug,
      source: `${data.hook_event_name || 'Stop'}:regex`,
    });
    saved = saved.concat(r);
  }

  let sessionResult = null;
  if (data.hook_event_name !== 'PreCompact') {
    sessionResult = indexTranscript({
      transcriptPath: data.transcript_path,
      sessionId: data.session_id,
      project: slug,
    });
  }

  let cleanupResult = null;
  if (cfg.autoCleanNoise !== false) {
    try { cleanupResult = noiseDetector.cleanAll({ slug, dryRun: false, silent: true }); } catch {}
  }

  let consolidateRemoved = 0;
  if (cfg.autoConsolidate !== false) {
    try {
      const th = typeof cfg.autoConsolidateThreshold === 'number' ? cfg.autoConsolidateThreshold : 0.85;
      for (const f of listMemoryFiles(slug)) {
        const r = consolidateFileSimilar(f.path, th);
        if (r && r.removed) consolidateRemoved += r.removed;
      }
    } catch {}
  }

  const state = loadState(data.session_id);
  state.lastReview = new Date().toISOString();
  state.lastEvent = data.hook_event_name || 'Stop';
  state.lastProject = slug;
  state.savedLastReview = [...new Set(saved.map(s => `${s.scope || 'global'}/${s.target}`))];
  state.lastSessionIndex = sessionResult || null;
  state.lastCleanupRemoved = cleanupResult ? cleanupResult.totalRemoved : 0;
  state.lastConsolidateRemoved = consolidateRemoved;
  state.turnsSinceReview = 0;
  state.toolCallsSinceReview = 0;
  saveState(data.session_id, state);
  process.exit(0);
}

function maybeSpawnBackgroundReview(state, data, cwd) {
  const cfg = loadConfig();
  if (!cfg.backgroundReviewEnabled || !cfg.useLlmExtractor) return;
  if (process.env.CLAUDE_HERMES_CHILD === '1') return;
  if (!data.transcript_path) return;
  const turns = state.turnsSinceReview || 0;
  const tools = state.toolCallsSinceReview || 0;
  if (turns < cfg.nudgeInterval && tools < cfg.nudgeToolCalls) return;
  // Spawn detached
  let spawn;
  try { spawn = require('child_process').spawn; } catch { return; }
  try {
    const script = path.join(HERMES_DIR, 'hooks', 'background-review.js');
    const args = [
      script,
      '--transcript', String(data.transcript_path),
      '--session', String(data.session_id || ''),
      '--cwd', String(cwd || ''),
    ];
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, CLAUDE_HERMES_CHILD: '1' },
    });
    child.unref();
    state.lastBackgroundSpawnAt = new Date().toISOString();
    state.turnsSinceReview = 0;
    state.toolCallsSinceReview = 0;
    saveState(data.session_id, state);
  } catch {}
}

function handlePostToolUse(data) {
  const state = loadState(data.session_id);
  state.toolCallsSinceReview = (state.toolCallsSinceReview || 0) + 1;
  state.totalToolCalls = (state.totalToolCalls || 0) + 1;
  saveState(data.session_id, state);
  maybeSpawnBackgroundReview(state, data, data.cwd || process.cwd());
  process.exit(0);
}

function main() {
  const data = parseJson(readStdin());
  const event = data.hook_event_name || data.hookEventName || process.env.CLAUDE_HOOK_EVENT || '';
  if (event === 'SessionStart') return handleSessionStart(data);
  if (event === 'UserPromptSubmit') return handleUserPrompt(data);
  if (event === 'Stop' || event === 'SubagentStop' || event === 'PreCompact') return handleStopLike(data);
  if (event === 'PostToolUse') return handlePostToolUse(data);
  process.exit(0);
}

try { main(); } catch (e) {
  try {
    ensureDir(STATE_DIR);
    fs.writeFileSync(path.join(STATE_DIR, 'last-error.log'),
      `[${new Date().toISOString()}] ${e && e.stack ? e.stack : String(e)}\n`,
      { flag: 'a' });
  } catch {}
  process.exit(0);
}
