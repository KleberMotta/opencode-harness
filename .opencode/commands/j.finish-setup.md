# /finish-setup — Bootstrap Repository Knowledge

This is the canonical repository bootstrap command after installing the harness.

Scan a project codebase, generate hierarchical AGENTS.md files, discover recurring file patterns, generate dynamic skills, and populate domain/principles documentation.

## Usage

```
/j.finish-setup
/j.finish-setup <project-path-or-name>
```

When a project argument is provided, all artifacts are generated **inside that project's root**, not at the workspace root.
When no argument is provided and the harness runs from a workspace root with multiple discovered projects, ask which project to bootstrap.

## Multi-Repo Behavior

The harness can run from a workspace root (e.g., `~/repos/`) that contains multiple project repositories.
In this mode, `/j.finish-setup` must resolve the **target project root** before starting any phase.

**Target resolution order:**
1. Explicit argument: `/j.finish-setup olxbr/trp-partner-api` or `/j.finish-setup /absolute/path/to/repo`
2. Single project in workspace: use it automatically
3. Active plan target: if `active-plan.json` exists, offer to bootstrap each write target that lacks docs
4. Multiple projects, no argument: list discovered projects and ask the user to choose

**All generated paths below are relative to the resolved `$PROJECT_ROOT`, not the workspace root.**

## What happens

### Phase 1 — Structural Scan (via @j.explore)

1. Invoke `@j.explore` to scan the **target project codebase** at `$PROJECT_ROOT`
2. Identify significant directory boundaries for local instructions:
   - root project context for the main `AGENTS.md`
   - source-tree boundaries such as `src/`, `app/`, `internal/`, `pkg/`, `services/`, `modules/`
   - major domain/module directories that deserve their own local `AGENTS.md`
3. Identify recurring file patterns by suffix/convention:
   - `*Repository.ts`, `*Repository.java`, `*Repository.kt`, `*_repository.py` → pattern "repository"
   - `*Service.ts`, `*Service.java`, `*Service.kt`, `*_service.py` → pattern "service"
   - `*Controller.ts`, `*Controller.java`, `*Controller.kt` → pattern "controller"
   - `*Handler.go`, `*handler.go` → pattern "handler"
   - `*Middleware.*` → pattern "middleware"
   - `*Schema.*`, `*Model.*` → pattern "model/schema"
   - `*DTO.*`, `*Request.*`, `*Response.*` → pattern "dto"
   - `*Factory.*`, `*Builder.*` → pattern "factory/builder"
   - Any other recurring naming pattern (`*Hook.ts`, `*Composable.ts`, `*Store.ts`, etc.)
4. For each pattern found, read 2-3 exemplar files and extract:
   - Common structure (imports, exports, class vs function)
   - Naming conventions
   - Dependency patterns (what it injects, what it returns)
   - Error handling patterns
   - Validation patterns

### Phase 2 — Generate Hierarchical AGENTS.md

5. Generate or refresh hierarchical `AGENTS.md` files inside `$PROJECT_ROOT`:
   - Root `$PROJECT_ROOT/AGENTS.md`: stack summary, real build/test commands, directory layout, critical repo rules
   - Directory-level `AGENTS.md`: local architecture, invariants, module boundaries, integration contracts
6. Keep each generated `AGENTS.md` scoped to its directory only:
   - no copy-pasting the entire root file into child directories
   - no business-domain detail that belongs in `docs/domain/*`
   - commands must match the actual repository scripts and build tools

### Phase 3 — Generate Dynamic Skills

7. For each discovered pattern, create a skill in `.opencode/skills/j.{pattern}-writing/SKILL.md` (at the **harness root**, not the project root — skills are shared across projects):
    - Frontmatter with `name`, `description`
    - "When this skill activates" with the glob patterns from the project
    - "Required Steps" extracted from the exemplar file analysis
    - "Anti-patterns to avoid" based on what the exemplars do NOT do
    - Canonical example copied/adapted from a real project file
   - Before finalizing or revising any skill, load and apply the local `skill-creator` skill so the description, trigger criteria, and eval hooks are explicit
8. Update `.opencode/skill-map.json` (at the harness root) with new regex patterns for each skill
9. For every created or changed skill, add intelligent eval coverage that proves:
   - the skill triggers under realistic prompts
   - near-miss prompts do not trigger it
   - the skill changes agent behavior on at least one implementation task

### Phase 4 — Generate Documentation

10. Generate initial docs in `$PROJECT_ROOT/docs/domain/` (subdirectories by discovered domain)
11. Generate initial docs in `$PROJECT_ROOT/docs/principles/` based on patterns found
12. Populate `$PROJECT_ROOT/docs/principles/manifest` with real keywords
13. Populate `$PROJECT_ROOT/docs/domain/INDEX.md` with real entries and CARL keywords

### Phase 5 — Refresh Local Automation Stubs

14. Validate `.opencode/scripts/lint-structure.sh` (at harness root)
15. Validate `.opencode/scripts/test-related.sh` (at harness root)
16. Validate `.opencode/scripts/check-all.sh` (at harness root)
17. Align commands documented in generated `AGENTS.md` files with the actual repository scripts and build tools found in `$PROJECT_ROOT`

### Phase 7 — Bootstrap Graphify

18. Read the harness `.opencode/juninho-config.json` and inspect `workflow.graphify.enabled`
19. If Graphify is disabled, record an intentional skip for this phase and do not run any build
20. If Graphify is enabled, run `npm run graphify:build -- --repo "$PROJECT_ROOT"` from the harness root
21. Document Graphify outputs in `$PROJECT_ROOT/docs/domain/graphify/{graph.html,graph.json,GRAPH_REPORT.md,cache/}`
22. If Graphify cache/output exceeds 100 MB, emit a warning and recommend Git LFS; do not migrate automatically
23. Do not enable `--watch`, install git hooks, or add pre-commit automation as part of this phase
24. Graphify integrates via CLI (`graphify query`, `graphify path`, `graphify explain`) and the official opencode skill/plugin — not as an MCP server.

## Delegation Rule (MANDATORY)

You MUST use `@j.explore` for Phase 1. Do NOT try to scan the codebase yourself.

When `@j.explore` returns its report:
- Read the FULL report
- Extract all file patterns and structural findings
- Use them to generate AGENTS, skills, and docs

## When to use

- Right after `juninho setup` on an existing project
- After major structural refactors that introduce new file patterns
- When onboarding a new project to the framework
- In multi-repo workspaces, to bootstrap a target project that lacks context artifacts (AGENTS.md, docs/domain, docs/principles)
- After `/j.finish-setup` generates files, review and augment them with non-obvious domain knowledge

## Result

After completion, the target project will have:
- Hierarchical `AGENTS.md` files aligned to the real directory structure
- Custom skills registered in the harness that match the project's file patterns and conventions
- Domain documentation populated with real business domains at `$PROJECT_ROOT/docs/domain/`
- Principles documentation reflecting actual codebase patterns at `$PROJECT_ROOT/docs/principles/`
- Updated local automation stubs and command references
- Optional Graphify output at `$PROJECT_ROOT/docs/domain/graphify/` when `workflow.graphify.enabled` is true
