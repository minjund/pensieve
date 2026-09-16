'use strict';
const fs = require('fs');
const path = require('path');

const home = process.env.USERPROFILE || process.env.HOME;
const settingsPath = path.join(home, '.claude', 'settings.json');
const hooksDir = path.join(home, '.claude', 'hermes-memory', 'hooks');

const HOOKS = [
  { event: 'SessionStart',     file: 'memory-hook.js', timeout: 10 },
  { event: 'UserPromptSubmit', file: 'memory-hook.js', timeout: 10 },
  { event: 'Stop',             file: 'memory-hook.js', timeout: 60 },
  { event: 'SubagentStop',     file: 'memory-hook.js', timeout: 60 },
  { event: 'PreCompact',       file: 'memory-hook.js', timeout: 10 },
  { event: 'PostToolUse',      file: 'memory-hook.js', timeout: 5  },
];

function ensureSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }
  catch { return {}; }
}

function cmdFor(file) {
  const p = path.join(hooksDir, file).replace(/\\/g, '/');
  return `node "${p}"`;
}

function addHook(settings, event, matcher, command, timeout) {
  settings.hooks ||= {};
  settings.hooks[event] ||= [];
  let group = settings.hooks[event].find(g => (g.matcher || '') === matcher);
  if (!group) {
    group = { matcher, hooks: [] };
    settings.hooks[event].push(group);
  }
  if (!group.hooks.some(h => h.type === 'command' && h.command === command)) {
    group.hooks.push({ type: 'command', command, timeout });
  }
}

function purgeLegacyMemoryHook(settings) {
  // Remove obsolete split-hook references (user-prompt.js, stop.js, pre-compact.js, post-tool.js
  // under hermes-memory/hooks/). These were registered by 0.7.x and earlier but the actual
  // hooks/ directory only ships the unified memory-hook.js, causing MODULE_NOT_FOUND at runtime.
  if (!settings.hooks) return;
  const stalePatterns = [
    /hermes-memory[\\/]hooks[\\/]user-prompt\.js/i,
    /hermes-memory[\\/]hooks[\\/]stop\.js/i,
    /hermes-memory[\\/]hooks[\\/]pre-compact\.js/i,
    /hermes-memory[\\/]hooks[\\/]post-tool\.js/i,
  ];
  for (const ev of Object.keys(settings.hooks)) {
    settings.hooks[ev] = (settings.hooks[ev] || [])
      .map(g => ({
        ...g,
        hooks: (g.hooks || []).filter(h => !stalePatterns.some(re => re.test(h.command || '')))
      }))
      .filter(g => (g.hooks || []).length > 0);
    if (settings.hooks[ev].length === 0) delete settings.hooks[ev];
  }
}

function main() {
  const settings = ensureSettings();
  purgeLegacyMemoryHook(settings);
  for (const h of HOOKS) {
    addHook(settings, h.event, '', cmdFor(h.file), h.timeout);
  }
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  console.log('hooks registered in', settingsPath);
}

main();
