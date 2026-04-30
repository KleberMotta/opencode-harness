---
name: j.context-mode-usage
description: Choose context-mode over raw shell for large-output commands, sandboxed processing, indexed docs, and HTTP work; know when Graphify or grep/LSP is the better fit
---

# Skill: Context-Mode Usage

## When this skill activates
Working on tasks that involve large command output, indexed documentation, sandboxed data processing, blocked HTTP fetching, or decisions between context-mode, Graphify, grep/Glob, and LSP.

## Core Principle
Context-mode saves context tokens by sandboxing output. Use it when output would exceed ~20 lines or ~2KB. Skip it for quick, small-output operations where the extra round trip adds latency without saving meaningful context.

## When to USE context-mode

| Scenario | Tool |
|----------|------|
| Multi-command investigation (build output, test runs, logs) | `ctx_batch_execute` |
| Large file analysis without editing intent | `ctx_execute_file` |
| Web/API docs fetching | `ctx_fetch_and_index` + `ctx_search` |
| Processing JSON/CSV/log data to extract answers | `ctx_execute` |
| Searching across already-indexed content | `ctx_search` |
| Any shell command likely to produce >20 lines output | `ctx_execute(language: "shell")` |

## When to SKIP context-mode (use native tools directly)

| Scenario | Use instead |
|----------|-------------|
| Reading a file you intend to edit | `Read` (content must be in context) |
| Finding 1-3 files by name pattern | `Glob` |
| Finding a specific symbol definition | `LSP goto_definition` |
| Finding all references of a symbol | `LSP find_references` |
| Short git commands (status, log -5, branch) | `Bash` directly |
| File mutations (git commit, mkdir, mv, rm) | `Bash` directly |
| npm install, pip install (short output) | `Bash` directly |
| Quick grep returning <10 matches | `Grep` tool |
| Writing/editing files | `Write`/`Edit` |

## Decision Flowchart

```
Will output exceed ~20 lines or ~2KB?
  NO  → Use native tools (Bash, Grep, Glob, Read, LSP)
  YES → Will I need to search this output later?
          YES → ctx_batch_execute (auto-indexes)
          NO  → ctx_execute / ctx_execute_file (stdout only)
```

## Tool Selection Hierarchy

1. **GATHER**: `ctx_batch_execute(commands, queries)` — Primary for investigation. ONE call replaces many.
2. **FOLLOW-UP**: `ctx_search(queries)` — Query previously indexed content. Batch all questions.
3. **PROCESSING**: `ctx_execute` / `ctx_execute_file` — Sandbox computation, only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search` — For documentation/web content.
5. **INDEX**: `ctx_index(content, source)` — Store large tool results for later retrieval.

## Context-Mode vs Graphify vs grep/LSP

| Need | Tool |
|------|------|
| Semantic architecture map, god nodes, coupling | Graphify (`GRAPH_REPORT.md`, `graphify query/path/explain`) |
| Sandboxed processing, large output, indexed web docs | context-mode |
| Exact file/symbol discovery in codebase | Glob / Grep / LSP |
| Bring exact file content into context for editing | Read |
| Execute and mutate (git, file ops) | Bash |

## Performance Tips

- **Avoid `npx -y context-mode@latest`** in MCP config — use globally installed `context-mode` binary to eliminate cold-start latency.
- **Batch queries**: `ctx_search(queries: ["q1", "q2", "q3"])` is 1 call, not 3.
- **Don't over-sandbox**: a 5-line `git log` is faster via Bash than via `ctx_execute`.
- **Think in Code**: when analyzing data, write code that computes the answer in sandbox rather than pulling raw data into context.

## Anti-patterns

- Pulling raw large output into context when context-mode can pre-filter it
- Using Graphify instead of grep/LSP for exact code or symbol lookup
- Using context-mode to rewrite files that should be edited with Edit tool
- Using context-mode for operations that produce <20 lines of output (overhead > benefit)
- Sandboxing reads when you actually need the content in context for editing
- Using `ctx_fetch_and_index` for local files (use `ctx_execute_file` instead)
- Multiple sequential `ctx_search` calls when one call with array of queries works

## Setup Requirements (OpenCode)

The `opencode.json` must have both entries for full functionality:
```json
{
  "mcp": {
    "context-mode": { "type": "local", "command": ["context-mode"] }
  },
  "plugin": ["context-mode"]
}
```
- `mcp` entry: registers the 6 sandbox tools
- `plugin` entry: enables hooks (PreToolUse, PostToolUse, PreCompact) for automatic routing enforcement and session continuity

Without `plugin`, context-mode is passive — tools work when called but there is no automatic interception of large-output commands.
