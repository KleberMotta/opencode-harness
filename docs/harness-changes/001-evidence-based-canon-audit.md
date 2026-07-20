# 001 — Evidence-Based Canon Audit

## Change Contract

- **Surface**: auto-improve workflow contract (`j.canon-audit`, `j.auto-improve`, implementer/planner/auditor prompts, integration provenance and evals).
- **Failure mechanism**: the previous audit expanded prose into a checklist and accepted any non-empty evidence, so an agent could mark every rule `PASS` without comparing the changed symbol to its candidate-parent structure, local precedents or impacted callers.
- **Evidence**:
  - `contexts/trp/trp-seller-api/.../SellerOutput.kt:33` introduced `preferences: SellerPreferences = SellerPreferences()` although the candidate parent had every comparable non-null constructor property explicit.
  - `tmp/pgw-task1-worker-session.json` records compilation exposing four missing `preferences` arguments followed by the implementer adding the default as a compatibility shortcut.
  - `docs/specs/pgw-9562-seller-preferences/state/tasks/task-1/auto-improve-coverage.json` recorded 872/872 rules as PASS with generic evidence and still accepted the commit.
  - Replaying the new V2 generator against `02419ac6bdf4631ffbe1dd30285514233b7e12bf` reports 12/12 comparable fields explicit at the baseline and four unchanged callers relying on the new default.
- **Expected effect**: every structural delta is evaluated against immutable diff, baseline, local-pattern, caller and contract evidence; unsupported required-field defaults reopen the task, optional nullable defaults remain valid, boilerplate evidence is rejected, and integration requires a plugin-issued receipt for the exact audited SHA and coverage digest.
- **Preserved invariants**: local evidence precedes shared canon; agents still judge non-mechanical semantics; intentional deviations remain possible with explicit contract evidence; auto-improver never edits product code; one commit per task and amend-on-correction remain unchanged; autoImprove=false remains inert.
- **Falsifying evals**:
  - `.opencode/evals/tests/state/canon-audit.test.ts` reproduces required-default/caller impact, optional near miss, prose-free pattern enforcement and boilerplate rejection.
  - `.opencode/evals/tests/state/feature-integration.test.ts` proves plugin-owned, in-memory completion provenance (audited SHA and coverage digest) — no self-signable capability token; state transitions occur only via `auto-improve-state.ts` result handling.
  - `.opencode/evals/tests/context/plugin-context.test.ts` proves contract-based task routing, pre-write skill enforcement and disabled-gate behavior.
  - Behavioral tasks 21–22 invoke the real `j.auto-improver`: required default must REOPEN; optional nullable default must PASS.
- **Rollback**: restore the files listed in this change from the pre-change revision and remove behavioral tasks 21–22 plus this record.

## Evals

- Deterministic suite: PASS, 130 pass / 0 fail, 690 `expect()` calls across 6 files (`TMPDIR=/Users/kleber.motta/repos/tmp npm run eval`), after final reviewer-hardening regressions.
- Behavioral implement-loop: PASS, ready, 1/1.
- Behavioral check-loop: PASS, ready, 1/1.
- Behavioral unify-loop: PASS, ready, 1/1.
- Behavioral required-default audit: PASS, auto-improve-required-default = reopen, 1/1; recorded `REOPEN_REQUIRED` and a correction contract.
- Behavioral optional-default audit: PASS, auto-improve-optional-default = pass, 1/1; recorded `PASSED` with complete evidence assessments.
- Real PGW-9562 replay: PASS; detected `SellerOutput.preferences`, 12/12 explicit baseline properties and four omitted callers.

## Reproducible SellerOutput Replay

```bash
TMPDIR=/Users/kleber.motta/repos/tmp bun .opencode/cli/canon-audit.ts \
  --commit 02419ac6bdf4631ffbe1dd30285514233b7e12bf \
  --output /Users/kleber.motta/repos/tmp/seller-output-audit-v2.json \
  --plan /Users/kleber.motta/repos/docs/specs/pgw-9562-seller-preferences/plan.md \
  --task 1 \
  --files /Users/kleber.motta/repos/contexts/trp/trp-seller-api/src/main/kotlin/br/com/olx/trp/seller/domain/seller/model/SellerOutput.kt
```

Expected generated evidence:

- finding `NON_NULL_DEFAULT_DIVERGENCE` for `SellerOutput.preferences`;
- candidate-parent baseline reports 12/12 comparable non-null fields explicit;
- caller evidence names `SellerOutputTest`, `ProviderCreatingListenerTest`, `WalletCreatedListenerTest` and `MessagingServiceTest`;
- no contract evidence authorizes the default, so a finding assessment cannot PASS.

## Completion Trust Model

Result of adversarial security hardening; signoff `APPROVED_WITH_DOCUMENTED_RESIDUAL`.

- **Core guarantee**: the audited agent cannot forge the product's completion signal, nor the dependency/manifest gating that guards it.
- **Why the anchor isn't disk**: worker and plugin run as the same OS user, so no on-disk location is tamper-proof, and the worker's process group cannot be killed (`client.session` exposes no handle for it). Trust therefore anchors only on what the worker cannot forge: (a) plugin memory — a separate process the worker cannot read the heap of — and (b) git history, which is content-addressed.
- **Mechanisms**:
  - In-memory attestation (`pluginCertifiedCompletions` / `featuresWithCorrection`) gates the m5 idempotency skip.
  - `reconcilePassedAudit` and `ensureDependenciesComplete` re-derive expected coverage from git (`buildCanonAuditCoverage`) instead of trusting on-disk JSON; the dependency git-anchor survives restarts.
  - A whole-tree effect guard on `docs/specs/<slug>/state/**` blocks any add/remove/modify during the correction-worker's window.
  - Defense-in-depth layers: shell/detach guards, `isProtectedAuditArtifact`, `verifyWorktreeScope`, the guard's exec-integrity check, and plugin-detected harness-dirty state.
- **Net effect**: forged coverage that masks a real structural finding (e.g. `NON_NULL_DEFAULT_DIVERGENCE` on `SellerOutput`) fails against the git-re-derived expected coverage, regardless of how or when it was written.
- **Documented residual** (`actionable=false`): cross-restart forgery of the execution-state of a `j.validator`/`j.test-writer` dependency — these tasks carry no product coverage to anchor in git. The only closing mechanism would be an OS-level process-group kill, which is unavailable. No new certification is minted; the dependent task re-anchors independently.

## Decision

- **APPLIED** — explicitly requested by the developer after the observed false PASS, 2026-07-19.
- Harness files remain uncommitted per repository policy.
