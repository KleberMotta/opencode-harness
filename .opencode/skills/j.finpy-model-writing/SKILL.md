---
name: j.finpy-model-writing
description: Write SQLAlchemy 2.0 ORM models with DeclarativeBase, Mapped annotations, UTC timestamps, and FK cascades in stakfin-financial-data
---

# Skill: FinPy Model Writing

## When this skill activates
Creating or editing `app/models/*.py` files in stakfin-financial-data or similar Python SQLAlchemy 2.0 projects.

## Required Steps
- Inherit from `app.models.Base` (SQLAlchemy `DeclarativeBase`)
- Use `Mapped[type]` annotations with `mapped_column()`
- Timestamp fields: `created_at` and `updated_at` with `DateTime(timezone=True)`, `default=utc_now`, `server_default=func.now()`
- `updated_at` must also have `onupdate=utc_now`
- Composite PKs: use multiple `primary_key=True` for natural keys
- Foreign keys: always `ForeignKey("table.column", ondelete="CASCADE")`
- Never add `ON UPDATE CASCADE` to FKs
- Relationships: use `TYPE_CHECKING` guard for circular imports
- Register new model in `app/models/__init__.py` for re-export
- One model per file (exception: `TickerPriceHistory` historically in `ticker.py`)

## Anti-patterns to avoid
- Using `server_default` without Python `default` for UTC timestamps
- Adding `ON UPDATE CASCADE` to foreign key constraints
- Putting business logic in model classes
- Forgetting to update `__init__.py` when adding a new model

## Canonical example
- `app/models/ticker.py:1-85` — full model with timestamps, PK, FK, relationships, composite PK for PriceHistory
- `app/models/event.py:1-55` — composite PK, enum types, nullable currency
ENDOFFILE 2>&1
