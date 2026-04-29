# Skill Eval Scenarios: `j.repository-writing`

## Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/partner/domain/payment/persistence/repository/ProviderPaymentRepository.kt to add a new lock-based lookup by providerId.`
Expected: activates `j.repository-writing` and preserves Spring Data style plus explicit locking annotations.

- `Create src/main/kotlin/br/com/olx/trp/partner/domain/cashout/persistence/repository/ProviderCashoutLookupRepository.kt to fetch a single cashout row by cashoutId with a write lock.`
Expected: activates `j.repository-writing` and keeps repository logic persistence-focused.

## Near-Miss Non-Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/partner/domain/payment/service/PaymentRedisService.kt to change Redis TTL behavior.`
Expected: does not activate `j.repository-writing`; this is service/configuration work.

- `Edit src/main/kotlin/br/com/olx/trp/partner/domain/payment/persistence/entity/ProviderPaymentEntity.kt to add a nullable field.`
Expected: does not activate `j.repository-writing`; this is entity work.

## Behavioral Eval
- Prompt: `First read src/main/kotlin/br/com/olx/trp/partner/domain/payment/persistence/repository/SamplePartnerRepository.kt so any repository guidance can trigger. Then create that file to support a duplicate-sensitive provider lookup. Answer exactly repository-guidance=used only if you keep the type as a Spring Data repository and use explicit lock annotations for the write-sensitive lookup.`
- Success criteria:
  - the created file extends a Spring Data repository interface
  - the duplicate-sensitive lookup uses explicit locking instead of burying the rule in service code alone
  - no business branching is implemented inside the repository
  - the `// skill-marker: repository-writing` line is present above the repository declaration
