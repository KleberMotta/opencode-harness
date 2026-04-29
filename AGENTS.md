# AGENTS.md

This project uses the **Agentic Coding Framework** v2.1 — installed by [juninho](https://github.com/KleberMotta/juninho).
Project type: **node-generic**

## Workflows

**Path A — Spec-driven (formal features):**
```
/j.spec → docs/specs/{slug}/spec.md + CONTEXT.md (approved)
  → /j.plan → docs/specs/{slug}/plan.md (approved)
  → /j.implement → @j.validator gates task work
  → /j.check → /j.unify (if enabled by juninho-config workflow)
```

**Path B — Plan-driven (lightweight tasks):**
```
/j.plan → plan.md (approved) → plan-autoload injects on next session
  → /j.implement → @j.validator gates task work
  → /j.check → /j.unify (if enabled by juninho-config workflow)
```

## Commands

| Command | Purpose |
|---------|---------|
| `/j.spec <feature>` | 5-phase interview → `docs/specs/{slug}/spec.md` + rich `CONTEXT.md` |
| `/j.plan <goal>` | 3-phase pipeline (Metis→Prometheus→Momus) → enrich `CONTEXT.md` + approved `plan.md` |
| `/j.activate-plan <repo|plan>` | Refresh active-plan pointers from an explicit repo or plan path |
| `/j.implement` | Execute active plan until code + task-level tests are green |
| `/j.implement-task [project:]<slug>/task<id>` | Execute one active-plan task in one write target with full state/validator traceability |
| `/j.check` | Run repo-wide verification plus detailed PR-style review |
| `/j.lint` | Run structure lint used by the pre-commit path |
| `/j.test` | Run change-scoped tests used by the pre-commit path |
| `/j.sync-docs` | Refresh AGENTS, domain docs, and principle docs from code |
| `/j.finish-setup` | Bootstrap repo knowledge: AGENTS hierarchy, dynamic skills, domain/principles docs |
| `/j.pr-review` | Advisory review of current branch diff |
| `/j.status` | Show `execution-state.md` summary |
| `/j.unify` | Reconcile, update docs, cleanup integrated worktrees, create PR |
| `/j.start-work <task>` | Initialize a focused work session |
| `/j.handoff` | Prepare end-of-session handoff doc |
| `/j.ulw-loop` | Maximum parallelism mode |

## Agent Roster

### @j.planner
Three-phase pipeline orchestrated internally:
- **Phase 1 (Metis)**: Spawns `@j.explore` + `@j.librarian` in parallel, classifies intent
- **Phase 2 (Prometheus)**: Interviews developer (proportional to complexity), writes `CONTEXT.md` + `plan.md`
- **Phase 3 (Momus)**: Loops with `@j.plan-reviewer` until OKAY

### @j.plan-reviewer
Internal to planner. Executability gate — approval bias, max 3 issues.

### @j.spec-writer
5-phase interview: Discovery → Requirements → Contract → Data → Review.
Writes `docs/specs/{feature-slug}/spec.md` plus rich `CONTEXT.md` with explorer findings, vocabulary, identifier mappings, constraints, decisions, anti-patterns, and key files.

### @j.implementer
READ→ACT→COMMIT→VALIDATE loop. Reads full `CONTEXT.md` alongside spec/plan before source files. Wave-based with git worktrees for parallel tasks.
Pre-commit stays fast: structure lint + related tests. Hashline-aware editing.
Uses the canonical branch `feature/{slug}` for task commits and supports focused single-task execution via `/j.implement-task`.
Writes canonical state to `docs/specs/{slug}/state/**` and records approved task commits in `integration-state.json` during implementation.
Repo-wide checks happen after implementer exits.

### @j.validator
Reads spec and full `CONTEXT.md` BEFORE code. BLOCK / FIX / NOTE / APPROVED.
Can fix FIX-tier issues directly. Writes per-task audit trail to `docs/specs/{slug}/state/tasks/task-{id}/validator-work.md`.

### @j.reviewer
Detailed read-only reviewer. Used via `/j.pr-review` and by `/j.check` to generate actionable follow-up findings.

### @j.checker
Full quality-gate orchestrator. Runs `.opencode/scripts/check-all.sh`, delegates multi-pass review to `@j.reviewer`, persists `check-review.md`, and returns reentry guidance for `@j.implementer`.

### @j.unify
Closes the loop according to `.opencode/juninho-config.json` under `workflow`.
Can update docs, cleanup integrated task worktrees/branches, and create PRs when those steps are enabled.

### @j.explore
Fast read-only codebase research. Spawned by planner Phase 1.
Maps files, patterns, and constraints before the developer interview.

### @j.librarian
External docs and OSS research. Spawned by planner Phase 1.
Fetches official API docs via Context7 MCP and context-mode MCP.

## Context Tiers

| Tier | Mechanism | When |
|------|-----------|------|
| 1 | Hierarchical `AGENTS.md` + `j.directory-agents-injector` | Always — per directory when files are read |
| 2 | `j.carl-inject` — content-aware principles + domain docs | Read time + compaction survival |
| 3 | `j.skill-inject` — file pattern → SKILL.md | Read/Write around matching files |
| 4 | `<skills>` declaration in `plan.md` task | Explicit per-task requirement |
| 5 | Session state in `.opencode/state/` + feature state in `docs/specs/{slug}/state/` | Runtime, inter-session, per-task orchestration |

## Plugins (auto-discovered by OpenCode)

| Plugin | Hook | Purpose |
|--------|------|---------|
| `j.directory-agents-injector` | Read | Inject directory-scoped AGENTS.md files (Tier 1) |
| `j.env-protection` | Any tool | Block sensitive file reads/writes |
| `j.auto-format` | Write/Edit | Auto-format after file changes |
| `j.plan-autoload` | Read + compaction | Inject active plan into context |
| `j.state-paths` | Shared helper | Resolve global session state files |
| `j.feature-state-paths` | Shared helper | Resolve feature-local state files |
| `j.juninho-config` | Shared helper | Load `juninho-config.json` with workflow defaults |
| `j.task-runtime` | Task spawn + session created | Persist task/session runtime metadata |
| `j.task-board` | Tool after + compaction | Append per-task board from feature state |
| `j.notify` | Session idle | Non-blocking local notification on stalls/idleness |
| `j.carl-inject` | Read + compaction | Inject principles + domain docs from file/task context |
| `j.skill-inject` | Read/Write | Inject skill by file pattern |
| `j.intent-gate` | Write/Edit | Warn when edits drift outside the plan |
| `j.todo-enforcer` | Write/Edit + compaction | Re-inject incomplete tasks |
| `j.comment-checker` | Write/Edit | Flag obvious/redundant comments |
| `j.hashline-read` | Read | Tag lines with content hashes |
| `j.hashline-edit` | Edit | Validate hash references before editing |
| `j.memory` | First tool call + compaction | Inject persistent project memory |

## Custom Tools

| Tool | Purpose |
|------|---------|
| `find_pattern` | Curated canonical examples for a given pattern type |
| `next_version` | Next migration/schema version filename |
| `lsp_diagnostics` | Workspace errors and warnings |
| `lsp_goto_definition` | Jump to symbol definition |
| `lsp_find_references` | All usages of a symbol across the codebase |
| `lsp_prepare_rename` | Validate rename safety |
| `lsp_rename` | Rename symbol atomically across workspace |
| `lsp_symbols` | File outline or workspace symbol search |
| `ast_grep_search` | Structural code pattern search |
| `ast_grep_replace` | Structural pattern replacement (with dryRun) |

## Skills (injected automatically by file pattern)

| Skill | Activates on | Notes |
|-------|-------------|-------|
| `j.test-writing` | `*.test.ts`, `*.spec.ts` | Jest/Vitest AAA pattern |
| `j.agents-md-writing` | `**/AGENTS.md` | Directory-local agent guidance |
| `j.domain-doc-writing` | `docs/domain/**/*.md` | Business behavior and sync markers |
| `j.planning-artifact-writing` | `docs/specs/**/{spec,CONTEXT,plan}.md` + workflow prompts | Durable context and ambiguity-free plans |
| `j.principle-doc-writing` | `docs/principles/**` | Cross-cutting technical rules |
| `j.shell-script-writing` | `.opencode/scripts/**/*.sh`, `scripts/**/*.sh`, hooks | Fast, safe automation scripts |

## State Files

| File | Purpose |
|------|---------|
| `.opencode/juninho-config.json` | Models plus `workflow` toggles for automation, implement, unify, artifact commits, and documentation behavior |
| `.opencode/state/active-plan.json` | Session-level pointer to the active spec/plan bundle — consumed by plan-autoload and write-time guards |
| `.opencode/skill-map.json` | Dynamic skill-to-pattern mapping — extended by /j.finish-setup |
| `.opencode/state/persistent-context.md` | Long-term project knowledge — reconciled by UNIFY |
| `.opencode/state/execution-state.md` | Global session summary — active goal, plan path, session log |
| `docs/specs/{slug}/state/implementer-work.md` | Feature-local implementer log (append-only) |
| `docs/specs/{slug}/state/check-review.md` | Latest repo-wide check + detailed review findings for follow-up corrections |
| `docs/specs/{slug}/state/tasks/task-{id}/execution-state.md` | Per-task lease, heartbeat, status, validated commit |
| `docs/specs/{slug}/state/tasks/task-{id}/validator-work.md` | Per-task validator audit trail |
| `docs/specs/{slug}/state/tasks/task-{id}/retry-state.json` | Retry budget and retry bookkeeping |
| `docs/specs/{slug}/state/tasks/task-{id}/runtime.json` | Runtime metadata for watchdog/orchestration |
| `docs/specs/{slug}/state/sessions/{sessionID}-runtime.json` | Session runtime ownership metadata |
| `docs/specs/{slug}/state/integration-state.json` | Canonical feature integration manifest |

## Conventions

- Specs: `docs/specs/{feature-slug}/spec.md` + `CONTEXT.md` + `plan.md` + `state/**`
- Domain docs: `docs/domain/{domain}/*.md` — indexed in `docs/domain/INDEX.md`
- Principles: `docs/principles/{topic}.md` — registered in `docs/principles/manifest`
- Sync markers: `<!-- juninho:sync source=... hash=... -->` to track doc↔code alignment
- Implementation history: exactly one implementation commit per task on `feature/{slug}`; optional feature-state artifact commits happen only in `/j.unify` when enabled.
- Hierarchical `AGENTS.md`: root + `src/` + `src/{module}/` — generated by `/j.finish-setup`
