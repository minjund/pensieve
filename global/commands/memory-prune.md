---
name: memory-prune
description: Prune memory entries older than N days. Args - optional --older-than DAYS (default 90), --dry-run, --project NAME.
---

# memory-prune

```powershell
# Preview what would be pruned (default 90 days)
node ~/.claude/hermes-memory/memory-cli.js prune --dry-run

# Actually prune entries older than 30 days for the active project
node ~/.claude/hermes-memory/memory-cli.js prune --older-than 30

# Just the global tier
node ~/.claude/hermes-memory/memory-cli.js prune --older-than 180 --project ""
```

Entries are identified by the `## YYYY-MM-DD` line in each `§`-delimited block. After pruning, run `/memory-sync-markdown` to refresh the SQLite FTS index.
