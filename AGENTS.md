# AGENTS.md

This project uses the **Agentic Coding Framework** v2.1 — installed by [juninho](https://github.com/KleberMotta/juninho).

## Workflows

**Path A — Spec-driven (formal features):**
```
/j.spec → docs/specs/{slug}/spec.md + CONTEXT.md (approved)
  → /j.plan → docs/specs/{slug}/plan.md (approved)
  → /j.implement → plan-defined @j.validator tasks gate quality
  → /j.check → /j.unify (if enabled by juninho-config workflow)
```

**Path B — Plan-driven (lightweight tasks):**
```
/j.plan → plan.md (approved) → plan-autoload injects on next session
  → /j.implement → plan-defined @j.validator tasks gate quality
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
| `/j.unify` | Reconcile, update docs, cleanup integrated task bookkeeping, create PR |
| `npm run graphify:build` | Build optional Graphify output for a target repo (`--force` for manual smoke) |
| `npm run graphify:refresh` | Run incremental Graphify refresh when explicitly enabled |
| `npm run graphify:status` | Inspect Graphify enabled/output/cache status without building |
| `/j.start-work <task>` | Initialize a focused work session |
| `/j.handoff` | Prepare end-of-session handoff doc |
| `/j.ulw-loop` | Maximum parallelism mode |

## Optional Graphify

- `/j.finish-setup` Phase 7 bootstraps Graphify only when `workflow.graphify.enabled` is true.
- Enabled flow runs `npm run graphify:build -- --repo "$PROJECT_ROOT"` and writes outputs to `$PROJECT_ROOT/docs/domain/graphify/{graph.html,graph.json,GRAPH_REPORT.md,cache/}`.
- Disabled flow records an intentional skip; no watch mode, git hook, or pre-commit automation is allowed.
- Graphify integrates via CLI (`graphify query`, `graphify path`, `graphify explain`) and the official opencode skill/plugin — not as an MCP server. The legacy `mcp.graphify` entry in `opencode.json` is disabled.
- `/j.unify` may run `npm run graphify:refresh -- --repo "$REPO_ROOT" --incremental` before the doc-sync commit only when both `workflow.unify.refreshGraphify` and `workflow.graphify.enabled` are true.
- Any refreshed `docs/domain/graphify/**` files must land in the same gated doc-sync commit; Graphify refresh never creates its own commit.

## Agent Roster

### @j.planner
Three-phase pipeline orchestrated internally:
- **Phase 1 (Metis)**: Spawns `@j.explore` + `@j.librarian` in parallel, classifies intent
- **Phase 2 (Prometheus)**: Interviews developer (proportional to complexity), writes `CONTEXT.md` + `plan.md`
- **Phase 3 (Momus)**: Loops with `@j.plan-reviewer` until OKAY
- Optional Graphify layer: reads `docs/domain/graphify/GRAPH_REPORT.md` when present, cites at least one relevant god node in Phase 1, and falls back to normal research when Graphify is disabled, stale, or missing.

### @j.plan-reviewer
Internal to planner. Executability gate — approval bias, max 3 issues.

### @j.spec-writer
5-phase interview: Discovery → Requirements → Contract → Data → Review.
Writes `docs/specs/{feature-slug}/spec.md` plus rich `CONTEXT.md` with explorer findings, vocabulary, identifier mappings, constraints, decisions, anti-patterns, and key files.

### @j.implementer
READ→ACT→STATE→COMMIT loop. Reads full `CONTEXT.md` alongside spec/plan before source files. Wave-based with task-scoped subagents on a shared feature branch.
Pre-commit stays fast: structure lint + related tests. Hashline-aware editing.
Uses the canonical branch `feature/{slug}` for task commits and supports focused single-task execution via `/j.implement-task`.
When `workflow.implement.singleTaskMode` is `true`, executes one task per invocation and returns to the developer for review before proceeding.
Writes canonical state to `docs/specs/{slug}/state/**` and records approved task commits in `integration-state.json` during implementation.
Amend-on-resume: if a commit for the current task already exists (interrupted attempt), uses `--amend` to maintain exactly one commit per task.
Does NOT auto-invoke `j.validator` — validation is handled by explicit validator tasks in the plan.
Repo-wide checks happen after implementer exits.
- Optional Graphify layer: may consult `GRAPH_REPORT.md` or `graphify path` CLI for task-scoped read-time coupling hints, but never widens scope based on Graphify alone.

### @j.validator
Reads spec and full `CONTEXT.md` BEFORE code. BLOCK / FIX / NOTE / APPROVED.
Can fix FIX-tier issues directly. Writes per-task audit trail to `docs/specs/{slug}/state/tasks/task-{id}/validator-work.md`.

### @j.reviewer
Detailed read-only reviewer. Used via `/j.pr-review` and by `/j.check` to generate actionable follow-up findings.
- Optional Graphify layer: Pass 2 may use `GRAPH_REPORT.md` plus `graphify explain` CLI for cross-domain edge review; missing Graphify is a NOTE, not a defect.

### @j.checker
Full quality-gate orchestrator. Runs `.opencode/scripts/check-all.sh`, delegates multi-pass review to `@j.reviewer`, persists `check-review.md`, and returns reentry guidance for `@j.implementer`.
- Optional Graphify layer: passes `GRAPH_REPORT.md` summary to `@j.reviewer` when available and never persists raw `graph.json`.

### @j.unify
Closes the loop according to `juninho-config.json` under `workflow`.
Can update docs, create one gated doc-sync commit, cleanup integrated task bookkeeping, and create PRs when those steps are enabled.

### @j.explore
Fast read-only codebase research. Spawned by planner Phase 1.
Maps files, patterns, and constraints before the developer interview.
- Optional Graphify layer: consults `GRAPH_REPORT.md` and `graphify query` CLI before broad grep for god nodes/coupling hotspots, then confirms with normal code search.

### @j.librarian
External docs and OSS research. Spawned by planner Phase 1.
Fetches official API docs via Context7 MCP and context-mode MCP.
- Optional Graphify layer: during `/j.unify` refresh, summarizes `GRAPH_REPORT.md` diffs before doing new web research.

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

Optional Graphify plugin layer (when present in this repo's `.opencode/plugins/`):
- `j.graphify-inject` should inject only a short `GRAPH_REPORT.md` summary, never `graph.json`
- `j.graphify-stale-warn` should emit non-blocking freshness/cache warnings only

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
| `getGraphifyPath` | Shared helper resolving target-local `docs/domain/graphify` output paths |

Optional Graphify CLI layer (requires `graphify` installed via `uv tool install graphifyy`):
- `graphify query "<question>" --graph <path>` for god nodes, hotspots, and dependency-heavy areas
- `graphify path "A" "B" --graph <path>` for scoped path tracing between known files/symbols
- `graphify explain "X" --graph <path>` for cross-domain edge inspection
- Always prefer `docs/domain/graphify/GRAPH_REPORT.md` over raw `graph.json` in agent prompts and reports
- If Graphify is disabled, stale, or missing, fall back to context-mode, grep, and LSP

## Skills (injected automatically by file pattern)

| Skill | Activates on | Notes |
|-------|-------------|-------|
| `j.test-writing` | `*.test.ts`, `*.spec.ts` | Jest/Vitest AAA pattern |
| `j.agents-md-writing` | `**/AGENTS.md` | Directory-local agent guidance |
| `j.domain-doc-writing` | `docs/domain/**/*.md` | Business behavior and sync markers |
| `j.graphify-usage` | `docs/domain/graphify/**`, Graphify-aware agents/commands | Safe use of `GRAPH_REPORT.md`, `graphify query`, `graphify path`, and `graphify explain` |
| `j.context-mode-usage` | Graphify/context-mode docs and agents | Decision rules between Graphify, context-mode, grep/Glob, and LSP |
| `j.planning-artifact-writing` | `docs/specs/**/{spec,CONTEXT,plan}.md` + workflow prompts | Durable context and ambiguity-free plans |
| `j.principle-doc-writing` | `docs/principles/**` | Cross-cutting technical rules |
| `j.shell-script-writing` | `.opencode/scripts/**/*.sh`, `scripts/**/*.sh`, hooks | Fast, safe automation scripts |

## State Files

| File | Location | Purpose |
|------|----------|---------|
| `juninho-config.json` | workspace root | Models (`strong/medium/weak`) plus `workflow` toggles for automation, implement (including `singleTaskMode`), unify, artifact commits, and documentation behavior |
| `.opencode/state/active-plan.json` | workspace | Session-level pointer to the active spec/plan bundle — consumed by plan-autoload and write-time guards |
| `.opencode/skill-map.json` | workspace | Dynamic skill-to-pattern mapping — extended by /j.finish-setup |
| `.opencode/state/persistent-context.md` | workspace | Long-term project knowledge — reconciled by UNIFY |
| `.opencode/state/execution-state.md` | workspace | Global session summary — active goal, plan path, session log |
| `docs/specs/{slug}/plan.md` | workspace | Unified plan covering all write targets |
| `docs/specs/{slug}/spec.md` | workspace | Unified spec covering all write targets |
| `docs/specs/{slug}/CONTEXT.md` | workspace | Durable research context and business intent |
| `docs/specs/{slug}/state/implementer-work.md` | workspace | Feature-local implementer log (append-only) |
| `docs/specs/{slug}/state/check-review.md` | workspace | Latest repo-wide check + detailed review findings for follow-up corrections |
| `docs/specs/{slug}/state/tasks/task-{id}/execution-state.md` | workspace | Per-task lease, heartbeat, status, validated commit |
| `docs/specs/{slug}/state/tasks/task-{id}/validator-work.md` | workspace | Per-task validator audit trail |
| `docs/specs/{slug}/state/tasks/task-{id}/retry-state.json` | workspace | Retry budget and retry bookkeeping |
| `docs/specs/{slug}/state/tasks/task-{id}/runtime.json` | workspace | Runtime metadata for watchdog/orchestration |
| `docs/specs/{slug}/state/sessions/{sessionID}-runtime.json` | workspace | Session runtime ownership metadata |
| `docs/specs/{slug}/state/integration-state.json` | workspace | Canonical feature integration manifest |
| `docs/domain/{domain}/*.md` | target repos | Business domain docs (stays per-repo) |
| `docs/principles/{topic}.md` | target repos | Technical principles (stays per-repo) |

## Auto-Learning Directive

**Canonical rule**: whenever the developer instructs corrections to an implementation (code pattern errors, naming issues, wrong approaches, missed conventions), the agent MUST self-assess whether the correction reveals a gap in the harness knowledge base.

### Trigger

Any time the developer:
- Requests changes to code that was already implemented by the agent
- Points out pattern violations, naming mistakes, or architectural drift
- Rejects an approach and explains why

### Flow

1. **Self-assess**: After applying the correction, evaluate what caused the error:
   - Missing or insufficient skill documentation?
   - Missing pattern in `AGENTS.md` (root or directory-scoped)?
   - Missing domain doc or principle doc?
   - Missing or unclear `CONTEXT.md` constraint?
   - Missing canonical example in `find_pattern`?

2. **Propose**: Present a concise proposal to the developer:
   - **Where**: exact file(s) that should be updated (e.g., `.opencode/skills/j.service-writing/SKILL.md`, `src/AGENTS.md`, `docs/principles/naming.md`)
   - **What**: the specific rule/pattern/example to add
   - **Why**: how this prevents the same class of error from recurring

3. **Ask**: "Deseja que eu atualize [file] com essa regra para que o erro não se repita?" (or equivalent in the conversation language)

4. **Act or skip**: If the developer approves, apply the update. If rejected, move on without insisting.

### Constraints

- Never update harness/skills/docs without developer approval.
- Keep proposals atomic — one concern per proposal. If multiple gaps were found, list them separately.
- Do not propose changes to `plan.md`, `spec.md`, or `CONTEXT.md` of the current feature — those are immutable during implementation.
- Proposals must be concrete (exact file + exact content), not vague suggestions.
- This directive applies to ALL agents that receive correction feedback, not only the implementer.

## Conventions

- Specs: `docs/specs/{feature-slug}/spec.md` + `CONTEXT.md` + `plan.md` + `state/**` — all in **workspace root**, not in target repos
- A single unified plan.md/spec.md/CONTEXT.md covers all write targets; no per-repo duplication unless `workflow.documentation.replicateSpecToTargetRepos` is true
- Domain docs: `docs/domain/{domain}/*.md` — indexed in `docs/domain/INDEX.md` — stays in target repos
- Principles: `docs/principles/{topic}.md` — registered in `docs/principles/manifest` — stays in target repos
- Sync markers: `<!-- juninho:sync source=... hash=... -->` to track doc↔code alignment
- Implementation history: exactly one implementation commit per task on `feature/{slug}`; optional `/j.unify` commits are limited to one doc-sync commit gated by `workflow.unify.commitDocUpdates` and one feature-state artifact commit gated by `workflow.unify.commitFeatureArtifacts`.
- Hierarchical `AGENTS.md`: root + `src/` + `src/{module}/` — generated by `/j.finish-setup`
- Scratch / temp data: ALWAYS use `/Users/kleber.motta/repos/tmp/` (set `TMPDIR=/Users/kleber.motta/repos/tmp`) for sandboxes, eval runs, scratch files, and any throwaway output. NEVER use `/var/folders/...`, `/tmp`, or `os.tmpdir()` defaults — those paths are outside the workspace permission scope and will fail to read back. Example: `TMPDIR=/Users/kleber.motta/repos/tmp bun ./.opencode/evals/lib/opencode-behavioral-runner.ts`.

## Git Commit Rules

- **NEVER use `--no-verify`**. If pre-commit hooks fail, the failure is real and must be fixed. Do not bypass hooks under any circumstance.
- If a hook fails due to environment issues (wrong Java version, missing tool), fix the environment first, then re-run the commit normally.
- For Maven projects, ensure `JAVA_HOME` matches the `<java.version>` in `pom.xml` before committing. The harness validates this automatically via `maven_check_java_version` in `_detect-stack.sh`.
- Set `JAVA_HOME` explicitly when the shell default does not match: `export JAVA_HOME=$HOME/.sdkman/candidates/java/<version>-<vendor> && export PATH="$JAVA_HOME/bin:$PATH"`
