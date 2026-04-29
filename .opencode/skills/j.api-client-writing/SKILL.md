---
name: j.api-client-writing
description: Write external API Feign clients in TRP Kotlin services with declarative interfaces, centralized auth/configuration, typed error decoding, and service-level exception translation
---

# Skill: API Client Writing

## When this skill activates
Creating or editing external API clients, Feign client configuration, or typed client exceptions in TRP Kotlin services, especially files named `*ApiClient.kt`, `*Client.kt`, `*FeignConfiguration.kt`, `GatewayFeignConfiguration.kt`, `*ApiException.kt`, or `*ApiErrorResponse.kt`.

## Required Steps
- Keep raw client interfaces declarative with route, path, request-param, path-variable, header, and body annotations only.
- Put auth interceptors, OAuth wiring, qualifiers, retry/error decoder beans, and object-mapper parsing in configuration classes, not in the client interface.
- Decode structured remote error bodies into small `*ApiErrorResponse` DTOs and wrap them in typed `*ApiException` classes when services need retryability, error codes, or remote details.
- Keep decoded remote `details` on the typed client exception; services should reuse those remote details and log local correlation ids separately.
- Let undecodable remote failures fall back to `FeignException.errorStatus` unless the local client has a stronger canonical fallback.
- Translate typed client exceptions in the service/adapter that owns the workflow decision; controllers should not translate outbound client failures.
- Configure URLs with service-owned `feign.clients.<api-name>.url` properties and avoid hardcoded URLs or credentials. Follow the repository's profile split; TRP services commonly keep concrete client URLs in `application-dev.yml`, `application-preprod.yml`, and `application-prod.yml`, not base `application.yml`.

## Partner API Specialization
- Use the canonical client name `PartnerApiClient` for a service's primary `trp-partner-api` Feign boundary.
- Follow the `trp-financial-api` pattern: `@FeignClient(name = "partner-api", url = "\${feign.clients.partner-api.url}", configuration = [GatewayFeignConfiguration::class], path = "/partner")`.
- Follow the `trp-financial-api` profile config pattern: define `feign.clients.partner-api.url` in `application-dev.yml`, `application-preprod.yml`, and `application-prod.yml` using `GATEWAY_API_URL` or `ISSUER_HOST` as appropriate.
- Put full API routes on methods, for example `@PostMapping("/v1/sellers/individual")`; do not move `/v1` into the Feign `path` when following the financial pattern.
- Do not declare `consumes` or `produces` on Partner API Feign methods unless the local canonical client already does so for that exact endpoint.
- Keep `202 Accepted`/void endpoints as Kotlin `Unit`/no explicit return type unless the API returns a body.

## Anti-patterns to avoid
- Mixing auth, error decoding, fallback, or domain translation into the raw client interface.
- Duplicating OAuth interceptors or error decoders per endpoint.
- Rebuilding remote exception details in domain models or from service input when the decoder already parsed remote `details`.
- Translating outbound client errors in controllers.
- Calling provider-specific clients directly from services that should go through an internal API boundary.

## Canonical Examples
- `trp-financial-api/src/main/kotlin/br/com/olx/trp/financial/domain/order/client/partner/PartnerApiClient.kt`
- `trp-financial-api/src/main/kotlin/br/com/olx/trp/financial/domain/order/client/configuration/GatewayFeignConfiguration.kt`
- `trp-financial-api/src/main/kotlin/br/com/olx/trp/financial/domain/order/client/configuration/PartnerApiException.kt`
- `trp-financial-api/src/main/kotlin/br/com/olx/trp/financial/domain/seller/client/SellerApiClient.kt`
- `trp-financial-api/src/main/kotlin/br/com/olx/trp/financial/domain/seller/configuration/SellerClientConfiguration.kt`
