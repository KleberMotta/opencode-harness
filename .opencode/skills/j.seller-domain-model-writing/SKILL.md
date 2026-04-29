---
name: j.seller-domain-model-writing
description: Write seller-domain models for trp-seller-api that use Seller/SellerIndividual/SellerBusiness across runtime and entity JSONB aliases, with partner request conversion via Request.from(domainModel)
---

# Skill: Seller Domain Model Writing

## When this skill activates
Creating or editing seller-domain models in `trp-seller-api`, especially `src/main/kotlin/br/com/olx/trp/seller/domain/seller/model/**/*.kt`, `Seller.kt`, `SellerIndividual`, `SellerBusiness`, `SellerBusinessRepresentative`, and adjacent partner request conversion code.

## Required Steps
- Use a small `Seller` interface for shared creation fields when code must dispatch between PF and PJ sellers; keep it as data shape only.
- Model PF/PJ variants explicitly as `SellerIndividual` and `SellerBusiness`; avoid generic `PartnerSellerCreationCommand` or service-local command bags.
- When replacing legacy `SellerIndividualData`/`SellerBusinessData`, move the model to seller-domain (`SellerIndividual`/`SellerBusiness`) and make `SellerData.kt`/entity use those models or aliases. Do not leave parallel runtime `*Data` command classes behind.
- Keep provider request conversion in the provider request `companion object` using `from(domainModel)`, following the `trp-partner-api` pattern. Do not add `toXpto()` methods to seller domain models.
- For web request to seller-domain conversion, use directional `request.toSeller(...)`; do not use `CreateSellerRequest.from(...)` when the receiver is not the request type.
- Dispatch provider creation by concrete seller type in the domain service: `SellerIndividual` to individual endpoint, `SellerBusiness` to business endpoint.
- Preserve terminology: `sellerAccountId` is the `X-Olxbr-Account-Accountid` header value and maps to `SellerEntity.accountId`; `sellerPaymentAccountId` is the local seller UUID/payment id passed to partner.
- Generate `sellerPaymentAccountId` in the request-to-seller conversion for create flows when the id is needed before persistence. Keep it non-null in seller-domain models and use the same UUID as `SellerEntity.id`.
- Model mandatory seller fields as non-null Kotlin properties. Only fields explicitly optional by business/API contract, such as `revenue`, should be nullable.
- Do not make shared `Seller` interface properties nullable just to satisfy both PF and PJ variants. Split variant-specific fields onto `SellerIndividual`/`SellerBusiness` instead.
- Avoid `requireNotNull` or `require` checks that only compensate for incorrectly nullable mandatory model properties; fix the type contract instead.
- Do not introduce `externalOlxAccountId` or any third account identifier for seller creation.
- Keep provider error context, exception details, and log-context maps in `PartnerSellerService` or adapter code, not in seller-domain models.

## Partner Address Contract
- Use the approved seller address shape in seller-domain models: `id`, `street`, numeric `number`, `complement`, `reference`, `zipcode`, `neighbourhood`, `city`, `state`.
- When mapping seller address to partner seller request, use the approved partner address shape: `id`, `street`, numeric `number`, `complement`, `zipcode`, `neighbourhood`, `city`, `state`.
- Keep `zipcode` exactly non-camel-case.
- Map seller address fields by the same names except omit `reference` from partner request.
- Do not generate random address ids in mappers; omit/null the id if no source id exists.

## Anti-patterns to avoid
- Defining runtime command `data class` types inside `*Service.kt` files.
- Hiding seller-to-provider request transformations as private service extension functions.
- Adding `toProviderRequest()`/`toXpto()` methods to domain models when the repo's conversion pattern is `ProviderRequest.from(domainModel)`.
- Adding helpers such as `providerErrorDetails()` or log/error context maps to `Seller`, `SellerIndividual`, or `SellerBusiness`.
- Adding `externalOlxAccountId` to seller models, events, DTOs, logs, or partner requests when the value is actually `sellerAccountId`.
- Leaving `SellerIndividualData`/`SellerBusinessData` as the primary model names after introducing seller-domain `SellerIndividual`/`SellerBusiness`.
- Renaming persisted JSON fields as part of runtime model cleanup.
- Making all seller-domain fields nullable to ease request mapping.
- Making `sellerPaymentAccountId` nullable after the create boundary has already generated it.
- Calling `SellerEntity.id` a `sellerId` in seller creation flows when the public/payment boundary name is `sellerPaymentAccountId`.
- Adding service-local address normalization when the request-to-seller conversion is the clearer boundary for applying wallet-compatible address defaults.

## Canonical Examples
- `trp-seller-api/src/main/kotlin/br/com/olx/trp/seller/domain/seller/model/Seller.kt`
- `trp-seller-api/src/main/kotlin/br/com/olx/trp/seller/domain/partner/model/PartnerSellerAddress.kt`
- `trp-seller-api/src/main/kotlin/br/com/olx/trp/seller/domain/partner/service/PartnerSellerService.kt`
