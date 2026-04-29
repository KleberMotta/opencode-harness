# /lint — Run Linter

Run the structure lint used by the pre-commit path.

This command is only the lint gate. The pre-commit hook then runs `.opencode/scripts/build-verify.sh` and `.opencode/scripts/test-related.sh`, waiting for each one to succeed before continuing.

## Usage

```
/j.lint                 # iterate writeTargets[] from active-plan.json
/j.lint <repo-path>     # lint a single explicit project
```

## Resolution

If `<repo-path>` is provided, lint only that project.

Otherwise:
1. Read `.opencode/state/active-plan.json`
2. For every `writeTargets[].targetRepoRoot`, run lint inside that project
3. Print a single per-target line at the end (PASS/FAIL count)

## What runs (per target)

Run via the Bash tool with `workdir="$REPO_ROOT"`:

```bash
sh /Users/kleber.motta/repos/.opencode/scripts/lint-structure.sh
```

The script is workspace-safe: it refuses to operate on the workspace git unless `ALLOW_WORKSPACE_GIT=1`.

## When to use

- During active implementation, to catch structural issues quickly
- When the pre-commit hook fails on lint and you want the same check on demand
- After editing docs, scripts, or config files that need non-test validation
