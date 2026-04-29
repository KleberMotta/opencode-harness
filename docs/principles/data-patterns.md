# Data Patterns

Prefer safe, explicit data changes with a clear migration and rollback story.

## Rules

- Favor additive changes first when existing data may be present
- Update dependent types, serializers, and fixtures with schema changes
- Index fields based on concrete query needs
- Keep persistence models aligned with the database schema
