---
name: j.graphify-usage
description: Use Graphify reports and CLI safely for god nodes, coupling hotspots, and path tracing without replacing code search
---

# Skill: Graphify Usage

## When this skill activates
Creating or editing Graphify artifacts under `docs/domain/graphify/`, wiring Graphify-aware agent instructions, or deciding whether to use `GRAPH_REPORT.md`, `graphify query`, `graphify path`, `graphify explain`, or the Graphify CLI wrappers.

## Required Steps
1. Prefer `docs/domain/graphify/GRAPH_REPORT.md` as the first artifact; use CLI tools only when the report is insufficient.
2. Use `graphify query "<question>" --graph <path>` for god nodes, hotspots, dependency-heavy areas, and broad coupling questions.
3. Use `graphify path "A" "B" --graph <path>` only between already-known files or symbols inside the current task scope.
4. Use `graphify explain "X" --graph <path>` for suspicious cross-domain edges or non-obvious dependencies.
5. Keep Graphify findings short and task-relevant; summarize, do not dump raw artifacts.
6. Confirm any concrete code conclusion with Read, Glob, Grep, LSP, or context-mode before editing code.
7. Fall back cleanly when Graphify is disabled, stale, missing, or `graph.json` does not exist.

## CLI Equivalents
- `npm run graphify:build -- --repo <repo>`
- `npm run graphify:refresh -- --repo <repo> --incremental`
- `npm run graphify:status -- --json`

## Good Uses
- Finding likely god nodes before broad code search
- Checking whether two known areas are connected before refactoring
- Explaining suspicious cross-domain edges during review or check
- Summarizing Graphify report deltas during `/j.unify`

## Anti-patterns
- Pasting `graph.json` into context, docs, or review reports
- Using Graphify instead of grep/LSP for exact code lookups
- Expanding task scope because Graphify exposed unrelated hotspots
- Treating missing Graphify as a hard blocker when fallback tools exist
- Enabling watch mode, hooks, or pre-commit automation through Graphify flows
