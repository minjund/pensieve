---
name: memory-sync-markdown
description: Rebuild the SQLite FTS memory index from the Markdown files. Useful after manual edits or removals.
---

# memory-sync-markdown

```powershell
node ~/.claude/hermes-memory/memory-cli.js sync-markdown
node ~/.claude/hermes-memory/memory-cli.js sync-markdown --project myrepo
```

For each memory file in scope, this command:

1. Deletes all DB rows matching that `(target, scope, project)` triple.
2. Re-inserts one row per Markdown entry (text extracted from the `- ...` bullet line).

Use after manual `.md` edits, after `/memory-prune`, or when the FTS index drifts from the source Markdown.
