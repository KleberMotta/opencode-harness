# API Patterns

Keep request handling thin and move business decisions into reusable services.

## Rules

- Parse and validate request input at the boundary
- Normalize success and error responses
- Keep transport concerns out of domain services
- Document authentication and failure modes for each endpoint
