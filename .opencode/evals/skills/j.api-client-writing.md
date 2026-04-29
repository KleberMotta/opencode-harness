# Skill Eval Scenarios: `j.api-client-writing`

## Trigger Prompts
- `Create trp-seller-api/src/main/kotlin/br/com/olx/trp/seller/domain/partner/client/PartnerApiClient.kt for seller create calls to trp-partner-api.`
Expected: activates `j.api-client-writing` and uses the financial `PartnerApiClient` pattern.

- `Edit trp-seller-api/src/main/kotlin/br/com/olx/trp/seller/domain/partner/client/configuration/GatewayFeignConfiguration.kt to decode partner API errors.`
Expected: activates `j.api-client-writing` and keeps OAuth/error decoder wiring in configuration.

- `Create trp-financial-api/src/main/kotlin/br/com/olx/trp/financial/domain/seller/client/SellerApiClient.kt for a seller-api lookup endpoint.`
Expected: activates `j.api-client-writing` and keeps the Feign interface declarative with URL configured by property.

## Near-Miss Non-Trigger Prompts
- `Edit trp-seller-api/src/main/kotlin/br/com/olx/trp/seller/domain/partner/service/PartnerSellerService.kt to dispatch by seller type.`
Expected: does not require `j.api-client-writing`; this is service/domain orchestration and should trigger service/seller-domain guidance.

- `Edit trp-partner-api/src/main/kotlin/br/com/olx/trp/partner/provider/zoop/ZoopClient.kt to add a Zoop provider endpoint.`
Expected: `j.api-client-writing` can provide generic client guidance, but provider-specific skills should own provider contract details when available.

## Behavioral Eval
- Prompt: `First read trp-financial-api/src/main/kotlin/br/com/olx/trp/financial/domain/order/client/partner/PartnerApiClient.kt and its GatewayFeignConfiguration. Then create trp-seller-api/src/main/kotlin/br/com/olx/trp/seller/domain/partner/client/PartnerApiClient.kt for seller create. Answer exactly api-client-guidance=used only if the client is declarative, auth/error decoding is centralized in configuration, URL key is feign.clients.partner-api.url, PartnerApiException carries decoded remote details/retryable fields for services to reuse, and local IDs are logged in the service instead of rebuilt as remote details.`
- Success criteria:
  - raw client is declarative and does not contain auth/error translation logic
  - configuration owns OAuth/error decoder concerns
  - decoded remote `details` remain on the typed API exception; services do not rebuild them from domain models
  - URL property key is `feign.clients.partner-api.url` for Partner API
  - no direct provider client is introduced when the service should call an internal API boundary
