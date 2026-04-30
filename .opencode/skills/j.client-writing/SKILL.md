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

## Client DTO Package Structure

Client request and response DTOs MUST live in `request/` and `response/` sub-packages directly under the client package — NEVER in a `model/` package. The `model/` package is reserved for domain models (value objects, enums, entities).

### Correct structure

```
domain/{domain}/client/
├── {ServiceName}Client.kt          (Feign interface)
├── configuration/                   (auth, error decoder, qualifiers)
├── request/                         (outbound DTOs sent to the external API)
│   └── {Purpose}Request.kt
└── response/                        (inbound DTOs received from the external API)
    └── {Purpose}Response.kt
```

### Examples

```
domain/financial/client/
├── FinancialApiClient.kt
└── response/
    └── SellerDeleteValidationResponse.kt

domain/order/client/partner/
├── PartnerApiClient.kt
├── request/
│   ├── PartnerCashoutRequest.kt
│   └── PartnerPixPaymentRequest.kt
└── response/
    ├── PartnerCashoutResponse.kt
    └── PartnerSellerCreditDebitResponse.kt
```

### Rules

- **Response package**: `domain/{domain}/client/response/` — for DTOs representing what the external API returns.
- **Request package**: `domain/{domain}/client/request/` — for DTOs representing what we send to the external API. Omit if the client only uses path/query params (GET-only clients).
- **Naming**: `{Integration}{Purpose}Response.kt` / `{Integration}{Purpose}Request.kt`
- **Never** place client DTOs in `domain/{domain}/model/` — that package is for domain models unrelated to client contracts.
- Each client owns its own `request/` and `response/` folders (not shared across clients).

## Mock Controller Requirement

When creating a new Feign client, you MUST also create a corresponding mock controller if one does not already exist. Mocks enable integration tests and local development without external dependencies.

### Pattern

```kotlin
@Hidden
@Profile("dev", "test", "preprod")
@RestController
@RequestMapping("/mock")
class {ServiceName}MockController {

  private val logger = KotlinLogging.logger {}

  @GetMapping("/{service-path-prefix}/v1/...")
  fun endpointName(@PathVariable id: String): ResponseType {
    logger.info { "Mock {SERVICE} called with id=$id" }

    // Magic IDs for controlled test scenarios
    if (id == MAGIC_ID_ERROR) throw SomeException(...)
    if (id == MAGIC_ID_SCENARIO_A) return ResponseType(fieldA = true)

    // Default happy-path response
    return ResponseType(fieldA = false)
  }
}

private const val MAGIC_ID_ERROR = "00000000-0000-0000-0000-00000000ffff"
private const val MAGIC_ID_SCENARIO_A = "00000000-0000-0000-0000-00000000fffe"
```

### Rules

- **Location**: `src/main/kotlin/br/com/olx/trp/{service}/web/mock/{ServiceName}MockController.kt`
- **Naming**: `{ExternalServiceName}MockController` (e.g., `FinancialApiMockController`, `PartnerApiMockController`)
- **Profiles**: Always `@Profile("dev", "test", "preprod")` — never active in production
- **Base path**: Always `@RequestMapping("/mock")` — all mocks share the `/mock` prefix
- **Endpoint paths**: Mirror the real external API path structure after the `/mock` prefix, including the Feign client's `path` attribute (e.g., `/mock/financial/v1/...` for a client with `path = "/financial"`)
- **Documentation**: Always annotate with `@Hidden` to exclude from Swagger/OpenAPI
- **Response strategy**: Use magic IDs (well-known constants) to trigger error scenarios, edge cases, or specific test fixtures. Default response should be the happy-path.
- **Error handling**: If the mock needs to simulate errors from the external service, throw the corresponding domain exception (e.g., `PartnerApiException`). If multiple mock controllers exist, add a shared `MockControllerErrorConfiguration` (`@RestControllerAdvice` scoped to the mock package).
- **Config wiring**: Update `application-dev.yml` to point the Feign client URL to the local mock (e.g., `http://localhost:{port}/mock`). The Feign client's `path` attribute completes the route.
- **Logging**: Always log the mock call with identifying parameters for debugging.

### Checklist (when adding a new client)

1. [ ] Create the Feign client interface
2. [ ] Create the mock controller at `web/mock/{ServiceName}MockController.kt`
3. [ ] Wire `application-dev.yml` URL to `http://localhost:{port}/mock`
4. [ ] Verify mock scenarios cover: happy path, error path, and any edge cases the service handles
5. [ ] If this is the second+ mock in the repo, ensure `MockControllerErrorConfiguration` exists or error handling is consistent

## Anti-patterns to avoid
- Calling Feign clients directly from controllers.
- Mixing provider error translation into controller advice or unrelated domain services.
- Hard-coding provider URLs, credentials, or headers inside business code.
- Adding `consumes`/`produces` annotations to Feign methods unless a nearby canonical client does so for that exact integration.
- Creating a new Feign client without a corresponding mock controller for local/test environments.
- Placing client request/response DTOs in a `model/` package — use `client/request/` and `client/response/` sub-packages instead.

## Canonical examples
- `src/main/kotlin/br/com/olx/trp/partner/provider/storagecardtoken/StorageCardTokenClient.kt`
- `src/main/kotlin/br/com/olx/trp/partner/provider/storagecardtoken/StorageCardTokenService.kt`
- `src/main/kotlin/br/com/olx/trp/partner/provider/zoop/ZoopClient.kt`
