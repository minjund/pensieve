'use strict';
const { loadConfig } = require('./config');

function callClaude(prompt, opts = {}) {
  if (process.env.CLAUDE_HERMES_CHILD === '1') return null;
  const cfg = loadConfig();
  if (opts.requireExtractor && !cfg.useLlmExtractor) return null;
  let spawnSync;
  try { spawnSync = require('child_process').spawnSync; } catch { return null; }
  try {
    const r = spawnSync('claude', ['-p', prompt], {
      encoding: 'utf8',
      timeout: opts.timeoutMs || cfg.llmTimeoutMs,
      env: { ...process.env, CLAUDE_HERMES_CHILD: '1', CLAUDE_HERMES_DISABLE_LLM: '1' },
      windowsHide: true,
    });
    if (r.error || r.status !== 0) return null;
    return r.stdout || '';
  } catch { return null; }
}

function parseJsonStrict(text) {
  if (!text) return null;
  const cleaned = String(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

module.exports = { callClaude, parseJsonStrict };
