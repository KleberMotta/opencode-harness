# Feature State

This directory stores canonical harness state for `docs/specs/{feature-slug}/`.

## Layout

- `README.md`
  - this file
- `implementer-work.md`
  - append-only feature log for cross-task decisions, retries, and deviations
- `check-review.md`
  - latest repo-wide verification + detailed review report used to drive follow-up corrections
- `integration-state.json`
  - source of truth for validated task commits, feature-branch commits, and cleanup status
- `tasks/`
  - one directory per task: `task-{id}/`
- `sessions/`
  - one runtime metadata file per spawned session: `{sessionID}-runtime.json`

## Task Directory

Each task lives under `tasks/task-{id}/`.

Files used by the harness:
- `execution-state.md`
- `validator-work.md`
- `retry-state.json`
- `runtime.json`

## Session Runtime

`sessions/{sessionID}-runtime.json` maps a live OpenCode session back to its task runtime metadata.
These files are operational metadata only.

## Rules

- The harness writes feature state only in this directory tree.
- Task-specific files must live under `tasks/task-{id}/`.
- Session runtime files must live under `sessions/`.
- `integration-state.json` and `implementer-work.md` stay at the root of this feature state directory.
- `check-review.md` stays at the root of this feature state directory and is overwritten by the latest full-check pass.
- When `check-review.md` identifies required changes after a task is already COMPLETE, create a new follow-up task instead of reopening the completed task.
