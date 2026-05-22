# memory-skills

Manage Claude Code memory skills.

Skill locations:

- `~/.claude/skills/`
- `~/.claude/memory/SKILLS.md`

Procedure:

1. List skill folders under `~/.claude/skills/`.
2. Read `SKILL.md` files only when needed.
3. Summarize available skills with name, trigger, and purpose.
4. If the user asks to add a reusable procedure, create `~/.claude/skills/<slug>/SKILL.md`.
5. Also record a short index entry in `~/.claude/memory/SKILLS.md`.

Use simple Markdown frontmatter:

```md
---
name: example-skill
description: When to use this skill
trigger: /example
---
```
