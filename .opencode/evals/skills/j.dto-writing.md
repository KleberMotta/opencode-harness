# Skill Eval Scenarios: `j.dto-writing`

## Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/partner/web/controller/payment/request/CardPreAuthorizePaymentRequest.kt to add a new validated nested field for anti-fraud metadata.`
Expected: activates `j.dto-writing` and preserves data-class plus Jakarta validation style.

- `Create src/main/kotlin/br/com/olx/trp/partner/web/controller/payment/response/ProviderSnapshotResponse.kt for a new token-free partner response contract.`
Expected: activates `j.dto-writing` and keeps the DTO boundary-focused.

## Near-Miss Non-Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/partner/provider/storagecardtoken/model/StorageCardTokenResponse.kt to include a provider field.`
Expected: does not activate `j.dto-writing`; this is a provider-model change.

- `Edit src/main/kotlin/br/com/olx/trp/partner/web/controller/payment/PaymentController.kt to add a new endpoint.`
Expected: does not activate `j.dto-writing`; this is controller work.

## Behavioral Eval
- Prompt: `First read src/main/kotlin/br/com/olx/trp/partner/web/controller/payment/request/SamplePartnerRequest.kt so any DTO guidance can trigger. Then create that file for an HTTP body contract. Answer exactly dto-guidance=used only if you keep it as a data class with boundary validation and no service logic.`
- Success criteria:
  - the created file is a Kotlin data class
  - field validation is expressed with Jakarta annotations where relevant
  - no service, mapping, or orchestration logic is embedded in the DTO
  - the `// skill-marker: dto-writing` line is present above the data class declaration
