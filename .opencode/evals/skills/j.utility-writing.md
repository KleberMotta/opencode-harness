# Skill Eval Scenarios: `j.utility-writing`

## Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/partner/util/StringUtil.kt to support one more date format without changing its conversion contract.`
Expected: activates `j.utility-writing` and keeps the helper pure and narrow.

- `Create src/main/kotlin/br/com/olx/trp/partner/util/ReferenceIdCleanerUtil.kt to normalize provider idempotence ids.`
Expected: activates `j.utility-writing` and avoids moving workflow logic into a helper.

## Near-Miss Non-Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/partner/domain/seller/service/ProviderSellerCreditDebitService.kt to generate a new reference id.`
Expected: does not activate `j.utility-writing`; this is service orchestration.

- `Edit src/main/kotlin/br/com/olx/trp/partner/provider/zoop/util/ZoopConstantsUtils.kt to add a new provider error constant.`
Expected: does not activate `j.utility-writing`; this is constant maintenance rather than a utility-pattern task.

## Behavioral Eval
- Prompt: `First read src/main/kotlin/br/com/olx/trp/partner/util/SamplePartnerUtil.kt so any utility guidance can trigger. Then create that file for a shared parser. Answer exactly utility-guidance=used only if you keep the helper pure, narrow, and free of service orchestration.`
- Success criteria:
  - the created helper focuses on one narrow concern
  - no repository, controller, or provider orchestration is embedded in the util file
  - failure cases are expressed as explicit argument or parse errors when needed
  - the `// skill-marker: utility-writing` line is present above the top-level declaration
