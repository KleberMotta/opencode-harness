# /start-work — Begin a Work Session

Initialize context for a focused work session on a specific task.

## Usage

```
/j.start-work <task description or issue number>
```

## Examples

```
/j.start-work issue #42 — fix login redirect loop
/j.start-work implement the dashboard analytics widget
/j.start-work #123
```

## What happens

1. Reads `.opencode/state/active-plan.json` to discover write targets
2. For each write target project, loads `docs/domain/INDEX.md` for domain context
3. Checks `$WORKSPACE_ROOT/docs/specs/{feature-slug}/state/` for any in-progress work
4. If a `plan.md` exists in workspace: loads it and presents next steps
5. If no plan: asks whether to `/j.plan` first or jump straight to `/j.implement`
6. Sets up execution state for the current task

In multi-repo mode, shows status across all write targets so you can see which projects have pending work.

## After starting work

The session is now focused. Use `/j.implement` to build, `@j.validator` to check, `/j.handoff` when done.
