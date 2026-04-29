# Authentication Patterns

Use the repository's established authentication entrypoints before business logic.

## Rules

- Authenticate early and fail closed
- Keep token parsing and authorization checks close to the request boundary
- Do not mix credential handling with domain logic

## Verify

- Protected routes reject missing or invalid credentials
- Auth context is passed through typed interfaces or request-scoped state
