---
name: j.finpy-test-writing
description: Write pytest async tests with Fake repositories/clients, AAA pattern, and parametrized error mapping for stakfin-financial-data
---

# Skill: FinPy Test Writing

## When this skill activates
Creating or editing `tests/**/test_*.py`, `tests/**/fake_*.py`, or any test file in stakfin-financial-data or similar Python FastAPI + pytest projects.

## Required Steps
- Mark async tests with `@pytest.mark.asyncio`
- Use `Fake*` classes with in-memory dicts/configurable responses instead of mocks
  - For system dependencies: `FakeOcrEngine`, `FakePdfRenderer` — configurable via `set_*()` methods, record all calls
  - For repositories: `Fake*Repository` with in-memory dicts and `lookup()` call recording
  - For clients: `FakeYFinanceClient` with configurable responses/exceptions
- Use `FakeYFinanceClient` (or similar fake client) with configurable responses/exceptions
- Follow AAA pattern: Arrange → Act → Assert, separated by blank lines
- Use factory helpers (`build_ticker()`, `_test_settings()`, `_build_service()`) for test data creation
- Parametrize error-mapping tests with `@pytest.mark.parametrize`
- Route tests: use `TestClient` with `dependency_overrides` for fake DB sessions
- Naming: `test_{method}_{scenario}` — descriptive names that read as sentences
- Group tests in directories mirroring source structure: `test_services/`, `test_routes/`, `test_repositories/`, `test_integration/`

## Anti-patterns to avoid
- Using `unittest.mock.Mock` or `MagicMock` — Fake classes are simpler and more readable
- Testing real yfinance in unit tests — always use FakeYFinanceClient
- Returning dicts from fake services in route tests (bypasses Pydantic serialization)
- Testing implementation details instead of observable behavior
- Not parametrizing error mapping tests

## Canonical example
- `tests/test_services/test_ticker_service.py:1-252` — FakeRepository + FakeClient, async tests, AAA, parametrized error mapping
- `tests/test_routes/test_events.py` — TestClient + dependency_overrides pattern (avoid dict bypass)
ENDOFFILE 2>&1
