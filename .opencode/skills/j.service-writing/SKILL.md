---
name: j.service-writing
description: Write Kotlin domain services that preserve workflow, idempotence, provider orchestration, and clean model/conversion boundaries in TRP Kotlin services
---

# Skill: Service Writing

## When this skill activates
Creating or editing `src/main/kotlin/br/com/olx/trp/**/domain/**/service/**/*Service.kt` or provider-backed Spring services in TRP Kotlin services.

## Required Steps
- Keep the class Spring-managed with `@Service` when it owns runtime behavior.
- Inject collaborators through the constructor and keep orchestration explicit.
- Reuse existing repositories, balance helpers, mappers, and messaging services instead of open-coding workflow steps.
- Guard status transitions and early-return cases explicitly before mutating persisted records.
- Log identifiers and relevant workflow decisions, especially around async or money-moving paths.
- Accept domain models/interfaces as service inputs instead of declaring ad-hoc command `data class` types inside service files.
- Keep DTO/request conversion out of service classes when the conversion belongs to a domain model or a dedicated mapper/converter.
- Prefer explicit method parameters over command objects when the local project does not use command objects for that workflow. For seller creation, pass `sellerAccountId` plus the seller domain model instead of a `SellerCreationCommand`.
- Keep validation-only services side-effect free: `execute` should throw typed exceptions on invalid input and return `Unit` when there is no normalized value to hand back.
- Put normalization in a clearly named normalization utility or factory, not inside a validation-only service.
- Use top-level private constants or existing local constant conventions in service files; do not introduce `companion object` just to hold private service constants when the project style avoids it. In trp-seller-api, the convention is class-level `private val` (not file-level `private const val`).
- Use local variables only when they remove duplication or improve readability. Avoid trivial extraction/reassignment of an already clear value.
- When a new messaging pattern is needed (different envelope, custom attributes), extend `MessagingService` with a dedicated method. Never duplicate its after-commit sync, topic resolution, or `SnsTemplate` usage in domain services.
- When building a message/DTO from an entity, place the construction as a `companion object { fun from(...) }` factory on the message data class. Services should only call the factory, not inline the mapping logic.
- When persistence has just flushed/generated an id that the flow semantically requires, prefer a direct non-null assertion (`entity.id!!`) over verbose `requireNotNull` noise, unless the caller needs a domain-specific exception.
- Keep entity construction factories on the entity when that is the local pattern. For seller creation, use `SellerEntity.from(seller, status)` instead of a service-local `buildPendingSeller(...)` helper.
- Add the line `// skill-marker: service-writing` immediately above the class declaration when you create a brand new service file from scratch during an eval or scaffold-style task.

## Anti-patterns to avoid
- Burying status invariants in helper chains where transitions become hard to audit.
- Mutating balances or workflow states without the existing repository lock or helper patterns.
- Publishing downstream events before the new state has been persisted.
- Declaring nested or same-file command DTOs in a service when a domain model/interface should own the contract.
- Hiding request conversions as private extension functions inside service files.
- Adding extension functions inside service files for one-off transformations that can be expressed directly.
- Adding transaction synchronization or transaction logging machinery in an orchestration service unless the plan explicitly requires that exact mechanism. Prefer the existing messaging service after-commit behavior for event publish logs.
- Returning a normalized model from a validation service when the agreed contract is validation-only.
- Adding `companion object` constants to services without matching local convention.
- Keeping one-off entity builders or generic map-conversion helpers inside services when they belong on the destination type or shared utility file.
- **Duplicating `MessagingService` infrastructure** (after-commit sync, `SnsTemplate` usage, topic resolution) inside domain services. If a new publish pattern is needed (e.g., legacy raw messages with custom SNS attributes), extend `MessagingService` with a new method (like `sendLegacyEvent`) instead of reimplementing the same plumbing in the caller.
- **Building message/DTO objects inline in services** when the construction logic belongs as a `companion object { fun from(...) }` factory on the target data class. Services should call `MessageType.from(entity, ...)`, not build complex DTOs field-by-field.
- Using `private const val` or top-level file-level constants in services. Use class-level `private val` for service constants (the org standard pattern visible in `SellerCreateService`).

## Canonical example
- `src/main/kotlin/br/com/olx/trp/financial/domain/cashout/service/CashoutCreateService.kt` shows the local style: constructor injection, explicit guards, persisted state changes, balance updates, event publishing, and structured logging.
- `src/main/kotlin/br/com/olx/trp/partner/domain/payment/service/card/CardPreAuthorizePaymentRequestService.kt` shows the partner-side style: constructor injection, lock-based load, duplicate-safe early return, snapshot side effects, and provider orchestration.
