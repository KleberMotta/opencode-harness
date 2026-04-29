# Harness Evals

Deterministic evals for the local OpenCode harness live here.

## Layers

- `structural` — filesystem/config shape checks
- `hooks` — commit-path scripts and hook behavior
- `context` — plugin-driven context injection and scope guards
- `state` — feature-state scaffolding and integration manifest lifecycle
- `skills` — trigger, near-miss, and behavioral scenarios for custom skill guidance

## Run

```bash
bun test .opencode/evals/tests
bun test .opencode/evals/tests/hooks
bun test .opencode/evals/tests/context
bun test .opencode/evals/tests/state
```

These evals are intentionally offline and deterministic. They validate the real scripts and plugin contracts used by this repository without requiring live model calls.
