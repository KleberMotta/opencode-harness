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

4. Updates local execution state with handoff notes

## Optional commit step (per target, never workspace-wide)

The optional commit of feature state artifacts must run **inside each write target's git**, not from the workspace. Each project has its own remote and its own `feature/{slug}` branch.

For each write target, run via the Bash tool with `workdir="$REPO_ROOT"`:

```bash
git add docs/specs/{feature-slug}/state/
git commit -m "chore({feature-slug}): session handoff"
```

Do **not** use a glob like `docs/specs/*/state/` from the workspace — it has undefined behavior and will either fail (no such path under workspace git) or stage the wrong files. Always scope to the active feature slug and run per project.

## Output format

```markdown
# Session Handoff — {date}

## Per-target status

### {project-1}
- Completed: ...
- In progress: ...
- Blocked: ...
- Next step: ...

### {project-2}
- ...

## Next Session: Start with
{single, clear action to take first}
```
