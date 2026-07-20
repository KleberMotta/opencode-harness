---
name: j.python-test-writing
description: Write Python tests by detecting the project's test runner and following local fixtures and assertions. Use for test_*.py and *_test.py when no context-specific Python test skill overrides it.
---

# Python Test Writing

## When this skill activates

Use for Python test files when a project/context has not supplied a more
specific Python testing canon.

## Required Steps

1. Read `pyproject.toml`, `pytest.ini`, `tox.ini`, or the nearest test before writing code.
2. Follow the local runner, fixture, mock, and assertion style; do not assume pytest when the project uses unittest or another framework.
3. Derive expected behavior from the task contract and run the narrowest existing test command.

## Anti-patterns

- Introducing pytest into a unittest project or the reverse.
- Creating a new fixture framework for a single test.
- Testing runtime scripts through network calls when their behavior can be isolated locally.
