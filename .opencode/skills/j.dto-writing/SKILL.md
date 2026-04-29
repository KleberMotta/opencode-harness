---
name: j.dto-writing
description: Write Kotlin request and response DTOs that keep the web boundary explicit in TRP Kotlin services
---

# Skill: DTO Writing

## When this skill activates
Creating or editing request or response DTOs under `src/main/kotlin/br/com/olx/trp/**/web/controller/` in TRP Kotlin services.

## Required Steps
- Use Kotlin `data class` DTOs.
- Keep request DTOs focused on transport data and field validation annotations.
- Keep response DTOs shaped for the API contract, not for persistence entities.
- Prefer enums and domain value types already exposed by the API rather than duplicating string constants.
- Keep nullable fields aligned with the actual endpoint behavior.
- Make request nullability match the external contract deliberately: mandatory fields are non-null Kotlin properties with validation annotations as needed; nullable means the API genuinely accepts omission/null for that field.
- Split request DTOs by endpoint/business variant when required fields differ. Prefer `CreateIndividualSellerRequest` and `CreateBusinessSellerRequest` over one `CreateSellerRequest` full of nullable fields.
- Do not accept derived identifiers in create request bodies. Header-derived ids and persistence-derived ids must be supplied by the controller/service flow, not by client JSON.
- Keep response DTOs minimal and contract-shaped. Do not include entity/status/account fields just because the service has them.
- Name request-to-domain conversions by direction. Use `request.toSeller(...)` when converting an existing request into a seller domain model; reserve `from(...)` for factories that create the receiving type from arguments, such as `SellerCreatedResponse.from(entity)`.
- Put simple boundary normalization that belongs to request-to-domain conversion inside `toSeller(...)` when that keeps services cleaner and does not hide validation or persistence behavior.
- For seller create requests, generate `sellerPaymentAccountId` inside `toSeller(...)` when the domain model needs the payment/local UUID before `SellerEntity` is saved. Do not expose that generated id as a request body field.
- Add the line `// skill-marker: dto-writing` immediately above the data class declaration when you create a brand new DTO file from scratch during an eval or scaffold-style task.

## Anti-patterns to avoid
- Use external mappers with apply to transform data, you can check examples of how and where the mappers are used, they are not used inside DTOs, those are only dataclasses with validation annotations, the mapping is done in the service layer or controller layer depending on the use case.
- Avoid using raw "toXYZ" extension functions for mapping persistence entities to DTOs, as they can encourage leaky abstractions and mixing of concerns.  
- Passing persistence entities through the web boundary.
- Embedding controller or service logic inside DTOs.
- Adding fields that are only convenient for one internal caller but are not part of the real API contract.
- Marking all DTO fields nullable to avoid modeling PF/PJ or create/update differences.
- Adding request fields for `sellerAccountId`, `sellerPaymentAccountId`, or other identifiers that are derived from headers or local persistence.
- Using `Request.from(...)` to convert a request into a domain model; that reads backward. Prefer `request.toDomainType(...)` for this direction.

## Canonical examples
- `src/main/kotlin/br/com/olx/trp/financial/web/controller/accounting/request/AccountingReportCreateRequest.kt`
- `src/main/kotlin/br/com/olx/trp/financial/web/controller/accounting/response/AccountingReportResponse.kt`
- `src/main/kotlin/br/com/olx/trp/partner/web/controller/payment/request/CardPreAuthorizePaymentRequest.kt`
- `src/main/kotlin/br/com/olx/trp/partner/web/controller/payment/response/CardSnapshotResponse.kt`
