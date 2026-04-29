# /lint — Run Linter

Run the structure lint used by the pre-commit path.

This command is only the lint gate. The pre-commit hook then runs `.opencode/scripts/build-verify.sh` and `.opencode/scripts/test-related.sh`, waiting for each one to succeed before continuing.

## Usage

```
/j.lint
```

## What runs

`.opencode/scripts/lint-structure.sh`

## When to use

- During active implementation, to catch structural issues quickly
- When the pre-commit hook fails on lint and you want the same check on demand
- After editing docs, scripts, or config files that need non-test validation
