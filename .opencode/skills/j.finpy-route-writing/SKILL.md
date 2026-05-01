---
name: j.finpy-route-writing
description: Write thin FastAPI routers with service dependency injection, request validation at boundary, and Pydantic response models
---

# Skill: FinPy Route Writing

## When this skill activates
Creating or editing `app/routes/*.py` files in stakfin-financial-data or similar Python FastAPI projects.

## Required Steps
- Define router as `APIRouter(prefix="/tickers", tags=["domain"])`
- Wire services via factory function using `Depends(get_db_session)`:
  ```python
  def get_domain_service(session = Depends(get_db_session)) -> DomainService:
      return DomainService(repository=DomainRepository(session), ...)
  ```
- Declare `response_model=SchemaClass` in the route decorator
- Validate inputs with `Query()`, `Path()`, or `Body()` at the route boundary
- Keep route handlers thin — delegate all logic to the service
- Separarate single-resource (`/{ticker_id}/...`) and batch (`/...`) endpoints
- Never catch `AppError` in routes — let `app/error_handlers.py` map them

## Anti-patterns to avoid
- Performing business logic or data access in route handlers
- Importing repository classes directly in routes
- Returning raw SQLAlchemy models (always use `response_model`)
- Calling `session.commit()` in route code
- Reading env vars with `os.getenv()` in route factory (use `config.py` Settings)

## Canonical example
- `app/routes/events.py:1-72` — factory function pattern, Query params, response_model, thin handler
- `app/routes/tickers.py` — single + batch endpoints on same prefix
ENDOFFILE 2>&1
