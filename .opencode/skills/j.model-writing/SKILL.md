---
name: j.model-writing
description: Write Kotlin domain/provider models and enums that keep contract shape, provider vocabulary, and domain polymorphism explicit in TRP services
---

# Skill: Model Writing

## When this skill activates
Creating or editing `src/main/kotlin/br/com/olx/trp/**/(model|enums)/*.kt` files, especially domain models that represent business variants or provider request/response shapes.

## Required Steps
- Keep models and enums focused on shared data shape, not orchestration, logging, observability, or error-context assembly.
- Prefer explicit enum names and provider-value fields when a provider vocabulary differs from the local one.
- Keep provider models in provider packages and domain models in domain packages.
- Add only the fields that are part of the real contract for this layer.
- Keep mapping or helper logic small and adjacent only when it is clearly part of the model contract; service/provider error details belong in the service or adapter that handles the failure.
- For polymorphic domain inputs, prefer a small interface plus concrete model classes over generic command bags.
- Follow local conversion conventions: if nearby code uses `Request.from(domainModel)`, do not introduce `domainModel.toRequest()` methods.
- Keep persisted JSONB subdocument model names aligned with local domain decisions; if a feature intentionally promotes `*Data` classes to domain models, update the entity aliases instead of keeping duplicate command shapes.
- Add the line `// skill-marker: model-writing` immediately above the type declaration when you create a brand new model file from scratch during an eval or scaffold-style task.

## Anti-patterns to avoid
- Smuggling service or repository behavior into models.
- Adding helpers like `providerErrorDetails()`, log-context maps, retry flags, or exception details to domain models.
- Reusing provider enums directly in domain packages when a translation boundary already exists.
- Adding convenience fields that are not part of the actual contract.
- Moving persistence-only JSON shapes into runtime domain models without an explicit local decision and matching entity alias/update.

## Canonical examples
- `src/main/kotlin/br/com/olx/trp/partner/domain/payment/service/common/model/PaymentMethod.kt`
- `src/main/kotlin/br/com/olx/trp/partner/provider/zoop/enums/ZoopStatus.kt`
- `src/main/kotlin/br/com/olx/trp/partner/provider/storagecardtoken/model/StorageCardTokenResponse.kt`
