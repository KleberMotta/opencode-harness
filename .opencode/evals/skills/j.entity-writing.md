# Skill Eval Scenarios: `j.entity-writing`

## Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/partner/domain/payment/persistence/entity/ProviderPaymentEntity.kt to add a new nullable provider metadata field.`
Expected: activates `j.entity-writing` and preserves JPA metadata, enum storage, and relation style.

- `Create src/main/kotlin/br/com/olx/trp/partner/domain/webhook/persistence/ProviderWebhookDeliveryEntity.kt for a new audited persistence row.`
Expected: activates `j.entity-writing` and keeps the file persistence-focused.

## Near-Miss Non-Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/partner/domain/payment/persistence/repository/ProviderPaymentRepository.kt to add a lock query.`
Expected: does not activate `j.entity-writing`; this is repository work.

- `Edit src/main/kotlin/br/com/olx/trp/partner/domain/payment/service/card/CardPreAuthorizePaymentRequestService.kt to save a new field.`
Expected: does not activate `j.entity-writing`; this is service work.

## Behavioral Eval
- Prompt: `First read src/main/kotlin/br/com/olx/trp/partner/domain/payment/persistence/entity/SamplePartnerEntity.kt so any entity guidance can trigger. Then create that file for a new provider mapping row. Answer exactly entity-guidance=used only if you keep audit and relation annotations explicit and avoid embedding business logic in the entity.`
- Success criteria:
  - the created file is a JPA entity with explicit persistence annotations
  - enums and relations follow the local persistence style
  - the entity contains no service-style orchestration logic
  - the `// skill-marker: entity-writing` line is present above the entity declaration
