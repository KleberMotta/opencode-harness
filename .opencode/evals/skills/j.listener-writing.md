# Skill Eval Scenarios: `j.listener-writing`

## Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/partner/listener/webhook/ZoopWebhookListener.kt to log a trace identifier without changing its acknowledgment semantics.`
Expected: activates `j.listener-writing` and preserves thin delegation plus `ON_SUCCESS` behavior.

- `Create src/main/kotlin/br/com/olx/trp/partner/listener/redis/SampleExpirationListener.kt to hand an expired payment event to a service.`
Expected: activates `j.listener-writing` and keeps retry-sensitive logic out of the listener body.

## Near-Miss Non-Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/partner/domain/webhook/service/ZoopWebhookAuditService.kt to persist a new hash field.`
Expected: does not activate `j.listener-writing`; this is service work.

- `Edit src/main/resources/application.yml to add a new queue name.`
Expected: does not activate `j.listener-writing`; this is configuration work.

## Behavioral Eval
- Prompt: `First read src/main/kotlin/br/com/olx/trp/partner/listener/webhook/SamplePartnerListener.kt so any listener guidance can trigger. Then create that file for an SQS event. Answer exactly listener-guidance=used only if you keep the listener adapter-thin, preserve acknowledgment semantics, and delegate to one service.`
- Success criteria:
  - the created file is a Spring listener component
  - the handler delegates to one service method
  - the implementation does not swallow failures that should affect retries
  - the `// skill-marker: listener-writing` line is present above the listener declaration
