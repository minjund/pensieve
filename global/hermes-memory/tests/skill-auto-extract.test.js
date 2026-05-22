'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { mkTempHome, rmRf } = require('./_helpers');

let TMP;
let skills;

before(() => {
  TMP = mkTempHome();
  skills = require('../lib/skills');
});
after(() => rmRf(TMP));

test('createSkill via auto-extract payload produces a valid SKILL.md', () => {
  const r = skills.createSkill({
    scope: 'project',
    project: 'auto-extract-test',
    name: 'reset-claude-session',
    description: 'Reset a stuck Claude Code session via /clear and config check',
    trigger: '/reset-session',
    sections: {
      when_to_use: 'When the session feels stuck after many tool calls or shows context overflow.',
      procedure_steps: '1. Run /clear\n2. Verify config with /memory-stats\n3. Restart task',
      pitfalls: 'Do not clear if uncommitted work depends on session memory.',
      verification_steps: 'Run a simple command and verify response time < 5s.',
    },
    allowConflicts: false,
  });
  assert.equal(r.ok, true, `expected createSkill ok, got reason=${r.reason}`);
  const content = fs.readFileSync(r.file, 'utf8');
  assert.ok(content.includes('## When to use'));
  assert.ok(content.includes('## Procedure'));
  assert.ok(content.includes('## Pitfalls'));
  assert.ok(content.includes('## Verification'));
  assert.ok(content.includes('reset-claude-session'));
});

test('createSkill rejects on slug collision unless allowConflicts', () => {
  skills.createSkill({
    scope: 'project',
    project: 'collide-test',
    name: 'dup-skill-name',
    description: 'first',
    sections: { when_to_use: 'a', procedure_steps: 'b' },
  });
  const r2 = skills.createSkill({
    scope: 'project',
    project: 'collide-test',
    name: 'dup-skill-name',
    description: 'second attempt',
    sections: { when_to_use: 'c', procedure_steps: 'd' },
  });
  assert.equal(r2.ok, false);
  assert.ok(r2.reason === 'slug-collision' || r2.reason === 'exists', `got ${r2.reason}`);
});

test('background-review payload schema produces parseable JSON object', () => {
  // Simulates the {memories, skills} shape the new prompt requests.
  const sample = JSON.stringify({
    memories: [
      { target: 'MEMORY.md', category: 'insight', content: 'durable test insight from auto-extract' },
    ],
    skills: [
      {
        name: 'extract-checklist',
        description: 'Auto-extract pattern when X repeats',
        trigger: '/extract',
        when_to_use: 'When the user repeats a multi-step task',
        procedure_steps: 'Step 1\nStep 2',
      },
    ],
  });
  const { parseJsonStrict } = require('../lib/llm');
  const parsed = parseJsonStrict(sample);
  assert.ok(parsed && typeof parsed === 'object');
  assert.ok(Array.isArray(parsed.memories));
  assert.ok(Array.isArray(parsed.skills));
  assert.equal(parsed.skills[0].name, 'extract-checklist');
});

test('background-review accepts legacy array shape (back-compat)', () => {
  const legacy = JSON.stringify([
    { target: 'MEMORY.md', category: 'insight', content: 'legacy array shape entry' },
  ]);
  const { parseJsonStrict } = require('../lib/llm');
  const parsed = parseJsonStrict(legacy);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed[0].target, 'MEMORY.md');
});
