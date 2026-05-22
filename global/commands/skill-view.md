---
name: skill-view
description: View a skill's content or list all skills. Args - optional "<name>". With --scope/--project to scope.
---

# skill-view

```powershell
# List all skills
node ~/.claude/hermes-memory/memory-cli.js skill-view

# View a single skill
node ~/.claude/hermes-memory/memory-cli.js skill-view deploy-canary
```

Lists both global skills (`~/.claude/skills/`) and active-project skills (`~/.claude/projects-memory/<slug>/skills/`).
