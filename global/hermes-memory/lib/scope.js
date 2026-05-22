'use strict';
const fs = require('fs');
const path = require('path');
const {
  GLOBAL_MEMORY_DIR,
  PROJECTS_MEMORY_ROOT,
  ACTIVE_PROJECT_PATH,
  STATE_DIR,
} = require('./paths');
const { loadConfig } = require('./config');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function sanitizeSlug(name) {
  if (!name) return '';
  return String(name)
    .replace(/[\\/]+$/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function projectSlugFromCwd(cwd) {
  if (!cwd) return '';
  return sanitizeSlug(path.basename(String(cwd)));
}

function readActiveProject() {
  try {
    const raw = fs.readFileSync(ACTIVE_PROJECT_PATH, 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj.project === 'string' ? obj.project : '';
  } catch { return ''; }
}

function writeActiveProject(slug) {
  ensureDir(STATE_DIR);
  fs.writeFileSync(ACTIVE_PROJECT_PATH, JSON.stringify({ project: slug || '' }, null, 2));
}

function resolveProjectSlug(cwd, override) {
  if (override) return sanitizeSlug(override);
  const cfg = loadConfig();
  if (cfg.currentProject) return sanitizeSlug(cfg.currentProject);
  const active = readActiveProject();
  if (active) return active;
  return projectSlugFromCwd(cwd);
}

function globalDir() {
  ensureDir(GLOBAL_MEMORY_DIR);
  return GLOBAL_MEMORY_DIR;
}

function projectDir(slug) {
  if (!slug) return '';
  const dir = path.join(PROJECTS_MEMORY_ROOT, slug);
  ensureDir(dir);
  return dir;
}

function targetDirFor(target, slug) {
  const cfg = loadConfig();
  const isGlobalOnly = cfg.globalOnlyTargets.includes(target);
  const isProjectScoped = cfg.projectScopedTargets.includes(target);
  if (isGlobalOnly) return globalDir();
  if (isProjectScoped && slug) return projectDir(slug);
  return globalDir();
}

function listProjectSlugs() {
  try {
    if (!fs.existsSync(PROJECTS_MEMORY_ROOT)) return [];
    return fs.readdirSync(PROJECTS_MEMORY_ROOT)
      .filter(n => {
        try { return fs.statSync(path.join(PROJECTS_MEMORY_ROOT, n)).isDirectory(); }
        catch { return false; }
      });
  } catch { return []; }
}

module.exports = {
  sanitizeSlug,
  projectSlugFromCwd,
  resolveProjectSlug,
  readActiveProject,
  writeActiveProject,
  globalDir,
  projectDir,
  targetDirFor,
  listProjectSlugs,
};
