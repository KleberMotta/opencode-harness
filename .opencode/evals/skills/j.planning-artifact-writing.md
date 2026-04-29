# Skill Eval Scenarios: `j.planning-artifact-writing`

## Trigger Prompts
- `Create docs/specs/seller-creation-service/CONTEXT.md from spec-writer exploration findings.`
Expected: activates `j.planning-artifact-writing` and writes durable research findings, identifier mappings, patterns, constraints, and open questions.

- `Edit docs/specs/seller-creation-service/plan.md so implementers no longer need to infer how sellerAccountId maps from the request header.`
Expected: activates `j.planning-artifact-writing` and makes the task action/done criteria explicit.

- `Revise the /j.plan harness so generated plan.md files are detailed Markdown contracts with CONTEXT.md section references.`
Expected: activates `j.planning-artifact-writing` and updates planner/reviewer guidance plus compatibility surfaces.

## Near-Miss Non-Trigger Prompts
- `Edit src/main/kotlin/br/com/olx/trp/seller/domain/partner/service/PartnerSellerService.kt to log seller ids.`
Expected: does not activate `j.planning-artifact-writing`; this is service implementation work.

- `Run ./mvnw test -Dtest=PartnerSellerServiceTest and summarize failures.`
Expected: does not activate `j.planning-artifact-writing`; this is verification work.

- `Implement SellerValidationService according to the already-approved task 5 plan.`
Expected: does not activate `j.planning-artifact-writing`; this is service implementation work, not artifact-authoring work.

## Behavioral Eval
- Prompt: `First read docs/specs/example/spec.md and docs/specs/example/CONTEXT.md. Then update docs/specs/example/plan.md. Answer exactly planning-artifact-guidance=used only if CONTEXT.md is treated as required source-of-truth, plan tasks include exact files/patterns/identifier mappings, and ambiguous business intent is either encoded or escalated as a question.`
- Success criteria:
  - plan references the context artifact explicitly
  - task actions specify concrete files and implementation patterns
  - identifier/header/body/entity mappings are explicit
  - unresolved ambiguity is not silently guessed
  - context is refined when new planning research discovers durable facts

- Prompt: `Update docs/specs/example/plan.md for a medium-complexity task. Answer exactly markdown-plan-contract=used only if new plan tasks are Markdown sections with Context References, exact files, detailed Action bullets, Verification commands, Done Criteria, and explicit out-of-scope constraints.`
- Success criteria:
  - plan remains `plan.md` and uses structured Markdown sections
  - each implementation task cites `CONTEXT.md#...` or `spec.md#...`
  - task actions expand reference-project behavior instead of saying “same as existing flow”
  - plan-reviewer would reject shallow summaries
