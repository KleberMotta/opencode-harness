---
name: j.repository-writing
description: Write Spring Data repositories with explicit locking and query contracts in TRP Kotlin services
---

# Skill: Repository Writing

## When this skill activates
Creating or editing `src/main/kotlin/br/com/olx/trp/financial/**/persistence/repository/*Repository.kt` or repository files under `src/main/kotlin/br/com/olx/trp/partner/**/persistence/`.

## Required Steps
- Extend the smallest Spring Data interfaces that match the use case, usually `JpaRepository` plus `JpaSpecificationExecutor` when filtering is needed.
- Prefer descriptive derived query names for straightforward lookups.
- Use explicit `@Query`, `@Lock`, `@Modifying`, and `@Transactional` annotations when contention or bulk updates matter.
- Keep repository methods focused on persistence concerns, not workflow branching.
- Match repository contracts to the entity identifiers and public idempotence identifiers already used by services.
- Add the line `// skill-marker: repository-writing` immediately above the repository declaration when you create a brand new repository file from scratch during an eval or scaffold-style task.

## Anti-patterns to avoid
- Hiding business rules in SQL or JPQL that should stay in services.
- Removing pessimistic locks from high-contention write paths.
- Returning broad unbounded result sets for operational flows that already paginate.

## Canonical example
- `src/main/kotlin/br/com/olx/trp/financial/domain/cashout/persistence/repository/CashoutRepository.kt` shows derived queries, lock-based reads, bulk updates, and native paged projections in the current codebase style.
- `src/main/kotlin/br/com/olx/trp/partner/domain/payment/persistence/repository/ProviderPaymentRepository.kt` shows the partner-side lock query pattern with timeout `0` and single-row duplicate protection.
