---
name: j.finpy-batching-writing
description: Write shared batch request normalization, pagination, and deduplication utilities for FastAPI services
---

# Skill: FinPy Batching Writing

## When this skill activates
Creating or editing `app/services/batching.py` or any shared batch processing helper in stakfin-financial-data.

## Required Steps
- Validate input first (page >= 1, 1 <= size <= 50, non-empty IDs)
- Parse comma-separated ID strings into lists using helper functions
- Normalize IDs to canonical form before deduplication
- Deduplicate entries before pagination (so page counts are meaningful)
- Return validated, normalized, deduplicated, and paginated entries
- Handle invalid entries gracefully: return them as `InvalidBatchRequest` entries
- Cap maximum batch size to 50 items

## Anti-patterns to avoid
- Paginating before deduplication (wastes slots with duplicates)
- Failing the entire batch when one ID is invalid (return errors inline)
- Validating IDs after querying (fail fast before any DB or provider call)
- Duplicating batching logic in individual services

## Canonical example
- `app/services/batching.py:1-93` — prepare_paged_batch_requests, _validate_*, _coerce_*, _prepare_*, pagination calculation
ENDOFFILE 2>&1
