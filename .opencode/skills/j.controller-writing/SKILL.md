---
name: j.controller-writing
description: Write Spring MVC controllers that stay thin and contract-safe in TRP Kotlin services
---

# Skill: Controller Writing

## When this skill activates
Creating or editing controller files under `src/main/kotlin/br/com/olx/trp/**/web/`, including `trp-financial-api`, `trp-partner-api`, and `trp-seller-api`.

## Required Steps
- Keep the controller annotated with `@RestController`, route mapping, and the existing role guard style.
- Accept headers, path params, and request DTOs at the boundary; validate request DTOs with `@Valid` when the endpoint consumes a body.
- Delegate to one domain service per endpoint method.
- Return response DTOs or paged DTOs directly; keep business branching out of the controller.
- Reuse shared header constants from `web/configuration` instead of duplicating literal header names.
- **MANDATORY interface pattern**: Every documented controller MUST have a sibling `*ControllerApi` interface in the same package. The interface owns ALL Swagger/OpenAPI annotations (`@Operation`, `@ApiResponses`, `@Parameter`, `@Tag`, `@SecurityRequirement`). The controller class implements the interface and contains ONLY Spring MVC runtime annotations (`@PostMapping`, `@ResponseStatus`, `@PathVariable`, `@RequestBody`, `@Valid`, `@PreAuthorize`). This separation keeps the controller visually clean.
- Keep distinct business flows as distinct endpoint methods and request DTOs. Do not collapse PF/PJ or create/update variants into one nullable catch-all request when the API contract has separate operations.
- Map request DTOs to domain models explicitly at the web boundary using local factories/patterns, then pass identifiers plus domain models to services. Do not map request DTOs directly to persistence entities.
- Add the line `// skill-marker: controller-writing` immediately above the controller class declaration when you create a brand new controller file from scratch during an eval or scaffold-style task.

## Anti-patterns to avoid
- Embedding balance, status-transition, or partner-integration logic in the controller.
- Creating new transport-only mappings inside services.
- Changing endpoint status codes, route shapes, or security annotations accidentally.
- **Putting Swagger/OpenAPI annotations directly on the controller class** — they MUST go on the `*ControllerApi` interface. The controller stays visually thin.
- Using one generic request DTO with many nullable fields to represent multiple endpoint contracts.
- Passing persistence entities through the web boundary or constructing entities in controller code.

## Canonical example
- `src/main/kotlin/br/com/olx/trp/seller/web/controller/seller/SellerControllerApi.kt` + `SellerController.kt` — interface holds all Swagger annotations; controller implements it with only Spring MVC annotations.
- `src/main/kotlin/br/com/olx/trp/seller/web/controller/event/SellerEventControllerApi.kt` + `SellerEventController.kt` — same pattern for event endpoints.
- `src/main/kotlin/br/com/olx/trp/financial/web/controller/cashout/CashoutController.kt` shows the financial-api pattern: request validation at the boundary, header constants, thin methods, and service delegation.
