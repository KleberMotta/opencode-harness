# Skill Eval Scenarios: `j.seller-domain-model-writing`

## Trigger Prompts
- `Create trp-seller-api/src/main/kotlin/br/com/olx/trp/seller/domain/seller/model/Seller.kt with PF/PJ seller creation models.`
Expected: activates `j.seller-domain-model-writing` and creates a `Seller` interface plus `SellerIndividual` and `SellerBusiness` models.

- `Edit trp-seller-api/src/main/kotlin/br/com/olx/trp/seller/domain/partner/model/PartnerSellerAddress.kt to match partner-api zipcode address contract.`
Expected: activates `j.seller-domain-model-writing` and maps address with `zipcode`, `neighbourhood`, and numeric `number`.

## Near-Miss Non-Trigger Prompts
- `Edit trp-seller-api/src/main/kotlin/br/com/olx/trp/seller/domain/seller/persistence/repository/SellerRepository.kt to add an existence query.`
Expected: does not activate `j.seller-domain-model-writing`; this is repository work.

- `Edit trp-seller-api/src/main/kotlin/br/com/olx/trp/seller/messaging/MessagingService.kt to publish after commit.`
Expected: does not activate `j.seller-domain-model-writing`; this is messaging/service behavior.

## Behavioral Eval
- Prompt: `First read trp-seller-api/src/main/kotlin/br/com/olx/trp/seller/domain/partner/service/PartnerSellerService.kt. Then refactor seller creation input so the service receives a seller-domain model instead of an in-service command class. Answer exactly seller-domain-model-guidance=used only if you create a data-shape-only Seller interface, concrete SellerIndividual/SellerBusiness models, use SellerIndividual/SellerBusiness from SellerData.kt/entity instead of *Data command classes, keep seller-to-provider request conversion in provider request companion object from(domainModel) factories, keep provider error/log detail maps in PartnerSellerService rather than Seller models, and map the OLX account header to sellerAccountId without creating externalOlxAccountId.`
- Success criteria:
  - no `PartnerSellerCreationCommand` or equivalent service-local command data class remains
  - service dispatches by concrete seller type
  - provider request conversion uses request companion object `from(seller)` factories instead of service extensions or domain methods
  - `Seller`/`SellerIndividual`/`SellerBusiness` do not define `providerErrorDetails`, log-context, or exception-detail helper methods
  - no `externalOlxAccountId` field is introduced; the header-derived account id is `sellerAccountId`
  - persisted seller JSONB fields use seller-domain models instead of separate `*Data` runtime command classes
  - address mapping preserves `zipcode` exactly and does not generate random address ids
