---
name: j.frontend-test-writing
description: Write frontend JavaScript and TypeScript tests by detecting the project's runner and following the nearest test pattern. Use for *.test.ts, *.spec.ts, and JSX/TSX test files when no context-specific frontend test skill overrides it.
---

# Frontend Test Writing

## When this skill activates

Use for frontend JavaScript or TypeScript test files when a project/context has
not supplied a more specific framework skill.

## Required Steps

1. Read the nearest test and the project's package scripts before writing a test.
2. Use the existing runner, render helper, assertion library, fixture style, and naming dialect; do not assume Jest, Vitest, Testing Library, Cypress, or Playwright.
3. Derive assertions from the task contract, not current implementation details.
4. Keep tests focused on observable behavior and run the narrowest existing test command.

## Anti-patterns

- Importing a test framework that the project does not use.
- Introducing a new test harness or renderer for one test.
- Asserting private implementation structure when user-visible behavior is available.
- Treating this fallback as a replacement for a context-specific frontend canon.
