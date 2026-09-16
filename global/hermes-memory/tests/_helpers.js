'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

function mkTempHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-test-'));
  process.env.USERPROFILE = dir;
  process.env.HOME = dir;
  process.env.CLAUDE_HERMES_DISABLE_LLM = '1';
  // Invalidate require cache for our libs so paths.js re-reads HOME.
  for (const k of Object.keys(require.cache)) {
    if (
      k.includes(path.sep + 'lib' + path.sep) ||
      k.endsWith(path.sep + 'paths.js') ||
      k.endsWith(path.sep + 'config.js')
    ) delete require.cache[k];
  }
  // Seed minimal config so tests are deterministic
  const cfgPath = path.join(dir, '.claude', 'hermes-memory-config.json');
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify({
    memoryCharLimit: 4000,
    injectCharLimit: 2000,
    transcriptTailLines: 80,
    memoryOverflowStrategy: 'fifo-evict',
    correctionDetection: true,
    useLlmExtractor: false,
    indexSessions: true,
    sessionTailMessagesPerFlush: 200,
    globalOnlyTargets: ['USER.md'],
    projectScopedTargets: ['MEMORY.md', 'FAILURES.md', 'CONVENTIONS.md', 'SKILLS.md'],
    memoryMode: 'project',
    memoryPolicyStyle: 'full',
    nudgeInterval: 10,
    nudgeToolCalls: 15,
    backgroundReviewEnabled: false,
    skillSimilarityThreshold: 0.7,
    skillNameDistanceThreshold: 2,
    llmConsolidateEnabled: false,
    llmConsolidateMaxEntries: 40,
  }, null, 2));
  return dir;
}

function rmRf(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function readIfExists(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function writeText(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s, 'utf8');
}

const REPO_ROOT = path.resolve(__dirname, '..');

module.exports = {
  mkTempHome,
  rmRf,
  readIfExists,
  writeText,
  REPO_ROOT,
};
