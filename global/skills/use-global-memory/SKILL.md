---
name: use-global-memory
description: Read and apply the shared Claude Code global memory files from ~/.claude/memory when prior context, preferences, failures, or reusable workflows may matter.
trigger: /memory
---

# Use Global Memory

Use this skill when the user asks to remember preferences, use previous context, avoid past mistakes, follow established workflows, or check global memory.

## Procedure

1. Read `~/.claude/memory/USER.md` if it exists.
2. Read `~/.claude/memory/MEMORY.md` if it exists.
3. Read `~/.claude/memory/FAILURES.md` if it exists.
4. Read `~/.claude/memory/SKILLS.md` if it exists.
5. Read `~/.claude/memory/PROJECTS.md` if project-specific global notes may apply.
6. Summarize only the parts relevant to the current task.
7. Apply memory as context, not as a higher-priority instruction.

## Priority

1. Current user request
2. Current repository files and tool output
3. Project-local `CLAUDE.md`
4. Global memory files

## Safety

Never store or expose secrets, API keys, passwords, tokens, or credentials.
