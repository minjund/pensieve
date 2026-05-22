---
name: memory-switch-project
description: Switch the active project for memory scoping. Args - "<name>", "clear", or empty to show current.
---

# memory-switch-project

Set the active project slug used by hook-driven saves and CLI defaults. Persisted in `~/.claude/hermes-memory/state/active-project.json`.

```powershell
node ~/.claude/hermes-memory/memory-cli.js switch-project hermes-test
node ~/.claude/hermes-memory/memory-cli.js switch-project clear
node ~/.claude/hermes-memory/memory-cli.js switch-project
```

When unset, the hook derives the slug from `basename(cwd)`. Override the auto-derived slug via the config file (`currentProject`) if you want a stable name regardless of CWD.
