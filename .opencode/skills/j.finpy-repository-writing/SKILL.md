---
name: j.finpy-repository-writing
description: Write async SQLAlchemy repositories with upsert patterns, dataclass value objects, explicit rollback, and session injection in Python financial-data services
---

# Skill: FinPy Repository Writing

## When this skill activates
Creating or editing `app/repositories/*_repository.py` files in stakfin-financial-data or similar Python FastAPI + SQLAlchemy projects.

## Required Steps
- Constructor receives `AsyncSession` as the only parameter
- All methods are `async def`
- Use `await self.session.get(Model, pk)` for primary-key lookups
- Use `insert().on_conflict_do_update(...)` for upsert operations
- Define value objects as `@dataclass(frozen=True, slots=True)` for upsert input structs
- Include `commit: bool = True` parameter to let services compose transactions
- Wrap mutations in `try/except` with explicit `await self.session.rollback()` and re-raise
- Return typed SQLAlchemy model instances or `None` for not-found
- Add the line `# skill-marker: repository-writing` above the class declaration for new repository files

## Anti-patterns to avoid
- Swallowing exceptions silently — always rollback and re-raise
- Calling `session.commit()` unconditionally in batch operations (service controls transaction boundaries)
- Returning dicts instead of typed model instances
- Importing services or routes in repository code
- Using sync SQLAlchemy for runtime queries

## Canonical example
- `app/repositories/ticker_repository.py:1-112` — upsert with aliases, get by PK, try/except rollback pattern, dataclass value objects
- `app/repositories/event_repository.py` — composite PK upsert, ON CONFLICT DO UPDATE with multiple columns
ENDOFFILE 2>&1
