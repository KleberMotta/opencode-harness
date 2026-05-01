---
name: j.finpy-service-writing
description: Write FastAPI domain services with constructor injection, DB-first + provider fallback, error mapping, and batch partial-result patterns in Python financial-data services
---

# Skill: FinPy Service Writing

## When this skill activates
Creating or editing `app/services/*_service.py` files in stakfin-financial-data or similar Python FastAPI projects.

## Required Steps
- Use constructor injection: all dependencies (repositories, clients, config) passed via `__init__`
- Normalize ticker IDs at service entry via `normalize_ticker_request()` before any processing
- Implement DB-first pattern: always query PostgreSQL first, fallback to external provider on cache miss
- Map provider exceptions to `AppError` via error mapping functions (e.g., `map_yfinance_error()`)
- Batch methods must return partial results (items + errors), never all-or-nothing
- Use `prepare_paged_batch_requests()` for batch pagination, normalization, and deduplication
- Private helper methods prefixed with `_` for internal orchestration
- All methods are `async def`, calling async repository methods
- Return typed domain models or Pydantic response schemas, never raw dicts

## Anti-patterns to avoid
- Opening a new DB session inside a service (session comes from route dependency injection)
- Catching all exceptions silently — let `AppError` propagate to error handlers
- Returning raw yfinance dicts without mapping to domain models
- Calling `os.getenv()` directly — use `Settings` from `app.config`
- Importing FastAPI or Starlette in service code

## Canonical example
- `app/services/ticker_service.py:1-152` — DB-first resolution, fractional alias fallback, batch partial results, yfinance error mapping
- `app/services/event_service.py:1-168` — sentinel TTL for empty-result tickers, event type filtering, alias persistence
ENDOFFILE 2>&1
