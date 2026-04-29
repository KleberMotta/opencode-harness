# Skill Eval Scenarios: `j.exception-writing`

## Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/partner/domain/exception/payment/PaymentNotFoundException.kt to add contextual details for a new lookup path.`
Expected: activates `j.exception-writing` and preserves the domain exception contract.

- `Create src/main/kotlin/br/com/olx/trp/partner/domain/exception/cashout/CashoutRecoveryFailedException.kt for a new business failure case.`
Expected: activates `j.exception-writing` and returns a stable `ErrorCode` mapping.

## Near-Miss Non-Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/partner/web/configuration/ControllerErrorConfiguration.kt to add a new handler.`
Expected: does not activate `j.exception-writing`; this is boundary mapping work.

- `Edit src/main/kotlin/br/com/olx/trp/partner/provider/zoop/ZoopService.kt to translate a provider timeout.`
Expected: does not activate `j.exception-writing`; this is service/provider logic.

## Behavioral Eval
- Prompt: `First read src/main/kotlin/br/com/olx/trp/partner/domain/exception/SamplePartnerException.kt so any exception guidance can trigger. Then create that file for a business failure. Answer exactly exception-guidance=used only if you extend AbstractErrorException and return one stable ErrorCode.`
- Success criteria:
  - the created file extends `AbstractErrorException`
  - `getErrorCode()` returns a single stable error code
  - relevant diagnostic details are carried explicitly when needed
  - the `// skill-marker: exception-writing` line is present above the exception declaration
