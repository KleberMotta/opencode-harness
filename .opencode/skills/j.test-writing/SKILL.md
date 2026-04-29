---
name: j.test-writing
description: Write focused unit and integration tests following project conventions
# Optional: uncomment to enable Playwright MCP for E2E tests
# mcp:
#   playwright:
#     command: npx
#     args: ["-y", "@playwright/mcp@latest"]
---

# Skill: Test Writing

## When this skill activates
Writing or editing `*.test.ts`, `*.test.tsx`, `*.spec.ts`, or `*.spec.tsx` files.

## Required Steps

### 1. Read the implementation first
Before writing any test, read the file being tested. Understand:
- What it does (not what you think it does)
- Its dependencies and side effects
- Error cases and edge conditions

### 2. Test structure
Follow the AAA pattern strictly:
```typescript
describe("ComponentName / functionName", () => {
  describe("when <condition>", () => {
    it("should <expected behavior>", () => {
      // Arrange
      const input = ...

      // Act
      const result = ...

      // Assert
      expect(result).toBe(...)
    })
  })
})
```

### 3. Coverage requirements
- Happy path: at least 1 test
- Error cases: test each distinct error path
- Edge cases: empty inputs, boundary values, null/undefined
- Prefer tests related to the changed files before running the full suite
- Do NOT test implementation details — test behavior

### 4. Mock strategy
- Mock external dependencies (APIs, DB, file system)
- Do NOT mock the module under test
- Use `vi.mock()` or `jest.mock()` for module mocking
- Use `vi.spyOn()` for method spying

### 5. Async tests
Always use `async/await`:
```typescript
it("should handle async operation", async () => {
  const result = await myAsyncFunction()
  expect(result).toEqual(expected)
})
```

### 6. Naming conventions
- Describe block: noun (component/function name)
- Nested describe: "when <condition>"
- It block: "should <verb> <outcome>"
- Test file: `{module}.test.ts` co-located with source

## Anti-patterns to avoid
- `expect(true).toBe(true)` — meaningless assertion
- Snapshot tests for logic — use specific assertions
- Testing private methods directly
- `expect.assertions(0)` — always assert something
- Tests that depend on order of execution
