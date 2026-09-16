'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('path');
const fs = require('fs');
const { mkTempHome, rmRf, REPO_ROOT } = require('./_helpers');

let TMP;
const CLI = path.join(REPO_ROOT, 'memory-cli.js');
const HOOK = path.join(REPO_ROOT, 'hooks', 'memory-hook.js');

before(() => {
  TMP = mkTempHome();
  // Make claude binary appear absent so background-review path is exercised in disabled state
  process.env.CLAUDE_HERMES_DISABLE_LLM = '1';
});
after(() => rmRf(TMP));

function cli(...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, USERPROFILE: TMP, HOME: TMP, CLAUDE_HERMES_DISABLE_LLM: '1' },
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function hookEvent(payload) {
  const r = spawnSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    input: JSON.stringify(payload),
    env: { ...process.env, USERPROFILE: TMP, HOME: TMP, CLAUDE_HERMES_DISABLE_LLM: '1' },
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

test('CLI: switch-project then add routes to project tier', () => {
  const a = cli('switch-project', 'integ-proj');
  assert.equal(a.code, 0);
  const b = cli('add', 'MEMORY.md', 'integration-test-fact');
  assert.equal(b.code, 0);
  const file = path.join(TMP, '.claude', 'projects-memory', 'integ-proj', 'MEMORY.md');
  assert.ok(fs.existsSync(file));
  assert.match(fs.readFileSync(file, 'utf8'), /integration-test-fact/);
});

test('CLI: USER.md add always lands in global tier even with active project', () => {
  const r = cli('add', 'USER.md', 'integration-pref-line');
  assert.equal(r.code, 0);
  const userFile = path.join(TMP, '.claude', 'memory', 'USER.md');
  assert.match(fs.readFileSync(userFile, 'utf8'), /integration-pref-line/);
});

test('CLI: search returns mirrored entry when DB available, falls back to markdown otherwise', () => {
  const r = cli('search', 'integration-test-fact');
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.ok(Array.isArray(out.memories));
  assert.ok(out.memories.length >= 1);
});

test('CLI: remove deletes Markdown entry and (when DB present) DB row', () => {
  cli('add', 'FAILURES.md', 'integration-removable-entry');
  const r = cli('remove', 'FAILURES.md', 'integration-removable-entry');
  assert.equal(r.code, 0);
  const after = cli('search', 'integration-removable-entry');
  const out = JSON.parse(after.stdout);
  assert.equal(out.memories.length, 0);
});

test('CLI: secrets are blocked', () => {
  const r = cli('add', 'MEMORY.md', 'config password=correct-horse-battery-staple');
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /secret-blocked/);
});

test('CLI: skill-create + skill-view + skill-delete roundtrip', () => {
  const c = cli('skill-create', 'integ-skill', '--description', 'integration test skill', '--scope', 'global');
  assert.equal(c.code, 0);
  const v = cli('skill-view', 'integ-skill', '--scope', 'global');
  assert.equal(v.code, 0);
  const view = JSON.parse(v.stdout);
  assert.equal(view.frontmatter.name, 'integ-skill');
  const d = cli('skill-delete', 'integ-skill', '--scope', 'global');
  assert.equal(d.code, 0);
});

test('CLI: mode set persists nudgeToolCalls to config', () => {
  const r = cli('mode', 'set', '--nudgeToolCalls', '7');
  assert.equal(r.code, 0);
  const cfg = JSON.parse(fs.readFileSync(path.join(TMP, '.claude', 'hermes-memory-config.json'), 'utf8'));
  assert.equal(cfg.nudgeToolCalls, 7);
});

test('Hook: UserPromptSubmit is LIGHT — policy + behavior, no heavy dump (snapshot carries it)', () => {
  const r = hookEvent({
    hook_event_name: 'UserPromptSubmit',
    session_id: 'integ-sess',
    cwd: TMP,
    user_prompt: '앞으로 yarn 말고 pnpm 써. 기억해줘.',
  });
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.ok(out.hookSpecificOutput);
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(out.hookSpecificOutput.additionalContext, /<memory-policy>/);
  assert.match(out.hookSpecificOutput.additionalContext, /<recall-behavior>/);
  // perTurnLight default: the verbatim memory dump is NOT re-injected every turn.
  assert.doesNotMatch(out.hookSpecificOutput.additionalContext, /<memory-context>/);
});

test('Hook: SessionStart emits the heavy snapshot with project memory', () => {
  const r = hookEvent({
    hook_event_name: 'SessionStart',
    session_id: 'integ-sess',
    cwd: TMP,
    source: 'startup',
  });
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.ok(out.hookSpecificOutput);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /<memory-policy>/);
  assert.match(out.hookSpecificOutput.additionalContext, /<recall-behavior>/);
  // The snapshot carries the active project's memory verbatim.
  assert.match(out.hookSpecificOutput.additionalContext, /<memory-context>/);
});

test('Hook: Stop processes transcript, classifies user message, saves to MEMORY.md', () => {
  const transcript = path.join(TMP, 'stop-fixture.jsonl');
  fs.writeFileSync(transcript, [
    JSON.stringify({ type: 'user', timestamp: '2026-05-22T00:00:01Z', message: { role: 'user', content: '이거 기억해: 이 레포는 jest 사용한다.' } }),
  ].join('\n') + '\n');
  const r = hookEvent({
    hook_event_name: 'Stop',
    session_id: 'integ-sess-stop',
    cwd: TMP,
    transcript_path: transcript,
  });
  assert.equal(r.code, 0);
  const memFile = path.join(TMP, '.claude', 'projects-memory', 'integ-proj', 'MEMORY.md');
  if (fs.existsSync(memFile)) {
    assert.match(fs.readFileSync(memFile, 'utf8'), /jest/);
  } else {
    // active project may have been cleared; check both spots
    const userFile = path.join(TMP, '.claude', 'memory', 'MEMORY.md');
    assert.match(fs.readFileSync(userFile, 'utf8'), /jest/);
  }
});

test('Hook: PostToolUse increments counter without spawning when LLM disabled', () => {
  // Reset state then hit PostToolUse 3 times
  const stateFile = path.join(TMP, '.claude', 'hermes-memory', 'state', 'integ-posttool.json');
  try { fs.unlinkSync(stateFile); } catch {}
  for (let i = 0; i < 3; i++) {
    hookEvent({ hook_event_name: 'PostToolUse', session_id: 'integ-posttool', cwd: TMP });
  }
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(state.toolCallsSinceReview, 3);
  assert.equal(state.totalToolCalls, 3);
});

test('CLI: stats returns shape with db + projects + config path', () => {
  const r = cli('stats');
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.ok('db' in out);
  assert.ok('projects' in out);
  assert.ok('config' in out);
});

test('CLI: preview-context emits memory-policy + project memory in project default mode', () => {
  const r = cli('preview-context');
  assert.equal(r.code, 0);
  assert.match(r.stdout, /<memory-policy>/);
  // project default → active project's memory is dumped in the preview
  assert.match(r.stdout, /<memory-context>/);
});

test('CLI: preview-context --json returns structured object', () => {
  const r = cli('preview-context', '--json');
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.ok(typeof out.length === 'number');
  assert.ok(out.additionalContext.includes('<memory-policy>'));
});
