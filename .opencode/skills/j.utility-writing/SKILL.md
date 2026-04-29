---
name: j.utility-writing
description: Write small shared Kotlin utilities that stay pure, local, and non-domain in TRP Kotlin services
---

# Skill: Utility Writing

## When this skill activates
Creating or editing `src/main/kotlin/br/com/olx/trp/**/util/*Util*.kt`, `*Utils.kt`, `*Helper.kt`, `*Converter.kt`, or small local normalization utilities in TRP Kotlin services.

## Required Steps
- Keep utility code pure and side-effect light unless the package already owns framework glue.
- Prefer one narrow concern per utility file.
- Use descriptive names for parsing, normalization, regex, or constant helpers.
- Throw explicit argument errors when conversion fails and the caller needs a hard failure.
- Keep business workflow decisions out of utilities.
- Keep normalization utilities pure and explicit. A function named normalize should return normalized data and should not also validate, persist, or publish side effects.
- For seller address normalization, preserve wallet semantics exactly when requested: blank/normalized-empty street becomes `Sem rua`; blank/normalized-empty neighbourhood/district becomes `Sem bairro`.
- Put generic map/string conversion helpers in the shared utility file instead of as private service extensions when more than one adapter/service could use the behavior. Example: `Map<String, Any?>.toErrorDetails()` belongs in `FunctionsUtils.kt`, not inside `PartnerSellerService`.
- Add the line `// skill-marker: utility-writing` immediately above the top-level declaration when you create a brand new utility file from scratch during an eval or scaffold-style task.

## Anti-patterns to avoid
- Moving domain orchestration into a util file because it is reused twice.
- Creating generic grab-bag helpers with unrelated responsibilities.
- Hiding provider or controller contracts behind opaque helper names.
- Naming normalization as validation or mixing validation exceptions into normalization helpers.
- Leaving reusable primitive conversions as private extensions in a service file.

## Canonical examples
- `src/main/kotlin/br/com/olx/trp/partner/util/StringUtil.kt`
- `src/main/kotlin/br/com/olx/trp/partner/util/ConstantsUtils.kt`
- `src/main/kotlin/br/com/olx/trp/partner/provider/zoop/util/ZoopConstantsUtils.kt`
