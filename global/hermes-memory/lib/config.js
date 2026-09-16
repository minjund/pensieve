'use strict';
const fs = require('fs');
const { CONFIG_PATH } = require('./paths');

const DEFAULTS = {
  memoryCharLimit: 20000,
  injectCharLimit: 8000,
  transcriptTailLines: 80,
  memoryOverflowStrategy: 'fifo-evict',
  correctionDetection: true,
  useLlmExtractor: true,
  llmTimeoutMs: 45000,
  indexSessions: true,
  sessionTailMessagesPerFlush: 200,
  currentProject: null,
  globalOnlyTargets: ['USER.md'],
  projectScopedTargets: ['MEMORY.md', 'FAILURES.md', 'CONVENTIONS.md', 'SKILLS.md'],
  memoryMode: 'project',
  memoryPolicyStyle: 'full',
  customMemoryPolicy: '',
  behaviorCardEnabled: true,
  behaviorCardCharLimit: 2000,
  globalDigestEnabled: true,
  globalDigestCharLimit: 1500,
  identityCardEnabled: true,
  identityCardCharLimit: 1200,
  summaryCardEnabled: true,
  summaryCardCharLimit: 800,
  continuityEnabled: true,
  continuityCharLimit: 500,
  continuityMaxEntries: 2,
  autoRecallEnabled: true,
  autoRecallMaxResults: 6,
  autoRecallCharLimit: 1500,
  perTurnLight: true,
  snapshotCharLimit: 9500,
  // Verbatim dump strategy. true (default): merge entries from all target files
  // and inject newest-first up to injectCharLimit, so the freshest knowledge wins
  // the space instead of each file getting a fixed tail slice. false: legacy
  // per-file tail (tailChars) with a coarse middle-truncation.
  dumpMergeByDate: true,
  nudgeInterval: 10,
  nudgeToolCalls: 15,
  backgroundReviewEnabled: true,
  pruneOlderThanDays: 90,
  skillSimilarityThreshold: 0.7,
  skillNameDistanceThreshold: 2,
  llmConsolidateEnabled: true,
  llmConsolidateMaxEntries: 40,
  autoConsolidateThreshold: 0.72,
  blockPromptInjection: true,
  extendedStoreEnabled: true,
  skillAutoExtract: true,
  autoCleanNoise: true,
  autoConsolidate: true,
};

let cached = null;

function loadConfig() {
  if (cached) return cached;
  let parsed = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {};
    }
  } catch { parsed = {}; }
  cached = { ...DEFAULTS, ...parsed };
  if (process.env.CLAUDE_HERMES_DISABLE_LLM === '1') cached.useLlmExtractor = false;
  return cached;
}

function resetConfig() { cached = null; }

module.exports = { loadConfig, resetConfig, DEFAULTS, CONFIG_PATH };
