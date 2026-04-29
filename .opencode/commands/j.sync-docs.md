# /sync-docs — Refresh AGENTS and Documentation

Generate or update `AGENTS.md`, domain docs, and principle docs using the current code as source of truth.

## Usage

```
/j.sync-docs
/j.sync-docs <path or domain>
```

## What happens

1. Read `.opencode/juninho-config.json` to understand documentation-related workflow defaults
2. Read `.opencode/state/active-plan.json` to discover write targets (if active)
3. Resolve the target project:
   - If a path/domain argument is provided, resolve the containing project root
   - If an active plan exists, operate on all write target projects
   - Otherwise, operate on the single discovered project or ask the user
4. For each target project (`$PROJECT_ROOT`):
   - Identify key files for the requested scope
   - Update `$PROJECT_ROOT/AGENTS.md` and directory-level `AGENTS.md` files
   - Update `$PROJECT_ROOT/docs/domain/*` for business behavior and invariants
   - Update `$PROJECT_ROOT/docs/principles/*` for cross-cutting technical patterns
   - Add or refresh sync markers such as:
     - `<!-- juninho:sync source=src/payments/service.ts hash=abc123 -->`
   - Update `$PROJECT_ROOT/docs/domain/INDEX.md` and `$PROJECT_ROOT/docs/principles/manifest` when new docs are added or renamed

## Rules

- Prefer small, high-signal `AGENTS.md` files close to the code they describe
- Keep business behavior out of `AGENTS.md`; put it in `docs/domain/*`
- Keep technical principles reusable; do not bury them in a module-specific doc
- Use key-file sync markers so doc drift is visible during later updates

## Delegation Rule (MANDATORY)

You MUST delegate this task to `@j.implementer` using the `task()` tool.
Do NOT rewrite the docs yourself when the harness workflow asks for agent execution.

## When to use

- After finishing a feature before human review
- After major refactors that changed local rules or business behavior
- When CARL recall quality degrades because docs or manifests are stale
