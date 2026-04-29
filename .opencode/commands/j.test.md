# /test — Run Test Suite

Run fast, change-scoped tests during implementation after lint/build gates are green.

## Usage

```
/j.test
/j.test <pattern>
```

## Examples

```
/j.test
/j.test src/payments
/j.test --watch
```

## What runs

`.opencode/scripts/test-related.sh`

If the repository defines `test:related`, that script is preferred.
Otherwise the default fallback tries tools such as `jest --findRelatedTests` or `vitest related`.

## When to use

- During implementation, before leaving `@j.implementer`
- When the pre-commit hook fails on related tests and you want to rerun the same scope
- After `.opencode/scripts/build-verify.sh` passes when you need the same local gating order as pre-commit
- Use `/j.check` for the full repository suite after implementation
