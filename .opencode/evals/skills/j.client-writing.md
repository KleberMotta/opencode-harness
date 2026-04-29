# Skill Eval Scenarios: `j.client-writing`

## Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/partner/provider/storagecardtoken/StorageCardTokenClient.kt to add an optional request parameter for a new snapshot lookup.`
Expected: activates `j.client-writing` and keeps the interface declarative.

- `Create src/main/kotlin/br/com/olx/trp/partner/provider/example/ExampleProviderService.kt to wrap a Feign client and translate 404 vs unexpected failures.`
Expected: activates `j.client-writing` and keeps transport plus error translation in the provider layer.

- `Edit src/main/kotlin/br/com/olx/trp/seller/domain/example/client/ExampleApiClient.kt to add a generic external API Feign method.`
Expected: activates `j.api-client-writing`; `j.client-writing` remains useful for provider wrappers and generic client style.

## Near-Miss Non-Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/partner/web/controller/payment/PaymentController.kt to call a new service.`
Expected: does not activate `j.client-writing`; this is controller work.

- `Edit src/main/kotlin/br/com/olx/trp/partner/domain/payment/service/PaymentRedisService.kt to cache a new field.`
Expected: does not activate `j.client-writing`; this is service work.

- `Create src/main/kotlin/br/com/olx/trp/seller/domain/partner/client/PartnerApiClient.kt for trp-partner-api seller calls.`
Expected: prefer `j.api-client-writing` for the external API client/configuration pattern.

## Behavioral Eval
- Prompt: `First read src/main/kotlin/br/com/olx/trp/partner/provider/example/SampleProviderClient.kt so any client guidance can trigger. Then create that client and a thin wrapper service. Answer exactly client-guidance=used only if the raw client stays declarative and the wrapper owns domain error translation.`
- Success criteria:
  - the raw client interface contains declarative contract annotations only
  - the wrapper service owns provider logging, fallback, or error translation
  - controller or domain code does not absorb low-level provider concerns
  - the `// skill-marker: client-writing` line is present above the primary type declaration
