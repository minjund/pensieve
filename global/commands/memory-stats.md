---
name: memory-stats
description: Show statistics for stored memory - SQLite row counts, project list, active project, config path.
---

# memory-stats

```powershell
node ~/.claude/hermes-memory/memory-cli.js stats
```

Outputs:

- `db.memCount` — total mirrored memory rows
- `db.sessCount` — indexed sessions
- `db.msgCount` — indexed messages
- `db.byProject` — memory counts per project slug
- `projects` — directories under `~/.claude/projects-memory/`
- `active` — current active project (from `switch-project`)
