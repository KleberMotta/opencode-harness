---
name: j.finpy-schema-writing
description: Write Pydantic request/response DTOs with forbid-extra config, camelCase aliases, and batch envelope pattern
---

# Skill: FinPy Schema Writing

## When this skill activates
Creating or editing `app/schemas/*.py` files in stakfin-financial-data or similar Python FastAPI projects.

## Required Steps
- All schemas must set `ConfigDict(extra="forbid")`
- Use snake_case Python field names with camelCase JSON aliases
- Nullable fields: `str | None = None` (not `Optional[str]`)
- Error envelope: `ErrorEnvelope(error=ErrorPayload(code=..., message=..., details=..., retryable=...))`
- Batch responses: `items + errors + page + size + total_items` structure
- Date fields: use `date` type (FastAPI serializes to ISO string)
- Decimal fields: use `Decimal` type (FastAPI serializes to JSON number)
- Enums: define as `StrEnum` for type-safe string values, export in response as camelCase

## Anti-patterns to avoid
- Adding business logic or methods to schema classes (they are pure DTOs)
- Importing from services, repositories, or models in schemas
- Marking required response fields as `Optional`
- Forgetting `extra="forbid"` on any schema

## Canonical example
- `app/schemas/ticker.py:1-39` — DetailResponse with forbid extra, camelCase aliases, nullable fields
- `app/schemas/errors.py` — ErrorEnvelope + ErrorPayload nesting
ENDOFFILE 2>&1
