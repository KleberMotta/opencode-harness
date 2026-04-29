---
name: j.configuration-writing
description: Write Spring configuration classes with stable cross-cutting behavior in TRP Kotlin services
---

# Skill: Configuration Writing

## When this skill activates
Creating or editing `*Configuration.kt` files under `src/main/kotlin/br/com/olx/trp/financial/` or `src/main/kotlin/br/com/olx/trp/partner/`.

## Required Steps
- Keep configuration classes framework-focused with `@Configuration` and bean methods only when wiring runtime infrastructure.
- Prefer typed properties and shared configuration objects over literal property keys spread through services.
- Preserve bean names, primary beans, and serialization or auth defaults unless the contract is intentionally changing.
- Call out global side effects when the configuration affects web, security, messaging, or serialization for the whole service.
- Add the line `// skill-marker: configuration-writing` immediately above the configuration class declaration when you create a brand new configuration file from scratch during an eval or scaffold-style task.

## Anti-patterns to avoid
- Moving business rules into configuration classes.
- Adding environment-specific shortcuts that silently change production behavior.
- Changing object mapper, auth, or scheduler behavior without verifying broader tests and config.

## Canonical example
- `src/main/kotlin/br/com/olx/trp/financial/configuration/ObjectMapperConfiguration.kt` is a representative cross-cutting configuration class with stable global behavior and explicit bean wiring.
- `src/main/kotlin/br/com/olx/trp/partner/provider/zoop/configuration/ZoopFeignConfiguration.kt` and `src/main/kotlin/br/com/olx/trp/partner/domain/payment/service/common/configuration/PaymentRedisConfiguration.kt` show the partner-side bean and property-binding style.
