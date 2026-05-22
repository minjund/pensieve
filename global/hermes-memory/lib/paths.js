'use strict';
const path = require('path');
const os = require('os');

const HOME = process.env.USERPROFILE || process.env.HOME || os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const HERMES_DIR = path.join(CLAUDE_DIR, 'hermes-memory');
const STATE_DIR = path.join(HERMES_DIR, 'state');
const GLOBAL_MEMORY_DIR = path.join(CLAUDE_DIR, 'memory');
const PROJECTS_MEMORY_ROOT = path.join(CLAUDE_DIR, 'projects-memory');
const DB_PATH = path.join(GLOBAL_MEMORY_DIR, 'sessions.db');
const CONFIG_PATH = path.join(CLAUDE_DIR, 'hermes-memory-config.json');
const ACTIVE_PROJECT_PATH = path.join(STATE_DIR, 'active-project.json');

module.exports = {
  HOME,
  CLAUDE_DIR,
  HERMES_DIR,
  STATE_DIR,
  GLOBAL_MEMORY_DIR,
  PROJECTS_MEMORY_ROOT,
  DB_PATH,
  CONFIG_PATH,
  ACTIVE_PROJECT_PATH,
};
