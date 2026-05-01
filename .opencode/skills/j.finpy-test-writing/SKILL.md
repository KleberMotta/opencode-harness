---
name: j.finpy-test-writing
description: Write pytest async tests with Fake repositories/clients, AAA pattern, and parametrized error mapping for stakfin-financial-data
---

# Skill: FinPy Test Writing

## When this skill activates
Creating or editing `tests/**/test_*.py` files in stakfin-financial-data or similar Python FastAPI + pytest projects.

## Required Steps
- Mark async tests with `@pytest.mark.asyncio`
- Use `Fake*Repository` classes with in-memory dicts instead of mocks
- Use `FakeYFinanceClient` (or similar fake client) with configurable responses/exceptions
- Follow AAA pattern: Arrange → Act → Assert, separated by blank lines
- Use factory helpers (`build_ticker()`, `build_event()`) for test data creation
- Parametrize error-mapping tests with `@pytest.mark.parametrize`
- Route tests: use `TestClient` with `dependency_overrides` for fake DB sessions
- Naming: `test_{method}_{scenario}` — descriptive names that read as sentences
- Group tests in directories mirroring source structure: `test_services/`, `test_routes/`, `test_integration/`

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
