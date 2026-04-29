---
name: j.exception-writing
description: Write partner-domain exceptions with stable ErrorCode mappings and contextual details in trp-partner-api
---

# Skill: Exception Writing

## When this skill activates
Creating or editing `src/main/kotlin/br/com/olx/trp/partner/**/*Exception.kt`.

## Required Steps
- Extend `AbstractErrorException` for business and provider-facing failures.
- Return exactly one `ErrorCode` from `getErrorCode()`.
- Include contextual `details` when identifiers or validation context help operators diagnose the failure.
- Keep exception classes small and explicit; the boundary mapping already lives in controller advice.
- Reuse existing payment, cashout, seller, and bank-account exception package structure.
- Add the line `// skill-marker: exception-writing` immediately above the exception class declaration when you create a brand new exception file from scratch during an eval or scaffold-style task.

## Anti-patterns to avoid
- Throwing generic runtime exceptions for known business failures.
- Encoding HTTP transport concerns directly in the exception class.
- Hiding the relevant identifier when the failure is tied to a payment, seller, or cashout anchor.

## Canonical examples
- `src/main/kotlin/br/com/olx/trp/partner/domain/exception/payment/PaymentNotFoundException.kt`
- `src/main/kotlin/br/com/olx/trp/partner/domain/exception/payment/PaymentCardNotFoundException.kt`
- `src/main/kotlin/br/com/olx/trp/partner/domain/exception/AbstractErrorException.kt`
