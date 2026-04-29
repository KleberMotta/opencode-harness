# /test — Run Test Suite

Run fast, change-scoped tests during implementation after lint/build gates are green.

## Usage

```
/j.test                          # iterate writeTargets[] from active-plan.json
/j.test <repo-path>              # test a single explicit project
/j.test <repo-path> <pattern>    # path scope inside the chosen project
```

## Resolution

If `<repo-path>` is provided, test only that project. The optional `<pattern>` is resolved relative to that project root.

Otherwise:
1. Read `.opencode/state/active-plan.json`
2. For every `writeTargets[].targetRepoRoot`, run tests inside that project

## What runs (per target)

Run via the Bash tool with `workdir="$REPO_ROOT"`:

```bash
sh /Users/kleber.motta/repos/.opencode/scripts/test-related.sh
```

If the repository defines `test:related`, that script is preferred. Otherwise the default fallback tries tools such as `jest --findRelatedTests` or `vitest related`.

The script is workspace-safe: it refuses to operate on the workspace git unless `ALLOW_WORKSPACE_GIT=1`.

## When to use

- During implementation, before leaving `@j.implementer`
- When the pre-commit hook fails on related tests and you want to rerun the same scope
- After `.opencode/scripts/build-verify.sh` passes when you need the same local gating order as pre-commit
- Use `/j.check` for the full repository suite after implementation
