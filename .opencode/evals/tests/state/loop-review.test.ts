/**
 * Runtime behavior of the LOOP DRIVER's canon-review states (cli/loop.ts).
 *
 * These tests drive the REAL driver as a subprocess (`bun cli/loop.ts
 * --workspace <synthetic>`), never a mock, so a regression in decide() or in
 * the main() undo branch makes an assertion fail.
 *
 * How determinism is achieved WITHOUT a live LLM:
 *   - runOpencode() hardcodes `~/.opencode/bin` onto the FRONT of PATH, where the
 *     real opencode binary lives, so a PATH stub cannot win. Instead every case
 *     here reaches a code path that NEVER spawns opencode:
 *       · pure decisions       → `--dry-run` (prints the decision, executes nothing)
 *       · undo execution       → a pre-seeded loop-state.json makes the FAIL review
 *                                accepted on iteration 1, so main() runs the undo
 *                                (reset/rm/manifest) and never reaches an /j.implement
 *                                dispatch
 *       · abort paths          → decide()/undo abort with exit 2 before any dispatch
 *   - `reviewDispatchedAt` (the anti-forge window) is real on-disk driver memory:
 *     a prior iteration writes it to loop-state.json. Pre-seeding it faithfully
 *     models "the driver already dispatched /j.review-task in a previous iteration".
 *   - File mtimes are pinned with utimesSync so the mtime-window comparisons are
 *     exact regardless of wall-clock.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "fs"
import path from "path"
import {
  createGitRepo,
  createTempDir,
  opencodeRoot,
  removeDir,
  repoRoot,
  runCommand,
  type CommandResult,
} from "../../lib/test-utils"

const SLUG = "loop-review-feature"

// Fixed epoch (seconds) so mtime comparisons are deterministic. All relative
// offsets below are in seconds; loop-state timestamps are in milliseconds.
const BASE = 1_700_000_000
const STATE_MTIME_S = BASE // execution-state.md mtime
const REVIEW_MTIME_S = BASE + 100 // canon-review.json mtime (newer → not stale)
const DISPATCH_BEFORE_MS = (BASE - 100) * 1000 // dispatch precedes review → accepted
const DISPATCH_AFTER_MS = (BASE + 200) * 1000 // dispatch follows review → rejected (anti-forge)
// Plan-review freshness is plan-review.json.mtime >= plan.md.mtime.
const PLAN_MTIME_S = BASE // plan.md mtime
const PLAN_REVIEW_FRESH_S = BASE + 100 // plan-review newer than plan.md → fresh
const PLAN_REVIEW_STALE_S = BASE - 100 // plan-review older than plan.md → stale

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) removeDir(tempDirs.pop()!)
})

const LOOP_CLI = path.join(opencodeRoot(), "cli", "loop.ts")

function tmp(prefix: string): string {
  const dir = createTempDir(prefix)
  tempDirs.push(dir)
  return dir
}

function write(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, "utf-8")
}

function writeJson(filePath: string, value: unknown): void {
  write(filePath, JSON.stringify(value, null, 2) + "\n")
}

function specStateDir(workspace: string): string {
  return path.join(workspace, "docs", "specs", SLUG, "state")
}

function taskDir(workspace: string, id: string): string {
  return path.join(specStateDir(workspace), "tasks", `task-${id}`)
}

// --- Synthetic workspace ---------------------------------------------------

type TaskSpec = { id: string; name?: string }

function buildWorkspace(opts: {
  tasks: TaskSpec[]
  reviewPlan?: boolean
  reviewImplement?: boolean
  maxAttempts?: number
  automation?: boolean
}): string {
  const workspace = tmp("juninho-loop-review-")

  writeJson(path.join(workspace, ".opencode", "juninho-config.json"), {
    workflow: {
      automation: {
        nonInteractive: opts.automation ?? false,
        autoApproveArtifacts: opts.automation ?? false,
      },
      review: {
        plan: opts.reviewPlan ?? false,
        implement: opts.reviewImplement ?? true,
        maxAttempts: opts.maxAttempts ?? 2,
      },
    },
  })

  const planBody = ["# Plan", ""]
    .concat(
      opts.tasks.flatMap((t) => [
        `## Task ${t.id} — ${t.name ?? `Task ${t.id}`}`,
        "- **Agent**: j.implementer",
        "",
      ]),
    )
    .join("\n")
  write(path.join(workspace, "docs", "specs", SLUG, "plan.md"), planBody)

  return workspace
}

function seedCompleteTask(
  workspace: string,
  id: string,
  opts: { validatedCommit: string; targetRepoRoot?: string },
): void {
  write(
    path.join(taskDir(workspace, id), "execution-state.md"),
    [`# Task ${id}`, "", "- **Status**: COMPLETE", "- **Attempt**: 1", ""].join("\n"),
  )
  if (opts.targetRepoRoot) {
    writeJson(path.join(taskDir(workspace, id), "runtime.json"), {
      targetRepoRoot: opts.targetRepoRoot,
      stage: "implement",
    })
  }
}

function seedManifest(workspace: string, tasks: Record<string, { validatedCommit: string }>): void {
  const manifestTasks: Record<string, unknown> = {}
  for (const [id, meta] of Object.entries(tasks)) {
    manifestTasks[id] = {
      taskID: id,
      validatedCommit: meta.validatedCommit,
      integration: { status: "direct", method: "direct-commit", integratedCommit: meta.validatedCommit },
    }
  }
  writeJson(path.join(specStateDir(workspace), "integration-state.json"), {
    featureSlug: SLUG,
    featureBranch: `feature/${SLUG}`,
    tasks: manifestTasks,
  })
}

function seedCanonReview(
  workspace: string,
  id: string,
  opts: { verdict: "PASS" | "FAIL"; commit: string; mtimeSeconds: number },
): void {
  const file = path.join(taskDir(workspace, id), "canon-review.json")
  writeJson(file, {
    mode: "commit",
    taskId: id,
    commit: opts.commit,
    verdict: opts.verdict,
    reasons: [`${opts.verdict}: synthetic finding`],
    reviewedAt: new Date(opts.mtimeSeconds * 1000).toISOString(),
  })
  // execution-state.md must be OLDER than the review (else the review is "stale").
  const statePath = path.join(taskDir(workspace, id), "execution-state.md")
  if (existsSync(statePath)) utimesSync(statePath, STATE_MTIME_S, STATE_MTIME_S)
  utimesSync(file, opts.mtimeSeconds, opts.mtimeSeconds)
}

function seedLoopState(
  workspace: string,
  state: {
    reviewDispatchedAt?: Record<string, number>
    reviewRetries?: Record<string, number>
    planReviewAttempts?: number
  },
): void {
  writeJson(path.join(specStateDir(workspace), "loop-state.json"), {
    reviewDispatchedAt: state.reviewDispatchedAt ?? {},
    reviewRetries: state.reviewRetries ?? {},
    planReviewAttempts: state.planReviewAttempts ?? 0,
  })
}

// --- Plan review (E6) -------------------------------------------------------

function planPath(workspace: string): string {
  return path.join(workspace, "docs", "specs", SLUG, "plan.md")
}

// Writes plan-review.json + a prose plan-review.md and pins mtimes so the driver's
// freshness comparison (plan-review.json.mtime >= plan.md.mtime) is deterministic.
function seedPlanReview(
  workspace: string,
  opts: { verdict: "PASS" | "FAIL"; reviewMtimeSeconds: number; planMtimeSeconds: number },
): void {
  const jsonFile = path.join(specStateDir(workspace), "plan-review.json")
  writeJson(jsonFile, {
    mode: "plan",
    verdict: opts.verdict,
    reasons: [`${opts.verdict}: synthetic plan finding`],
    canonCommits: [],
    harnessDirty: false,
    reviewedAt: new Date(opts.reviewMtimeSeconds * 1000).toISOString(),
  })
  write(
    path.join(specStateDir(workspace), "plan-review.md"),
    [`# Plan Review`, "", `Verdict: ${opts.verdict}`, "", "- synthetic plan finding", ""].join("\n"),
  )
  utimesSync(planPath(workspace), opts.planMtimeSeconds, opts.planMtimeSeconds)
  utimesSync(jsonFile, opts.reviewMtimeSeconds, opts.reviewMtimeSeconds)
}

function rejectedPlanPath(workspace: string, index: number): string {
  return path.join(specStateDir(workspace), `plan.rejected-${index}.md`)
}

// --- Target git repo -------------------------------------------------------

type TargetRepo = { repo: string; baseSha: string; taskSha: string; headSha: string }

function head(repo: string): string {
  return runCommand("git", ["rev-parse", "HEAD"], { cwd: repo }).stdout.trim()
}

function commitCount(repo: string): number {
  return runCommand("git", ["rev-list", "--count", "HEAD"], { cwd: repo }).stdout.trim() ? Number(
    runCommand("git", ["rev-list", "--count", "HEAD"], { cwd: repo }).stdout.trim(),
  ) : 0
}

// base commit (pre-task) + task commit (reviewed) [+ optional extra stacked commit].
function buildTargetRepo(opts?: { extraCommit?: boolean }): TargetRepo {
  const repo = tmp("juninho-loop-target-")
  createGitRepo(repo)
  write(path.join(repo, "base.txt"), "base\n")
  runCommand("git", ["add", "."], { cwd: repo })
  runCommand("git", ["commit", "-m", "base"], { cwd: repo })
  const baseSha = head(repo)

  write(path.join(repo, "feature.txt"), "task work\n")
  runCommand("git", ["add", "."], { cwd: repo })
  runCommand("git", ["commit", "-m", "task 1 work"], { cwd: repo })
  const taskSha = head(repo)

  let headSha = taskSha
  if (opts?.extraCommit) {
    write(path.join(repo, "extra.txt"), "unrelated stacked work\n")
    runCommand("git", ["add", "."], { cwd: repo })
    runCommand("git", ["commit", "-m", "extra stacked commit"], { cwd: repo })
    headSha = head(repo)
  }

  return { repo, baseSha, taskSha, headSha }
}

// --- Driver invocation -----------------------------------------------------

function runLoop(workspace: string, extraArgs: string[]): CommandResult {
  return runCommand("bun", [LOOP_CLI, "--workspace", workspace, "--slug", SLUG, "--until", "implement", ...extraArgs], {
    cwd: repoRoot(),
    env: process.env,
  })
}

function readLoopState(workspace: string): any {
  return JSON.parse(readFileSync(path.join(specStateDir(workspace), "loop-state.json"), "utf-8"))
}

// ===========================================================================

describe("loop driver — canon review runtime", () => {
  // CASE 1 — Undo on FAIL: the driver executes the reset-and-redo.
  test("FAIL review triggers undo: HEAD reset to commit^, task state removed, manifest cleaned, retry incremented, next decision is /j.implement", () => {
    const workspace = buildWorkspace({ tasks: [{ id: "1" }] })
    const target = buildTargetRepo()
    seedCompleteTask(workspace, "1", { validatedCommit: target.taskSha, targetRepoRoot: target.repo })
    seedManifest(workspace, { "1": { validatedCommit: target.taskSha } })
    seedCanonReview(workspace, "1", { verdict: "FAIL", commit: target.taskSha, mtimeSeconds: REVIEW_MTIME_S })
    seedLoopState(workspace, { reviewDispatchedAt: { "1": DISPATCH_BEFORE_MS }, reviewRetries: { "1": 0 } })

    // HEAD is the reviewed commit before the undo.
    expect(head(target.repo)).toBe(target.taskSha)

    // One iteration executes the undo, then the run terminates on max-iterations.
    const result = runLoop(workspace, ["--max-iterations", "1"])
    expect(result.stdout).toContain("UNDO task 1")

    // Effect 1: HEAD reset to the reviewed commit's parent (the base commit).
    expect(head(target.repo)).toBe(target.baseSha)
    expect(commitCount(target.repo)).toBe(1)
    // Effect 2: the task's state directory is gone.
    expect(existsSync(taskDir(workspace, "1"))).toBe(false)
    // Effect 3: the manifest no longer carries the task.
    const manifest = JSON.parse(
      readFileSync(path.join(specStateDir(workspace), "integration-state.json"), "utf-8"),
    )
    expect(manifest.tasks["1"]).toBeUndefined()
    // Effect 4: reviewRetries incremented.
    expect(readLoopState(workspace).reviewRetries["1"]).toBe(1)

    // Next decision: the task is PENDING again → /j.implement.
    const next = runLoop(workspace, ["--dry-run"])
    expect(next.stdout).toContain("decision: /j.implement")
    expect(next.stdout).not.toContain("UNDO")
  })

  // CASE 2 — Anti-forge mtime window: a review OLDER than the dispatch is not accepted.
  test("canon-review.json with mtime BEFORE the driver's dispatch is treated as absent (no undo on stale verdict)", () => {
    const workspace = buildWorkspace({ tasks: [{ id: "1" }] })
    const target = buildTargetRepo()
    seedCompleteTask(workspace, "1", { validatedCommit: target.taskSha, targetRepoRoot: target.repo })
    seedManifest(workspace, { "1": { validatedCommit: target.taskSha } })
    // Review is NOT stale vs execution-state, but the dispatch happened AFTER it.
    seedCanonReview(workspace, "1", { verdict: "FAIL", commit: target.taskSha, mtimeSeconds: REVIEW_MTIME_S })
    seedLoopState(workspace, { reviewDispatchedAt: { "1": DISPATCH_AFTER_MS }, reviewRetries: { "1": 0 } })

    const result = runLoop(workspace, ["--dry-run"])
    // The pre-forged FAIL is rejected → driver re-dispatches the review, not an undo.
    expect(result.stdout).toContain("decision: /j.review-task")
    expect(result.stdout).not.toContain("UNDO")
    expect(head(target.repo)).toBe(target.taskSha) // untouched
  })

  // CASE 3 — Ceiling: reaching maxAttempts aborts with a human-facing message.
  test("reviewRetries at maxAttempts → ABORT (exit 2) with a message for the human", () => {
    const workspace = buildWorkspace({ tasks: [{ id: "1" }], maxAttempts: 2 })
    seedCompleteTask(workspace, "1", { validatedCommit: "deadbeefcafe0001" })
    seedManifest(workspace, { "1": { validatedCommit: "deadbeefcafe0001" } })
    seedCanonReview(workspace, "1", { verdict: "FAIL", commit: "deadbeefcafe0001", mtimeSeconds: REVIEW_MTIME_S })
    seedLoopState(workspace, { reviewDispatchedAt: { "1": DISPATCH_BEFORE_MS }, reviewRetries: { "1": 2 } })

    const result = runLoop(workspace, ["--max-iterations", "5"])
    expect(result.status).toBe(2)
    expect(result.stdout).toContain("ABORT")
    expect(result.stdout).toContain("teto")
    expect(result.stdout).toContain("task 1")
    expect(result.stdout).toContain("canon-review.md")
  })

  // CASE 4 — HEAD divergence: an extra stacked commit blocks the undo (no reset).
  test("HEAD past the reviewed commit → undo ABORTS without resetting (does not destroy new work)", () => {
    const workspace = buildWorkspace({ tasks: [{ id: "1" }] })
    const target = buildTargetRepo({ extraCommit: true })
    seedCompleteTask(workspace, "1", { validatedCommit: target.taskSha, targetRepoRoot: target.repo })
    seedManifest(workspace, { "1": { validatedCommit: target.taskSha } })
    // Review targets the task commit, but HEAD has moved on (extra commit).
    seedCanonReview(workspace, "1", { verdict: "FAIL", commit: target.taskSha, mtimeSeconds: REVIEW_MTIME_S })
    seedLoopState(workspace, { reviewDispatchedAt: { "1": DISPATCH_BEFORE_MS }, reviewRetries: { "1": 0 } })

    expect(head(target.repo)).toBe(target.headSha)
    expect(head(target.repo)).not.toBe(target.taskSha)

    const result = runLoop(workspace, ["--max-iterations", "5"])
    expect(result.status).toBe(2)
    expect(result.stdout).toContain("ABORT")
    expect(result.stdout).toContain("commits empilharam")

    // Nothing destroyed: HEAD still at the stacked commit, all 3 commits present,
    // task state and manifest entry intact.
    expect(head(target.repo)).toBe(target.headSha)
    expect(commitCount(target.repo)).toBe(3)
    expect(existsSync(taskDir(workspace, "1"))).toBe(true)
    const manifest = JSON.parse(
      readFileSync(path.join(specStateDir(workspace), "integration-state.json"), "utf-8"),
    )
    expect(manifest.tasks["1"]).toBeDefined()
  })

  // CASE 5 — Ordering: a COMPLETE-but-unreviewed task reviews BEFORE the next pending task.
  test("a COMPLETE task without an accepted review dispatches /j.review-task before releasing the next pending task", () => {
    const workspace = buildWorkspace({ tasks: [{ id: "1" }, { id: "2" }] })
    const target = buildTargetRepo()
    // Task 1 COMPLETE (HEAD is its reviewed commit) with NO canon-review yet.
    seedCompleteTask(workspace, "1", { validatedCommit: target.taskSha, targetRepoRoot: target.repo })
    seedManifest(workspace, { "1": { validatedCommit: target.taskSha } })
    // Task 2 is left PENDING (no execution-state, no manifest entry).

    const result = runLoop(workspace, ["--dry-run"])
    // Even though task 2 is pending, the driver reviews task 1 first.
    expect(result.stdout).toContain("decision: /j.review-task")
    expect(result.stdout).toContain("task 1")
    expect(result.stdout).not.toContain("decision: /j.implement")
    // HEAD is still the reviewed commit when the review is dispatched.
    expect(head(target.repo)).toBe(target.taskSha)
  })
})

// ===========================================================================
// E6 — plan-level canon review: the driver gates plan.md before any implement.
// ===========================================================================

describe("loop driver — plan review runtime", () => {
  // CASE 6 — PASS clears the gate: implementation proceeds.
  test("plan review PASS (fresh) → next decision is /j.implement", () => {
    const workspace = buildWorkspace({ tasks: [{ id: "1" }], reviewPlan: true, reviewImplement: false })
    seedPlanReview(workspace, { verdict: "PASS", reviewMtimeSeconds: PLAN_REVIEW_FRESH_S, planMtimeSeconds: PLAN_MTIME_S })

    const result = runLoop(workspace, ["--dry-run"])
    expect(result.stdout).toContain("decision: /j.implement")
    expect(result.stdout).not.toContain("decision: /j.review-plan")
  })

  // CASE 7 — Staleness: a plan edited after its review must be re-reviewed.
  test("plan-review.json older than plan.md (stale) → re-dispatch /j.review-plan", () => {
    const workspace = buildWorkspace({ tasks: [{ id: "1" }], reviewPlan: true })
    seedPlanReview(workspace, { verdict: "PASS", reviewMtimeSeconds: PLAN_REVIEW_STALE_S, planMtimeSeconds: PLAN_MTIME_S })

    const result = runLoop(workspace, ["--dry-run"])
    expect(result.stdout).toContain("decision: /j.review-plan")
  })

  // CASE 8 — Interactive FAIL: ABORT and leave plan.md in place for the human.
  test("plan review FAIL in interactive mode → ABORT (exit 2) WITHOUT archiving plan.md", () => {
    const workspace = buildWorkspace({ tasks: [{ id: "1" }], reviewPlan: true, automation: false })
    seedPlanReview(workspace, { verdict: "FAIL", reviewMtimeSeconds: PLAN_REVIEW_FRESH_S, planMtimeSeconds: PLAN_MTIME_S })

    const result = runLoop(workspace, ["--max-iterations", "5"])
    expect(result.status).toBe(2)
    expect(result.stdout).toContain("ABORT")
    expect(result.stdout).toContain("modo interativo")
    expect(result.stdout).toContain("plan-review.md")
    // Interactive mode NEVER archives: plan.md stays, no plan.rejected-N.md.
    expect(existsSync(planPath(workspace))).toBe(true)
    expect(existsSync(rejectedPlanPath(workspace, 1))).toBe(false)
  })

  // CASE 9 — Automation FAIL: archive the rejected plan, then re-dispatch /j.plan.
  test("plan review FAIL in automation mode → archives plan.rejected-1.md and next decision is /j.plan", () => {
    const workspace = buildWorkspace({ tasks: [{ id: "1" }], reviewPlan: true, automation: true })
    seedPlanReview(workspace, { verdict: "FAIL", reviewMtimeSeconds: PLAN_REVIEW_FRESH_S, planMtimeSeconds: PLAN_MTIME_S })

    // One real iteration executes the archive (a pure side-effect, then continue —
    // no opencode spawn, exactly like the undo path in CASE 1).
    const archived = runLoop(workspace, ["--max-iterations", "1"])
    expect(archived.stdout).toContain("REPLAN")
    // Effect: plan.md moved to plan.rejected-1.md (history kept, active plan gone).
    expect(existsSync(planPath(workspace))).toBe(false)
    expect(existsSync(rejectedPlanPath(workspace, 1))).toBe(true)

    // Next decision: plan.md archived + plan-review present + automation → /j.plan.
    // (The startup guard tolerates the missing plan.md because a replan is pending.)
    const next = runLoop(workspace, ["--dry-run"])
    expect(next.stdout).toContain("decision: /j.plan")
  })

  // CASE 10 — Ceiling: too many rejected plans stops the driver and calls the human.
  test("plan review FAIL at maxAttempts ceiling → ABORT (exit 2) without archiving", () => {
    const workspace = buildWorkspace({ tasks: [{ id: "1" }], reviewPlan: true, automation: true, maxAttempts: 2 })
    seedPlanReview(workspace, { verdict: "FAIL", reviewMtimeSeconds: PLAN_REVIEW_FRESH_S, planMtimeSeconds: PLAN_MTIME_S })
    seedLoopState(workspace, { planReviewAttempts: 2 })

    const result = runLoop(workspace, ["--max-iterations", "5"])
    expect(result.status).toBe(2)
    expect(result.stdout).toContain("ABORT")
    expect(result.stdout).toContain("teto")
    expect(result.stdout).toContain("FALHOU")
    // The ceiling stops BEFORE archiving: plan.md remains for the human.
    expect(existsSync(planPath(workspace))).toBe(true)
    expect(existsSync(rejectedPlanPath(workspace, 1))).toBe(false)
  })
})
