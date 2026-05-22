---
name: skill-delete
description: Delete a skill directory entirely. Args - "<name>" with optional --scope/--project.
---

# skill-delete

```powershell
node ~/.claude/hermes-memory/memory-cli.js skill-delete deploy-canary
node ~/.claude/hermes-memory/memory-cli.js skill-delete some-experiment --scope project --project myrepo
```

Removes the directory `~/.claude/skills/<name>/` (or the project-scoped equivalent) recursively. There is no soft delete - re-create the skill if you need it back.
