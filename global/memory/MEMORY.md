# Global Memory

Durable cross-project notes.

## Environment

- Windows environment.
- Claude Code global memory package is designed to work without Pi.
- Pi Hermes Memory, when present, stores core memory as Markdown files and may also use SQLite internally.

## Claude Code Memory Strategy

- Use `~/.claude/CLAUDE.md` for global instructions.
- Use `~/.claude/memory/` for global Markdown memory files.
- Use project-local `CLAUDE.md` only for project-specific rules.

## SQLite Note

- This package does not require SQLite.
- SQLite DB files are not suitable for non-developer handoff unless a tool specifically reads them.
- Markdown files are preferred for portability.
