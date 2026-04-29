# Skill Eval Scenarios: `j.service-writing`

## Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/partner/domain/payment/service/card/CardPreAuthorizePaymentRequestService.kt to persist a new additive card snapshot field after a successful provider lookup.`
Expected: activates `j.service-writing` and preserves constructor injection, lock-before-mutate access, and explicit idempotent guards.

- `Create src/main/kotlin/br/com/olx/trp/partner/domain/cashout/service/ProviderCashoutRetryService.kt to recover an existing Zoop cashout before creating a new one.`
Expected: activates `j.service-writing` and keeps the recovery and persistence flow explicit inside the service.

- `Edit src/main/kotlin/br/com/olx/trp/seller/domain/partner/service/PartnerSellerService.kt to dispatch partner seller creation by concrete seller type.`
Expected: activates `j.service-writing` and avoids declaring command data classes or conversion extension functions inside the service.

## Near-Miss Non-Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/partner/web/controller/payment/PaymentController.kt to expose a new snapshot route.`
Expected: does not activate `j.service-writing`; this is controller-boundary work.

- `Edit src/main/kotlin/br/com/olx/trp/partner/provider/storagecardtoken/StorageCardTokenClient.kt to add a query param.`
Expected: does not activate `j.service-writing`; this is client-contract work.

## Behavioral Eval
- Prompt: `First read src/main/kotlin/br/com/olx/trp/partner/domain/payment/service/card/SamplePartnerService.kt so any service guidance can trigger. Then create that file for a provider-backed payment flow. Answer exactly service-guidance=used only if you keep constructor injection, an explicit idempotent guard, and the provider orchestration inside the service.`
- Success criteria:
  - the created file is a Spring service with constructor injection
  - the method checks a duplicate or already-processed condition explicitly before mutating state
  - provider orchestration stays in the service instead of the controller or utility layer
  - service inputs are domain models/interfaces rather than service-local command DTOs
  - the `// skill-marker: service-writing` line is present above the class declaration
