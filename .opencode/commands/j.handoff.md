# /handoff — End-of-Session Handoff

Prepare a handoff document for the next session or team member.

## Usage

```
/j.handoff
```

## What happens

1. Reads `.opencode/state/active-plan.json` to discover all write targets
2. For each write target project (`$REPO_ROOT`):
   - Reads per-task state from `$REPO_ROOT/docs/specs/{feature-slug}/state/tasks/task-*/execution-state.md`
   - Reads the feature-local implementer log from `$REPO_ROOT/docs/specs/{feature-slug}/state/implementer-work.md`
   - Reads `$REPO_ROOT/docs/specs/{feature-slug}/state/integration-state.json` for validated SHAs and commit bookkeeping/cleanup status
   - Reads session runtime metadata from `$REPO_ROOT/docs/specs/{feature-slug}/state/sessions/` when session ownership/context is relevant
3. Summarizes (across all write targets):
   - What was completed this session
   - What is in progress (with file names, attempt number, and last heartbeat)
   - What is blocked and why
   - What was retried and why
   - What is already committed into `feature/{feature-slug}` and which commit represents each task
   - What still needs bookkeeping or cleanup
   - Exact next step to continue

6. Updates local execution state with handoff notes

7. Optionally commits the state files:
    `git add .opencode/state/ docs/specs/*/state/ && git commit -m "chore: session handoff"`

## Output format

```markdown
# Session Handoff — {date}

## Completed
- [x] Task description

## In Progress
- [ ] Task description
  - Last state: {what was done}
  - Next step: {exactly what to do next}
  - Files: {relevant files}

## Blocked
- [ ] Task description
  - Blocker: {what's blocking}
  - Resolution needed: {what needs to happen}

## Next Session: Start with
{single, clear action to take first}
```
