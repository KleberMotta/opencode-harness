---
name: j.finpy-client-writing
description: Write external provider client wrappers with typed error translation, domain value objects, and no domain logic in stakfin-financial-data
---

# Skill: FinPy Client Writing

## When this skill activates
Creating or editing `app/services/*_client.py`, `app/services/ocr_engine.py`, `app/services/pdf_renderer.py`, or any external provider/system wrapper in stakfin-financial-data.

## Required Steps
- Wrap external library/API calls (yfinance, pytesseract, pymupdf) in a dedicated client class
- For blocking external calls (pytesseract, pymupdf): wrap in `asyncio.to_thread()` to keep the async event loop free
- Return typed domain value objects, never raw library return types
- Map provider-specific exceptions to `AppError` codes through a separate mapping function
- Handle provider unavailability gracefully (timeout, rate limit, format changes)
- Document which provider columns/fields are consumed and what new provider types would be silently ignored
- Keep the client stateless (no caching logic — that belongs in the service layer)

## Anti-patterns to avoid
- Returning raw library objects (e.g., yfinance `Ticker.info`) without mapping
- Silently ignoring unknown provider columns without a warning log
- Adding business rules in the client (e.g., TTL, sentinel, pagination)
- Calling the client directly from routes or repositories
- Hardcoding provider-specific format assumptions without defensive parsing

## Canonical example
- `app/services/yfinance_client.py:1-148` — yfinance wrapper, typed return values, _fetch_actions column mapping, error translation
- `app/services/provider_errors.py` — yfinance Exception → AppError code mapping
ENDOFFILE 2>&1
