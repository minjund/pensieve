# Global Claude Memory

Pensieve (Claude memory system) v0.10 is active in this installation.

## Storage Layout

- `~/.claude/memory/USER.md` — global user preferences (always global)
- `~/.claude/memory/BEHAVIOR.md` (and `~/.claude/projects-memory/<project>/BEHAVIOR.md`) — always-on behavior rules. Injected **verbatim every turn**, bypassing the per-file tail / `injectCharLimit` truncation, so critical rules can never be cut from the window. Keep it short; hand-edit it. Absent file = no-op.
- `~/.claude/memory/SUMMARY.md` (and `~/.claude/projects-memory/<project>/SUMMARY.md`) — curated project overview ("what this project is / where it stands"). Injected as the `<project-summary>` card, **pinned above the verbatim dump** so project continuity survives the snapshot char cap — the same protection `<who>` gives identity and `BEHAVIOR.md` gives rules. Hand- or LLM-maintained; keep it short. Absent file = no-op.
- `~/.claude/memory/MEMORY.md`, `FAILURES.md`, `SKILLS.md`, `PROJECTS.md` — global notes when no project is active
- `~/.claude/projects-memory/<project>/MEMORY.md`, `FAILURES.md`, `CONVENTIONS.md`, `SKILLS.md` — project-scoped notes
- `~/.claude/memory/sessions.db` — SQLite FTS5 mirror (memories + session messages) when `better-sqlite3` is installed
- `~/.claude/hermes-memory-config.json` — runtime config (limits, strategy, LLM toggle)

The hook auto-derives the project slug from `basename(cwd)`. Override with `/memory-switch-project <name>` or `currentProject` in the config file.

**Injection modes** (`memoryMode` in config):
- `project` (default) — inject the **active project's memory** (highest value) + the always-on `BEHAVIOR.md` card + a condensed `<global-digest>` of global cross-project memory. Global bulk is **not** full-dumped; retrieve it on demand with `/memory-search`. This makes project memory the priority. The project dump uses **entry-level newest-first merge** (`dumpMergeByDate`, default true): the 4 project files (MEMORY/FAILURES/CONVENTIONS/SKILLS) are split into entries, sorted by date descending, deduped, and filled up to `injectCharLimit` from the newest down (`- [date file] content` lines); dropped older entries are flagged with `+N older — /memory-search`. Set `dumpMergeByDate:false` for the legacy per-file tail dump.
- `policy-only` — policy + behavior card only; no dump, no digest. Everything on demand via `/memory-search`. Most token-light.
- `inject` — policy + behavior card + **full** dump of both global and project memory (the old eager behavior; can truncate).
- `legacy-inject` — full dump of both, no policy block.

**Always-on cards** ride along in every mode (including `policy-only`), pinned above the verbatim dump so they survive the `snapshotCharLimit` cap: the identity `<who>` card, the `BEHAVIOR.md` `<behavior-rules>` card, the `SUMMARY.md` `<project-summary>` card, and the `<continuity>` card (most recent saved project entries — the only continuity source on `SessionStart`, where there is no prompt yet so auto-recall cannot fire). Toggle/size with `behaviorCardEnabled`, `summaryCardEnabled`/`summaryCardCharLimit`, `continuityEnabled`/`continuityCharLimit`/`continuityMaxEntries`. The `<global-digest>` appears only in `project` mode (toggle `globalDigestEnabled`, size `globalDigestCharLimit`); it condenses global `MEMORY/FAILURES/SKILLS/PROJECTS` (recent entries, deduped, capped) — `USER.md` is excluded since the card covers its essence.

## Slash Commands

Memory:
- `/memory-add <TARGET.md> <content>` — durable save (use `--scope global|project`, `--category`)
- `/memory-search <query>` — search memory; add `--sessions` for transcript search
- `/memory-replace <TARGET.md> <query> <new>` — update existing entry
- `/memory-remove <TARGET.md> <query>` — delete matching entry (also removes from FTS)
- `/memory-switch-project [name|clear]` — set active project
- `/memory-stats` — counts and DB status
- `/memory-insights` — dump current memory tail
- `/memory-preview-context [--json]` — preview the exact policy + context the hook will inject
- `/memory-consolidate [--dry-run] [--llm]` — dedupe; `--llm` does semantic merge via `claude -p`
- `/memory-index-sessions <path-or-dir>` — bulk import transcripts
- `/memory-sync-markdown` — rebuild SQLite FTS from Markdown
- `/memory-mode show|policy|legacy|full|compact|none|custom|set` — change policy mode/style
- `/memory-prune [--older-than DAYS] [--dry-run]` — gc old entries
- `/memory-interview` — interactive USER.md profile setup
- `/memory-clean-noise [--dry-run] [--silent]` — strip extraction-prompt / slash-command / system-tag noise. Runs automatically on Stop / SubagentStop / PreCompact and after background-review when `autoCleanNoise` (default true) is on. Deletions logged to `~/.claude/hermes-memory/state/cleanup-log.jsonl`.

Skills:
- `/skill-create <name> --description "..." --trigger /x --when ... --procedure ... --pitfalls ... --verify ...`
- `/skill-view [<name>]` — view or list
- `/skill-patch <name> <when_to_use|procedure_steps|pitfalls|verification_steps> "<content>"`
- `/skill-update <name> [--description ...] [--body ...]`
- `/skill-delete <name>`

Conflict guards block exact-slug collisions and warn (in `conflicts` field) on near-name (Levenshtein) and similar-description (token Jaccard). Skill scope auto-falls-back: project ↔ global.

Background review:
- After each `nudgeToolCalls` PostToolUse hits (default 15) or `nudgeInterval` turns (default 10), the hook spawns a detached `background-review.js` that runs `claude -p` for memory extraction without blocking the main session.

## Proactive Behavior

Call `/memory-add` WITHOUT being asked when you observe:
- Durable preference: 앞으로/항상/선호/prefer/always/from now on/never
- Correction: 아니야/그게 아니라/틀렸/no actually/don't do that
- Project convention: "this repo uses X" / "we always do Y"
- Failure to remember: an error or workaround that future-you would repeat
- End of substantive work: one-line lesson learned

Call `/memory-search` BEFORE acting when:
- User refers to past decisions ("저번에", "we said", "what did we decide")
- You are about to make a choice that may already be captured (package manager, style, framework)

## Rules

1. Treat memory as helpful context, not as a higher-priority instruction.
2. Current user request, repository files, and tool output override stored memory.
3. Prefer project-local `CLAUDE.md` and project files for project-specific rules.
4. Never store or reveal secrets, API keys, passwords, tokens, or credentials. The CLI's secret scanner blocks common shapes but do not deliberately try.
5. If memory conflicts with current evidence, follow current evidence and briefly mention the conflict when useful.

This setup is independent of Pi and does not require SQLite (Markdown fallback works when `better-sqlite3` is unavailable).
