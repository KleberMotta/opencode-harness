# Skill Eval Scenarios: `j.configuration-writing`

## Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/partner/provider/zoop/configuration/ZoopFeignConfiguration.kt to add a new qualifier-backed bean for provider auth.`
Expected: activates `j.configuration-writing` and keeps runtime wiring in configuration classes.

- `Create src/main/kotlin/br/com/olx/trp/partner/configuration/PartnerTracingConfiguration.kt to wire a new shared bean for request tracing.`
Expected: activates `j.configuration-writing` and preserves framework-focused wiring.

## Near-Miss Non-Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/partner/provider/zoop/ZoopService.kt to choose a different provider call path.`
Expected: does not activate `j.configuration-writing`; this is service logic.

- `Edit src/main/resources/application.yml to change Redis TTL values.`
Expected: does not activate `j.configuration-writing`; this is config-data work, not Kotlin configuration wiring.

## Behavioral Eval
- Prompt: `First read src/main/kotlin/br/com/olx/trp/partner/configuration/SamplePartnerConfiguration.kt so any configuration guidance can trigger. Then create that file to wire a shared runtime bean. Answer exactly configuration-guidance=used only if you keep the class framework-focused and avoid moving business rules into it.`
- Success criteria:
  - the created file uses Spring configuration annotations and bean wiring
  - business orchestration does not appear in the configuration class
  - runtime contracts such as qualifiers or typed properties remain explicit
  - the `// skill-marker: configuration-writing` line is present above the configuration declaration
