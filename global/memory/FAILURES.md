# Failure Memory

Things to avoid repeating.

## Handoff Lessons

- Do not hand non-developers raw SQLite DBs, `node_modules`, or Pi extension folders when the goal is Claude usage.
- For Claude Code handoff, provide Markdown memory files and a `CLAUDE.md` instruction file.
- Project-local `CLAUDE.md` affects only that project; use `~/.claude/CLAUDE.md` for global Claude Code behavior.

## Add Future Corrections Here

Use this format:

```md
## YYYY-MM-DD — Short title

- What failed:
- Why it failed:
- What to do instead:
```
