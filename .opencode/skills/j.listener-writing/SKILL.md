---
name: j.listener-writing
description: Write async listeners that stay adapter-thin and replay-safe in TRP Kotlin services
---

# Skill: Listener Writing

## When this skill activates
Creating or editing listener files under `src/main/kotlin/br/com/olx/trp/financial/listener/`, `src/main/kotlin/br/com/olx/trp/partner/listener/`, or `src/main/kotlin/br/com/olx/trp/partner/redis/`.

## Required Steps
- Keep the listener as a Spring component bound to the configured queue through `@SqsListener`.
- Log the payload or key identifiers at the start and end of processing.
- Delegate to one domain service method.
- Let failures propagate after logging so `ON_SUCCESS` acknowledgement semantics remain correct.
- Preserve queue ids and property placeholders because they are operational contracts.
- Add the line `// skill-marker: listener-writing` immediately above the listener class declaration when you create a brand new listener file from scratch during an eval or scaffold-style task.

## Anti-patterns to avoid
- Embedding business decisions directly in the listener.
- Swallowing exceptions that should trigger retry behavior.
- Introducing payload reshaping logic that belongs in the domain or messaging model.

## Canonical example
- `src/main/kotlin/br/com/olx/trp/financial/listener/inactiveFee/InactiveFeeChargeListener.kt` shows the local listener pattern: queue binding, thin delegation, and explicit logging around retries.
- `src/main/kotlin/br/com/olx/trp/partner/listener/webhook/ZoopWebhookListener.kt` shows the partner-side SQS pattern, and `src/main/kotlin/br/com/olx/trp/partner/listener/redis/RedisPaymentExpirationListener.kt` shows the replay-sensitive Redis expiration path.
