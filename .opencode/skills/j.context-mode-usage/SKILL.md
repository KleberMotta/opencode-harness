---
name: j.context-mode-usage
description: Choose context-mode over raw shell for large-output commands, sandboxed processing, indexed docs, and HTTP work; know when Graphify or grep/LSP is the better fit
---

# Skill: Context-Mode Usage

## When this skill activates
Working on tasks that involve large command output, indexed documentation, sandboxed data processing, blocked HTTP fetching, or decisions between context-mode, Graphify, grep/Glob, and LSP.

## Required Steps
1. Use `ctx_batch_execute` as the default for multi-command investigation and output search.
2. Use `ctx_execute` or `ctx_execute_file` when logs, command output, or large files need filtering before entering context.
3. Use `ctx_fetch_and_index` plus `ctx_search` for web/docs fetching; do not use blocked direct fetch flows.
4. Use Graphify only for semantic architecture questions such as hotspots, god nodes, and path tracing between known symbols.
5. Use Glob, Grep, and LSP for exact filenames, symbol definitions, references, and small-scope code search.
6. Use Read only when the file content must enter context for editing or precise explanation.
7. Keep Bash for short-output commands and filesystem/git mutations, not for large-output analysis.

## Decision Matrix
- Graphify: semantic map, coupling, god nodes, path between known symbols
- context-mode: sandboxed processing, large-output commands, indexed docs, HTTP and CLI investigation
- Glob/Grep/LSP: exact file and symbol discovery inside the codebase
- Read: bring exact file content into context when editing or line-by-line reasoning is required

## Anti-patterns
- Pulling raw large output into context when context-mode can pre-filter it
- Using Graphify instead of grep/LSP for exact code or symbol lookup
- Using context-mode to rewrite files that should be edited with apply_patch/Edit
- Using raw shell or direct fetches for blocked HTTP/data-processing workflows
