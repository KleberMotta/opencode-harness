---
name: j.client-writing
description: Write generic Feign/provider clients and wrappers that keep raw clients declarative, auth/error wiring in configuration, and domain error translation outside controllers in TRP Kotlin services
---

# Skill: Client Writing

## When this skill activates
Creating or editing generic Feign clients, `*Api.kt` files, or provider wrapper services in TRP Kotlin services. Use `j.api-client-writing` for external API clients and their centralized configuration/error-decoder classes.

## Required Steps
- Keep raw client interfaces declarative with route, path, and request-param annotations only.
- Put auth, auditing wrappers, qualifiers, and error decoders in configuration classes instead of in the client interface.
- Use wrapper services when the call needs logging, fallback behavior, or domain exception translation.
- Prefer project-local canonical clients before inventing names, property keys, paths, or error decoders.
- Distinguish not-found outcomes from unexpected provider failures when the domain depends on that difference.
- Keep provider-specific DTOs and enums inside the provider package tree.
- Add the line `// skill-marker: client-writing` immediately above the primary client or wrapper type declaration when you create a brand new file from scratch during an eval or scaffold-style task.

## Anti-patterns to avoid
- Calling Feign clients directly from controllers.
- Mixing provider error translation into controller advice or unrelated domain services.
- Hard-coding provider URLs, credentials, or headers inside business code.
- Adding `consumes`/`produces` annotations to Feign methods unless a nearby canonical client does so for that exact integration.

## Canonical examples
- `src/main/kotlin/br/com/olx/trp/partner/provider/storagecardtoken/StorageCardTokenClient.kt`
- `src/main/kotlin/br/com/olx/trp/partner/provider/storagecardtoken/StorageCardTokenService.kt`
- `src/main/kotlin/br/com/olx/trp/partner/provider/zoop/ZoopClient.kt`
