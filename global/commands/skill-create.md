---
name: skill-create
description: Create a reusable skill (procedure) with name, description, and structured sections. Args - "<name>" plus --description, --trigger, --when, --procedure, --pitfalls, --verify.
---

# skill-create

Save a new skill under `~/.claude/skills/<slug>/SKILL.md` (global) or `~/.claude/projects-memory/<project>/skills/<slug>/SKILL.md` (project).

```powershell
node ~/.claude/hermes-memory/memory-cli.js skill-create deploy-canary `
  --description "Run a 5% canary then promote" `
  --trigger /deploy-canary `
  --when "When shipping a high-risk change behind a feature flag" `
  --procedure "1. Build  2. Push to canary  3. Watch dashboards 10 min  4. Promote" `
  --pitfalls "Forgetting to flip feature flag before promotion" `
  --verify "Latency p99 stable, no new error budget burn"
```

Conflict guards (block by default, override with `--allow-conflicts`):

- exact slug collision
- near-name (Levenshtein distance &lt;= threshold)
- similar description (token Jaccard above threshold)

Use `--scope global` to force a global skill even when a project is active.
