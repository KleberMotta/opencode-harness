# Error Handling

Keep error handling explicit, typed when possible, and consistent with user-visible behavior.

## Rules

- Validate inputs before side effects
- Return stable error shapes for expected failures
- Log unexpected failures with enough context for debugging
- Do not leak internal implementation details to external callers
