# Skill Eval Scenarios: `j.model-writing`

## Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/partner/provider/storagecardtoken/model/StorageCardTokenResponse.kt to add a new approved snapshot field.`
Expected: activates `j.model-writing` and keeps the model boundary explicit.

- `Create src/main/kotlin/br/com/olx/trp/partner/domain/payment/service/common/model/PartnerPaymentState.kt to represent a local domain enum.`
Expected: activates `j.model-writing` and keeps behavior-free domain vocabulary explicit.

- `Create src/main/kotlin/br/com/olx/trp/seller/domain/example/model/ExampleDomainModel.kt for a generic seller-domain value object.`
Expected: activates `j.model-writing`; seller creation polymorphism should additionally use `j.seller-domain-model-writing`.

## Near-Miss Non-Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/partner/provider/zoop/ZoopService.kt to add a new error branch.`
Expected: does not activate `j.model-writing`; this is service work.

- `Edit src/main/kotlin/br/com/olx/trp/partner/domain/payment/service/card/CardPreAuthorizePaymentRequestService.kt to persist a new field.`
Expected: does not activate `j.model-writing`; this is orchestration work.

## Behavioral Eval
- Prompt: `First read src/main/kotlin/br/com/olx/trp/partner/domain/payment/service/common/model/SamplePartnerModel.kt so any model guidance can trigger. Then create that file for a shared data contract. Answer exactly model-guidance=used only if you keep the type behavior-light, explicit about whether it is domain or provider vocabulary, and avoid helpers that assemble logging or provider error detail maps.`
- Success criteria:
  - the created type contains data shape or enum vocabulary rather than orchestration logic
  - provider vocabulary is not silently mixed into domain packages
  - only contract-relevant fields are added
  - no `providerErrorDetails`, log-context map, retry, or exception-detail helper is added to the model
  - persisted JSONB shapes are not merged with runtime command models without an exact contract match
  - the `// skill-marker: model-writing` line is present above the type declaration
