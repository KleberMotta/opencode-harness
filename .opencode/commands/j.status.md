# /status — Show Current Work Status

Display session summary and per-task state — tasks, progress, and blockers.

## Usage

```
/j.status
/j.status <feature-slug>
```

## What shows

- Current goal and active plan path (from global session state)
- Task table: ID / description / agent / status / attempt
- Integration table details from `integration-state.json`: validated commit on the shared feature branch and bookkeeping status
- In-progress items with last known state and heartbeat
- Blocked items with blocker descriptions
- Retried or stale items visible from per-task execution state
- Session log (recent actions)

## When to use

- At the start of a session to orient yourself
- After resuming work to see what's left
- To check if all tasks are complete before running `/j.unify`

## Source

Reads state from `.opencode/state/active-plan.json` to discover all write targets, then reads centralized artifacts from the workspace:

1. **Active plan**: `.opencode/state/active-plan.json` — identifies write targets and their `targetRepoRoot` paths
2. **Task state**: `$WORKSPACE_ROOT/docs/specs/{feature-slug}/state/tasks/task-{id}/execution-state.md` — detailed task progress, attempts, heartbeats, blockers, and validated commit
3. **Integration manifest**: `$WORKSPACE_ROOT/docs/specs/{feature-slug}/state/integration-state.json` — canonical feature branch, task validated SHAs, and commit bookkeeping/cleanup status

In multi-repo mode, show task-level grouping by target project (using the `Target:` field from the unified plan) so it's clear which tasks belong to which repo.

If a `<feature-slug>` argument is provided, only show per-task state for that feature.
If omitted, infer the slug from the active plan.

No agent needed — this is a direct state file read.
