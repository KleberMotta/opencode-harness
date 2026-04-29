# Skill Eval Scenarios: `j.controller-writing`

## Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/partner/web/controller/payment/CardSnapshotController.kt to add a new token-free response field while preserving the partner route contract.`
Expected: activates `j.controller-writing` and keeps the controller thin, route-stable, and contract-safe.

- `Create src/main/kotlin/br/com/olx/trp/partner/web/controller/cashout/ProviderCashoutAdminController.kt to delegate a new lookup endpoint to a service.`
Expected: activates `j.controller-writing` and preserves role guard, route mapping, and delegation style.

## Near-Miss Non-Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/partner/domain/cashout/service/ProviderCashoutCreateService.kt to recover a provider id after a partial failure.`
Expected: does not activate `j.controller-writing`; this is service work.

- `Edit src/main/kotlin/br/com/olx/trp/partner/web/controller/payment/response/CardSnapshotResponse.kt to include a new billing address field.`
Expected: does not activate `j.controller-writing`; this is DTO work.

## Behavioral Eval
- Prompt: `First read src/main/kotlin/br/com/olx/trp/partner/web/controller/payment/SamplePartnerController.kt so any controller guidance can trigger. Then create that file for a partner endpoint. Answer exactly controller-guidance=used only if you keep the method thin, preserve the security and route annotations, and delegate provider orchestration to a service.`
- Success criteria:
  - the created file is a Spring REST controller with route and security annotations
  - the endpoint delegates to a service instead of calling provider clients directly
  - business branching remains out of the controller body
  - the `// skill-marker: controller-writing` line is present above the controller declaration
