# memory-consolidate

Consolidate Claude Hermes Memory Markdown files.

Files:

- `~/.claude/memory/USER.md`
- `~/.claude/memory/MEMORY.md`
- `~/.claude/memory/FAILURES.md`
- `~/.claude/memory/SKILLS.md`
- `~/.claude/memory/PROJECTS.md`

If tools are available, first run:

```powershell
node ~/.claude/hermes-memory/memory-cli.js consolidate
```

Then review the result.

Procedure:

1. Read all files.
2. Remove exact duplicates.
3. Merge near-duplicate entries.
4. Keep corrections and user preferences unless clearly obsolete.
5. Move project-specific entries to `PROJECTS.md`.
6. Preserve dates when useful.
7. Do not delete uncertain information; mark it as `Needs review`.
8. Before writing, summarize proposed changes.
9. After user approval, edit the files.

Never store or retain secrets.
