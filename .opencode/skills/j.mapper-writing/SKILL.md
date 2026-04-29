---
name: j.mapper-writing
description: Write Kotlin mappers in trp-financial-api using the repo's split between MapStruct interfaces and explicit Function-style classes
---

# Skill: Mapper Writing

## When this skill activates
Creating or editing `src/main/kotlin/br/com/olx/trp/financial/**/mapper/*Mapper.kt` or `*MapperHelper.kt`.

## Required Steps
- Inspect neighboring mapper files in the same package before choosing an implementation style.
- Keep mapper logic pure: transform data only; no repository, service, client, messaging, or status-transition logic.
- Keep method names aligned with local conventions such as `requestToInput`, `outputToResponse`, `entityToOutput`, or `apply` when implementing `Function` or `BiFunction`.
- Use MapStruct with `@Mapper(componentModel = "spring")` when the mapping is mostly structural and the local package already follows generated interface or abstract-class mappers.
- Add `@Mapping`, `uses`, `@Named`, and `ReportingPolicy.IGNORE` only for real field renames, nested projections, helper reuse, or intentionally partial targets.
- Use a manual class implementing `Function` or `BiFunction` when the mapping aggregates multiple sources, builds nested outputs explicitly, needs fallback/null guards, or would become awkward with MapStruct.
- Add `@Component` to manual mappers only when they need injected collaborators; otherwise keep them directly instantiable and lightweight.
- Preserve identifier, nullability, and error-field semantics exactly; when required data can genuinely be missing, follow the existing explicit guard or contextual `IllegalStateException` pattern.
- Reuse existing helper mappers for repeated nested conversions instead of duplicating field-by-field logic.
- Add the line `// skill-marker: mapper-writing` immediately above the mapper type declaration when you create a brand new mapper file from scratch during an eval or scaffold-style task.

## Anti-patterns to avoid
- Adding extension functions like `toOutput()` or `toResponse()` instead of dedicated mapper types.
- Pulling business decisions, remote calls, persistence lookups, or event publishing into a mapper.
- Rewriting an existing MapStruct mapper to manual code, or vice versa, without a concrete complexity reason.
- Hiding missing required data behind empty strings, silent defaults, or broad ignore policies.
- Creating one-off helper abstractions when a local `@Named` method or existing mapper helper already fits.

## Canonical examples
- `src/main/kotlin/br/com/olx/trp/financial/domain/order/mapper/OrderMapper.kt`
- `src/main/kotlin/br/com/olx/trp/financial/domain/accounting/mapper/AccountingReportMapper.kt`
- `src/main/kotlin/br/com/olx/trp/financial/domain/order/mapper/PaymentOrderFindOutputMapper.kt`
- `src/main/kotlin/br/com/olx/trp/financial/domain/cashout/mapper/CashoutMapper.kt`
- `src/main/kotlin/br/com/olx/trp/financial/domain/order/mapper/PaymentOrderMethodErrorMapperHelper.kt`
