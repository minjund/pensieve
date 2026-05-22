---
name: memory-index-sessions
description: Bulk-import past Claude Code session transcripts into the searchable SQLite index. Args - "<transcript-path-or-dir> [--project NAME]".
---

# memory-index-sessions

Index Claude Code transcript JSONL files into `~/.claude/memory/sessions.db` so they become searchable via `/memory-search --sessions`.

```powershell
# Single transcript
node ~/.claude/hermes-memory/memory-cli.js index-sessions C:\path\to\session.jsonl

# Whole directory
node ~/.claude/hermes-memory/memory-cli.js index-sessions C:\Users\me\.claude\projects\my-repo --project my-repo
```

Requires `better-sqlite3` to be installed. The package's optional dependency installs this automatically during `install-windows.ps1`. If it failed to build, sessions are not indexed but Markdown memory still works.
