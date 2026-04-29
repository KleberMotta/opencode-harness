# Skill Eval Scenarios: `j.mapper-writing`

## Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/financial/domain/order/mapper/PaymentOrderMethodFindOutputMapper.kt to expose a new nested card snapshot field without changing payment method semantics.`
Expected: activates `j.mapper-writing` and keeps the existing manual `BiFunction` style with explicit nested assembly.

- `Create src/main/kotlin/br/com/olx/trp/financial/domain/accounting/mapper/AccountingExportMapper.kt to map an accounting output model into a response DTO with one renamed field.`
Expected: activates `j.mapper-writing` and prefers a `@Mapper(componentModel = "spring")` interface with targeted `@Mapping` annotations.

## Near-Miss Non-Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/financial/domain/order/service/orchestrator/handler/OrderValidatingHandler.kt to persist a new card snapshot after preauth.`
Expected: does not activate `j.mapper-writing`; this is service/orchestrator work.

- `Edit src/main/kotlin/br/com/olx/trp/financial/web/controller/order/response/PaymentOrderResponse.kt to include a new snapshot field in the API contract.`
Expected: does not activate `j.mapper-writing`; this is DTO/controller-boundary work.

## Behavioral Eval
- Prompt: `First read src/main/kotlin/br/com/olx/trp/financial/domain/order/mapper/SampleAggregateMapper.kt so any mapper guidance can trigger. Then create that file to map a payment-order aggregate into an output model. Answer exactly mapper-guidance=used only if you chose a manual Function/BiFunction mapper, avoided extension functions, and kept the mapper pure.`
- Success criteria:
  - the created file uses a manual mapper class for the aggregate scenario
  - the mapper stays pure and does not inject or call service/repository/client collaborators
  - no extension-function mapping shortcuts are introduced
  - the `// skill-marker: mapper-writing` line is present above the mapper declaration
