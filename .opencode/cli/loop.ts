/**
 * j.loop — driver de LOOP ENGINEERING para o harness juninho.
 *
 * Conceito: um processo EXTERNO e determinístico reinvoca o opencode headless
 * (`opencode run <comando>`) até o objetivo da feature concluir. Cada iteração
 * é um processo novo (contexto fresco); o estado persistente do harness em
 * disco (docs/specs/{slug}/state/) é a única fonte de verdade. A terminação é
 * governada por SENSORES (arquivos de estado), nunca pelo modelo: o loop lê o
 * disco, decide o próximo comando, executa, mede o efeito e aplica guardas.
 *
 * Sensores lidos a cada iteração (sempre do disco, nunca de memória):
 *   - .opencode/state/active-plan.json           → slug default
 *   - docs/specs/{slug}/plan.md                  → tasks "## Task N" + Agent
 *   - docs/specs/{slug}/state/integration-state.json → validatedCommit por task
 *   - docs/specs/{slug}/state/tasks/task-{id}/execution-state.md → Status
 *   - docs/specs/{slug}/state/check-review.md    → linha "Verdict: GREEN|BLOCKED"
 *     da seção "## Loop State" (contrato com j.checker; fallback: tokens
 *     legados), linha "Failure fingerprint:" e rotas de "## Failure Routing"
 *   - docs/specs/{slug}/state/loop-state.json    → memória do próprio loop
 *
 * Máquina de estados:
 *   task pendente                        → /j.implement (singleTaskMode: 1 task/iteração)
 *   unify já concluído (exit 0)          → DONE imediato (cleanup pós-PR não reabre check)
 *   todas completas, sem check ou stale  → /j.check     (se --until >= check)
 *   check BLOCKED, falhas 100% INFRA     → /j.check 1x (reparo de ambiente;
 *                                          2ª INFRA-only → ABORT exit 2, nunca /j.implement)
 *   check BLOCKED, arquivo não regenerado→ /j.check (check stale pós-reentrada;
 *                                          nunca compara um check-review consigo mesmo)
 *   check BLOCKED, reentradas < limite   → /j.implement (reentrada)
 *   check GREEN, --until=unify, 1x       → /j.unify
 *   caso contrário                       → DONE
 *
 * Guardas (o coração do loop engineering):
 *   (a) --max-iterations
 *   (b) STALL: hash do estado inalterado após /j.implement 2x seguidas → ABORT
 *   (c) REPETIÇÃO: mesma seção de falhas do check em 2 reentradas → ABORT
 *       ("mesmas falhas 2x — beco sem saída, não persistência"); só compara
 *       fingerprints entre GERAÇÕES DISTINTAS do check-review.md (mtime)
 *   (d) REGRESSÃO: nº de falhas do check aumentou → ABORT e IMPRIME (não
 *       executa) `git reset --hard <último validatedCommit do manifest>`
 *   (e) timeout por iteração (kill do processo filho via spawnSync timeout)
 *   Exceção INFRA: falhas roteadas 100% para INFRA em "## Failure Routing" não
 *   consomem reentradas nem o guard de fingerprint — são problema de ambiente.
 *
 * Uso:
 *   npm run loop -- [--slug <feature>] [--until implement|check|unify]
 *                   [--max-iterations N] [--iteration-timeout-min N]
 *                   [--dry-run] [--workspace <dir>]
 *
 *   --slug       default: slug do active-plan.json (erro claro se nenhum)
 *   --until      default: unify
 *   --dry-run    só imprime a decisão da iteração atual (linha "decision: ...")
 *                sem executar nada nem escrever loop-state.json
 *   --workspace  default: raiz deste workspace; usado por testes para apontar
 *                para um workspace sintético
 *
 * Nota: "último commit" é aproximado pelo bookkeeping do próprio harness
 * (mtime de integration-state.json e dos execution-state.md) em vez de git —
 * é determinístico, não sofre falso-positivo de commits alheios no monorepo e
 * funciona em workspaces sintéticos de teste.
 *
 * Exit codes: 0 = done · 1 = erro de uso/ambiente · 2 = abortado por guarda
 * (precisa de humano).
 */
import { execFileSync, spawnSync } from "child_process"
import { createHash } from "crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "fs"
import os from "os"
import path from "path"
import { die, ok, writeJson } from "./_lib"
import { loadJuninhoConfig } from "../lib/j.juninho-config"
import { featureStateDir, featureStateManifestPath, featureStateTaskPaths, planReviewPath } from "../lib/j.feature-state-paths"
import { removeTaskFromManifest } from "../lib/j.feature-integration"

type Until = "implement" | "check" | "unify"

const UNTIL_ORDER: Record<Until, number> = { implement: 0, check: 1, unify: 2 }

type CliArgs = {
  slug?: string
  until: Until
  maxIterations: number
  iterationTimeoutMin: number
  dryRun: boolean
  workspace: string
}

type PlanTask = { id: string; name: string; agent: string }

type CheckVerdict = "GREEN" | "BLOCKED" | "UNKNOWN"

type ReviewVerdict = "PASS" | "FAIL" | "UNKNOWN"

type CheckReviewSensor = {
  mtimeMs: number
  verdict: CheckVerdict
  failureHash: string
  failureCount: number
  stale: boolean
  infraOnly: boolean
}

// Per-task canon review file (docs/specs/{slug}/state/tasks/task-{id}/canon-review.json).
// `stale` = the review predates the task's current completion (execution-state.md mtime),
// i.e. it reviewed a previous attempt. The anti-forge window (review newer than the driver's
// own /j.review-task dispatch) is applied in decide(), which owns the loop-state.
type TaskReviewSensor = {
  mtimeMs: number
  verdict: ReviewVerdict
  commit: string | null
  stale: boolean
}

// Plan-level canon review file (docs/specs/{slug}/state/plan-review.json). `fresh` = the
// review is newer than plan.md, so a plan edited after review re-triggers /j.review-plan.
type PlanReviewSensor = {
  mtimeMs: number
  verdict: ReviewVerdict
  fresh: boolean
}

type Sensors = {
  planExists: boolean
  planTasks: PlanTask[]
  taskStatuses: Record<string, string>
  pendingIds: string[]
  completedIds: string[]
  checkReview: CheckReviewSensor | null
  planReview: PlanReviewSensor | null
  taskReviews: Record<string, TaskReviewSensor>
  taskCommits: Record<string, string | null>
  lastValidatedCommit: string | null
  stateHash: string
}

type Decision =
  | { kind: "run"; command: "/j.implement" | "/j.check" | "/j.unify" | "/j.review-plan" | "/j.review-task" | "/j.plan"; because: string; reentry?: boolean; infraRetry?: boolean; reviewTaskId?: string }
  | { kind: "undo"; taskId: string; commit: string; because: string }
  // E6: plano rejeitado pela revisão canônica em modo automation → arquiva plan.md
  // como plan.rejected-N.md e deixa a próxima iteração re-disparar /j.plan.
  | { kind: "replan"; because: string }
  | { kind: "done"; because: string }
  | { kind: "abort"; because: string; printRollback?: boolean }

type LoopIteration = {
  n: number
  command: string
  decidedBecause: string
  startedAt: string
  durationMs: number
  exitCode: number | null
  stateHashAfter: string
  outcomeSummary: string
}

type LoopState = {
  startedAt: string
  slug: string
  until: Until
  status: "running" | "done" | "aborted"
  abortReason?: string
  iterations: LoopIteration[]
  reentries: number
  stallCount: number
  checkStallCount: number
  unifyDone: boolean
  lastFailureHash: string | null
  lastCheckFailureCount: number | null
  // mtime da geração do check-review.md que originou lastFailureHash — o guard
  // de repetição só compara fingerprints entre gerações distintas do arquivo.
  lastFailureReviewMtimeMs: number | null
  // Exceção INFRA: uma única re-execução de /j.check por episódio de ambiente.
  infraRetryUsed: boolean
  // Desfaz-e-refaz: nº de vezes que cada task foi desfeita por review FAIL. Teto
  // em workflow.review.maxAttempts → ABORT.
  reviewRetries: Record<string, number>
  // Nº de /j.review-plan disparados sem veredito fresco; teto → ABORT.
  planReviewAttempts: number
  // Anti-forja: instante (ms) em que o driver disparou /j.review-task para cada
  // task. Um canon-review.json só é aceito se sua mtime for POSTERIOR — o produtor
  // não consegue forjar um veredito com mtime futura ao próprio dispatch do driver.
  reviewDispatchedAt: Record<string, number>
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    until: "unify",
    maxIterations: 25,
    iterationTimeoutMin: 30,
    dryRun: false,
    workspace: path.resolve(import.meta.dir, "../.."),
  }

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const next = () => {
      const value = argv[++i]
      if (value === undefined) die(`flag ${flag} requer um valor`)
      return value
    }

    if (flag === "--slug") args.slug = next()
    else if (flag === "--until") {
      const value = next()
      if (!(value in UNTIL_ORDER)) die(`--until inválido: '${value}' (use implement|check|unify)`)
      args.until = value as Until
    } else if (flag === "--max-iterations") {
      const value = Number(next())
      if (!Number.isInteger(value) || value < 1) die(`--max-iterations inválido: precisa ser inteiro >= 1`)
      args.maxIterations = value
    } else if (flag === "--iteration-timeout-min") {
      const value = Number(next())
      if (!(value > 0)) die(`--iteration-timeout-min inválido: precisa ser número > 0`)
      args.iterationTimeoutMin = value
    } else if (flag === "--dry-run") args.dryRun = true
    else if (flag === "--workspace") args.workspace = path.resolve(next())
    else die(`flag desconhecida: ${flag}`)
  }

  return args
}

function resolveSlug(workspace: string, explicit?: string): string {
  if (explicit) return explicit

  const activePlanPath = path.join(workspace, ".opencode", "state", "active-plan.json")
  if (existsSync(activePlanPath)) {
    try {
      const state = JSON.parse(readFileSync(activePlanPath, "utf-8")) as {
        slug?: string
        planPath?: string
        writeTargets?: Array<{ slug?: string; planPath?: string }>
      }
      const fromPlanPath = (planPath?: string) => planPath?.match(/docs\/specs\/([^/]+)\/plan\.md$/)?.[1]
      const slug = state.slug
        ?? state.writeTargets?.map((target) => target.slug ?? fromPlanPath(target.planPath)).find(Boolean)
        ?? fromPlanPath(state.planPath)
      if (slug) return slug
    } catch {
      // active-plan ilegível conta como ausente; o erro abaixo orienta o usuário.
    }
  }

  die(`nenhum slug: não há plano ativo em ${activePlanPath} e --slug não foi informado (use npm run plan:activate ou --slug <feature>)`)
}

// ---------------------------------------------------------------------------
// Sensores (sempre do disco)
// ---------------------------------------------------------------------------

function markdownField(body: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return body.match(new RegExp("^-\\s+\\*\\*" + escapedName + "\\*\\*:\\s*([^\\n]+)", "im"))?.[1]?.replace(/`/g, "").trim() ?? ""
}

function parsePlanTasks(planPath: string): PlanTask[] {
  if (!existsSync(planPath)) return []
  const content = readFileSync(planPath, "utf-8")
  const matches = Array.from(content.matchAll(/^##\s+Task\s+([A-Za-z0-9_-]+)\b(?:\s+[—:-]\s*([^\n]+))?[^\n]*$/gm))
  return matches.map((match, index) => {
    const bodyStart = (match.index ?? 0) + match[0].length
    const body = content.slice(bodyStart, matches[index + 1]?.index ?? content.length)
    return {
      id: match[1],
      name: match[2]?.trim() || "Task " + match[1],
      agent: markdownField(body, "Agent") || "-",
    }
  })
}

function safeMtimeMs(filePath: string): number | null {
  try {
    return statSync(filePath).mtimeMs
  } catch {
    return null
  }
}

// Corpo de uma seção "## {heading}" (até o próximo "## " ou o fim do arquivo).
function extractNamedSection(content: string, heading: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return content.match(new RegExp("^##\\s+" + escaped + "\\s*$\\n?([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))", "im"))?.[1] ?? null
}

// Fonte primária do verdict: a linha machine-parseable "Verdict: GREEN|BLOCKED"
// que o j.checker escreve como primeira linha da seção "## Loop State" do
// check-review.md (contrato driver↔checker). Fallback: tokens legados de
// relatórios antigos.
function parseCheckVerdict(content: string): CheckVerdict {
  const scope = extractNamedSection(content, "Loop State") ?? content
  const explicit = scope.match(/^Verdict:\s*(GREEN|BLOCKED)\b/im)?.[1]?.toUpperCase()
  if (explicit === "GREEN" || explicit === "BLOCKED") return explicit
  if (/BLOCKED_BY_(CHECKS|REVIEW|BOTH)|CHECK_LOOP_BLOCKED/.test(content)) return "BLOCKED"
  if (/CHECK_LOOP_GREEN|\bGREEN\b/.test(content)) return "GREEN"
  return "UNKNOWN"
}

// Fonte primária do hash de falhas: a linha "Failure fingerprint:" da seção
// "## Loop State" (já normalizada pelo checker). Fallback: normalização própria.
function parseFailureFingerprint(content: string): string | null {
  const scope = extractNamedSection(content, "Loop State") ?? content
  return scope.match(/^Failure fingerprint:\s*(\S[^\n]*)$/im)?.[1]?.trim() ?? null
}

// Rotas declaradas na seção "## Failure Routing" ("- {ROUTE} | ..."). A linha
// "- none" (nenhuma falha) não casa e resulta em lista vazia.
function parseFailureRoutes(content: string): string[] {
  const section = extractNamedSection(content, "Failure Routing")
  if (!section) return []
  const routes: string[] = []
  for (const line of section.split("\n")) {
    const route = line.match(/^\s*[-*+]\s+([A-Z_]+)\s*\|/)?.[1]
    if (route) routes.push(route)
  }
  return routes
}

// Extrai as seções de falhas do check-review (headings com fail/finding/issue/
// critical/important/etc). Se nenhuma seção casar, usa o arquivo inteiro para
// que o guard de repetição continue funcionando.
function extractFailureSection(content: string): string {
  const failureHeading = /(fail|falha|finding|issue|critical|important|problem|blocked)/i
  const lines = content.split("\n")
  const captured: string[] = []
  let capturing = false
  let captureDepth = 0

  for (const line of lines) {
    const heading = line.match(/^(#{2,6})\s+(.*)$/)
    if (heading) {
      const depth = heading[1].length
      if (capturing && depth <= captureDepth) capturing = false
      if (!capturing && failureHeading.test(heading[2])) {
        capturing = true
        captureDepth = depth
        continue
      }
    }
    if (capturing) captured.push(line)
  }

  const section = captured.join("\n").trim()
  return section || content
}

// Normaliza a seção de falhas para comparação entre reentradas: SHAs, números
// e timestamps mudam entre passes sem mudar a falha em si.
function normalizeFailureText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b[0-9a-f]{7,40}\b/g, "<sha>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

function countFailures(failureSection: string): number {
  return (failureSection.match(/^\s*[-*+]\s+/gm) ?? []).length
}

function isTaskComplete(status: string | undefined, validatedCommit: unknown): boolean {
  if (status === "COMPLETE") return true
  return typeof validatedCommit === "string" && validatedCommit.trim() !== "" && validatedCommit !== "-"
}

// Reads a canon-review.json / plan-review.json written by @j.canon-reviewer. A
// missing file is null; a present-but-unparseable file yields an UNKNOWN verdict
// with its real mtime (so it still counts as "not yet a valid verdict").
function readReviewFile(filePath: string): { mtimeMs: number; verdict: ReviewVerdict; commit: string | null } | null {
  if (!existsSync(filePath)) return null
  const mtimeMs = safeMtimeMs(filePath) ?? 0
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as { verdict?: unknown; commit?: unknown }
    const raw = typeof parsed.verdict === "string" ? parsed.verdict.toUpperCase() : ""
    const verdict: ReviewVerdict = raw === "PASS" ? "PASS" : raw === "FAIL" ? "FAIL" : "UNKNOWN"
    const commit = typeof parsed.commit === "string" && parsed.commit.trim() ? parsed.commit.trim() : null
    return { mtimeMs, verdict, commit }
  } catch {
    return { mtimeMs, verdict: "UNKNOWN", commit: null }
  }
}

function readSensors(workspace: string, slug: string): Sensors {
  const planPath = path.join(workspace, "docs", "specs", slug, "plan.md")
  const planExists = existsSync(planPath)
  const planTasks = parsePlanTasks(planPath)

  const manifestPath = featureStateManifestPath(workspace, slug)
  let manifestRaw = ""
  let manifestTasks: Record<string, { validatedCommit?: string }> = {}
  if (existsSync(manifestPath)) {
    try {
      manifestRaw = readFileSync(manifestPath, "utf-8")
      manifestTasks = (JSON.parse(manifestRaw) as { tasks?: Record<string, { validatedCommit?: string }> }).tasks ?? {}
    } catch {
      manifestTasks = {}
    }
  }

  const taskStatuses: Record<string, string> = {}
  const pendingIds: string[] = []
  const completedIds: string[] = []
  const taskReviews: Record<string, TaskReviewSensor> = {}
  const taskCommits: Record<string, string | null> = {}
  let lastValidatedCommit: string | null = null
  const progressMtimes: number[] = []
  const manifestMtime = safeMtimeMs(manifestPath)
  if (manifestMtime !== null) progressMtimes.push(manifestMtime)

  for (const task of planTasks) {
    const { statePath, canonReviewPath } = featureStateTaskPaths(workspace, slug, task.id)
    const stateMtime = safeMtimeMs(statePath)
    if (stateMtime !== null) progressMtimes.push(stateMtime)

    const content = existsSync(statePath) ? readFileSync(statePath, "utf-8") : ""
    const status = content.match(/\*\*Status\*\*:\s*([^\n]+)/)?.[1]?.trim() ?? "PENDING"
    taskStatuses[task.id] = status

    const validatedCommit = manifestTasks[task.id]?.validatedCommit
    taskCommits[task.id] = typeof validatedCommit === "string" && validatedCommit.trim() && validatedCommit !== "-" ? validatedCommit : null
    if (isTaskComplete(status, validatedCommit)) completedIds.push(task.id)
    else pendingIds.push(task.id)
    if (taskCommits[task.id]) lastValidatedCommit = taskCommits[task.id]

    // Canon review of this task's completion. A review is stale when it predates
    // the current execution-state.md (it reviewed an earlier attempt); the driver
    // then treats it as absent and re-dispatches.
    const review = readReviewFile(canonReviewPath)
    if (review) {
      taskReviews[task.id] = {
        mtimeMs: review.mtimeMs,
        verdict: review.verdict,
        commit: review.commit,
        stale: stateMtime !== null && review.mtimeMs < stateMtime,
      }
    }
  }

  // Proxy determinístico do "último commit": o bookkeeping do harness muda
  // junto com cada commit validado (manifest + execution-state).
  const lastProgressMs = progressMtimes.length > 0 ? Math.max(...progressMtimes) : null

  const checkReviewPath = path.join(featureStateDir(workspace, slug), "check-review.md")
  let checkReview: CheckReviewSensor | null = null
  if (existsSync(checkReviewPath)) {
    const content = readFileSync(checkReviewPath, "utf-8")
    const failureSection = extractFailureSection(content)
    const mtimeMs = safeMtimeMs(checkReviewPath) ?? 0
    // "Failure fingerprint: none" cobre só verificação; num BLOCKED por review
    // o fallback de normalização é o que carrega os findings para o guard.
    const fingerprint = parseFailureFingerprint(content)
    const routes = parseFailureRoutes(content)
    checkReview = {
      mtimeMs,
      verdict: parseCheckVerdict(content),
      failureHash: fingerprint && fingerprint.toLowerCase() !== "none"
        ? sha256(fingerprint)
        : sha256(normalizeFailureText(failureSection)),
      failureCount: countFailures(failureSection),
      stale: lastProgressMs !== null && mtimeMs < lastProgressMs,
      infraOnly: routes.length > 0 && routes.every((route) => route === "INFRA"),
    }
  }

  // Plan-level canon review. Fresh when newer than plan.md (a plan edited after
  // review re-triggers /j.review-plan).
  const planMtimeMs = safeMtimeMs(planPath)
  const planReviewRaw = readReviewFile(planReviewPath(workspace, slug))
  const planReview: PlanReviewSensor | null = planReviewRaw
    ? {
        mtimeMs: planReviewRaw.mtimeMs,
        verdict: planReviewRaw.verdict,
        fresh: planMtimeMs === null || planReviewRaw.mtimeMs >= planMtimeMs,
      }
    : null

  const statusFingerprint = planTasks.map((task) => `${task.id}=${taskStatuses[task.id]}`).join(";")
  const stateHash = sha256(manifestRaw + "\n" + statusFingerprint)

  return { planExists, planTasks, taskStatuses, pendingIds, completedIds, checkReview, planReview, taskReviews, taskCommits, lastValidatedCommit, stateHash }
}

// ---------------------------------------------------------------------------
// Decisão (pura: sensores + memória do loop → próximo comando)
// ---------------------------------------------------------------------------

type DecisionOptions = {
  until: Until
  maxCheckReentries: number
  unifyEnabled: boolean
  reviewPlan: boolean
  reviewImplement: boolean
  reviewMaxAttempts: number
  // workflow.automation.nonInteractive && workflow.automation.autoApproveArtifacts —
  // no FAIL da revisão de plano, este flag decide entre replan automático (true)
  // e ABORT interativo pro humano (false). É o MESMO gate que o planner respeita.
  automation: boolean
}

// A task's canon review is ACCEPTED only when it is present, carries a real
// verdict, is not stale versus the current completion, AND its mtime is later
// than the driver's own /j.review-task dispatch for that task (anti-forge window:
// the producer cannot pre-write a verdict with an mtime later than a dispatch the
// driver had not issued yet). Returns the review when accepted, else null.
function acceptedTaskReview(sensors: Sensors, loop: LoopState, id: string): TaskReviewSensor | null {
  const review = sensors.taskReviews[id]
  if (!review || review.verdict === "UNKNOWN" || review.stale) return null
  const dispatchedAt = loop.reviewDispatchedAt[id]
  if (dispatchedAt === undefined || !(review.mtimeMs > dispatchedAt)) return null
  return review
}

function decide(sensors: Sensors, loop: LoopState, opts: DecisionOptions): Decision {
  // --- Plan review: gates before ANY implementation. ---
  if (opts.reviewPlan) {
    // E6: um replan de automation anterior arquivou o plano (plan.md sumiu) mas o
    // feature já foi planejado (plan-review.json presente) → re-dispara /j.plan.
    // Só em automation: o driver NUNCA replaneja sozinho em modo interativo (isso
    // abriria um interview sem humano). O planner respeita workflow.automation e
    // relê plan-review.md como feedback de revisão (agents/j.planner.md).
    if (opts.automation && !sensors.planExists && sensors.planReview !== null) {
      return { kind: "run", command: "/j.plan", because: `plano arquivado após revisão canônica FAIL — replanejar (automation)` }
    }
    const planReview = sensors.planReview
    const accepted = planReview !== null && planReview.verdict !== "UNKNOWN" && planReview.fresh
    if (!accepted) {
      if (loop.planReviewAttempts >= opts.reviewMaxAttempts) {
        return { kind: "abort", because: `revisão canônica do plano não produziu veredito fresco após ${loop.planReviewAttempts} tentativa(s) — inspecione docs/specs/${loop.slug}/state/plan-review.md` }
      }
      return {
        kind: "run",
        command: "/j.review-plan",
        because: planReview ? "plan-review.json stale vs plan.md — re-revisar o plano" : "sem plan-review.json — revisar o plano antes de implementar",
      }
    }
    if (planReview!.verdict === "FAIL") {
      // Teto: o plano foi rejeitado reviewMaxAttempts× — para e chama o humano. O
      // revisor já melhorou canon/harness a cada FAIL; insistir sozinho não converge.
      // planReviewAttempts conta os dispatches de /j.review-plan (só reseta num PASS
      // fresco, ver main()), logo persiste através dos ciclos replan→review.
      if (loop.planReviewAttempts >= opts.reviewMaxAttempts) {
        return { kind: "abort", because: `revisão canônica do plano FALHOU ${loop.planReviewAttempts}× (teto ${opts.reviewMaxAttempts}) — leia docs/specs/${loop.slug}/state/plan-review.md e refaça o plano manualmente` }
      }
      // Automation: arquiva o plano rejeitado e replaneja (side-effect executado em
      // main(), nunca aqui nem em dry-run). O planner (workflow.automation) lê o
      // plan-review.md como feedback e escreve um plano novo.
      if (opts.automation) {
        return { kind: "replan", because: `revisão canônica do plano FALHOU — arquiva o plano e re-dispara /j.plan (automation, tentativa ${loop.planReviewAttempts + 1}/${opts.reviewMaxAttempts})` }
      }
      // Interativo (default): ABORTA SEM arquivar — deixa plan.md no lugar pro humano
      // revisar (evita o `die` da próxima iteração) e nunca abre interview sozinho.
      return { kind: "abort", because: `revisão canônica do plano FALHOU — leia docs/specs/${loop.slug}/state/plan-review.md, corrija o plano e rode /j.plan de novo (modo interativo: o driver não arquiva/replaneja o plano sozinho)` }
    }
    // PASS → segue.
  }

  // --- Task review: revisa cada task COMPLETE ANTES de liberar a próxima, para
  //     garantir que o HEAD ainda seja o commit revisado quando o undo dispara. ---
  if (opts.reviewImplement) {
    // FAIL tem prioridade: desfaz-e-refaz (ou teto → ABORT).
    for (const id of sensors.completedIds) {
      const review = acceptedTaskReview(sensors, loop, id)
      if (review && review.verdict === "FAIL") {
        const retries = loop.reviewRetries[id] ?? 0
        if (retries >= opts.reviewMaxAttempts) {
          return { kind: "abort", because: `revisão canônica da task ${id} falhou ${retries}× (teto ${opts.reviewMaxAttempts}) — canon já foi melhorado; inspecione docs/specs/${loop.slug}/state/tasks/task-${id}/canon-review.md e refaça manualmente` }
        }
        const commit = review.commit ?? sensors.taskCommits[id]
        if (!commit) {
          return { kind: "abort", because: `revisão da task ${id} FAIL mas sem commit para desfazer (canon-review.json.commit e manifest.validatedCommit ausentes)` }
        }
        return { kind: "undo", taskId: id, commit, because: `revisão canônica FAIL na task ${id} — desfaz-e-refaz (tentativa ${retries + 1}/${opts.reviewMaxAttempts})` }
      }
    }
    // Qualquer task COMPLETE sem review aceito → dispara /j.review-task.
    for (const id of sensors.completedIds) {
      if (!acceptedTaskReview(sensors, loop, id)) {
        return { kind: "run", command: "/j.review-task", because: `task ${id} completa e sem canon-review PASS aceito — revisar antes de seguir`, reviewTaskId: id }
      }
    }
  }

  if (sensors.pendingIds.length > 0) {
    return {
      kind: "run",
      command: "/j.implement",
      because: `${sensors.pendingIds.length} task(s) pendente(s): ${sensors.pendingIds.join(", ")} (${sensors.completedIds.length}/${sensors.planTasks.length} completas)`,
    }
  }

  if (UNTIL_ORDER[opts.until] < UNTIL_ORDER.check) {
    return { kind: "done", because: "todas as tasks completas e --until=implement" }
  }

  // unifyDone vem ANTES de qualquer lógica de staleness: o cleanup pós-unify
  // muda mtimes de bookkeeping e tornaria o check-review "stale", disparando
  // um /j.check redundante (e possível reentrada) DEPOIS do PR.
  if (loop.unifyDone && UNTIL_ORDER[opts.until] >= UNTIL_ORDER.unify) {
    return { kind: "done", because: "unify concluído — cleanup pós-PR não reabre check" }
  }

  const review = sensors.checkReview
  if (!review) {
    return { kind: "run", command: "/j.check", because: "todas as tasks completas e sem check-review.md" }
  }
  if (review.stale) {
    return { kind: "run", command: "/j.check", because: "check-review.md stale (bookkeeping do harness mais novo que o último check)" }
  }

  if (review.verdict === "BLOCKED") {
    // Exceção INFRA: falhas 100% roteadas para INFRA são problema de ambiente,
    // não de código — nunca consomem reentradas nem o guard de fingerprint.
    // Uma única re-execução de /j.check; se a segunda também for INFRA-only,
    // aborta com diagnóstico de ambiente (nunca /j.implement).
    if (review.infraOnly) {
      if (loop.infraRetryUsed) {
        return { kind: "abort", because: "check BLOCKED por INFRA 2x seguidas — ambiente quebrado; repare (ex.: make dependencies, ver ## Failure Routing do check-review.md) e re-rode o loop" }
      }
      return { kind: "run", command: "/j.check", because: "falhas 100% roteadas para INFRA — re-execução única do check (não conta como reentrada)", infraRetry: true }
    }

    // Guards de repetição/regressão só valem entre GERAÇÕES DISTINTAS do
    // check-review.md: se o arquivo não mudou desde o registro do último
    // fingerprint (reentrada sem novo check no meio), comparar seria comparar
    // o arquivo consigo mesmo → check stale, decide novo /j.check.
    if (loop.lastFailureReviewMtimeMs !== null && loop.lastFailureReviewMtimeMs === review.mtimeMs) {
      return { kind: "run", command: "/j.check", because: "check-review.md não regenerado desde a última reentrada — novo check antes de comparar falhas" }
    }
    if (loop.lastFailureHash !== null && loop.lastFailureHash === review.failureHash) {
      return { kind: "abort", because: "mesmas falhas 2x no check — beco sem saída, não persistência" }
    }
    if (loop.lastCheckFailureCount !== null && review.failureCount > loop.lastCheckFailureCount) {
      return {
        kind: "abort",
        because: `regressão: nº de falhas do check aumentou (${loop.lastCheckFailureCount} → ${review.failureCount})`,
        printRollback: true,
      }
    }
    if (loop.reentries >= opts.maxCheckReentries) {
      return { kind: "abort", because: `check BLOCKED e limite de reentradas atingido (${loop.reentries}/${opts.maxCheckReentries})` }
    }
    return {
      kind: "run",
      command: "/j.implement",
      because: `check BLOCKED — reentrada ${loop.reentries + 1}/${opts.maxCheckReentries}`,
      reentry: true,
    }
  }

  if (review.verdict === "GREEN") {
    if (UNTIL_ORDER[opts.until] >= UNTIL_ORDER.unify) {
      if (!opts.unifyEnabled) return { kind: "done", because: "check GREEN; workflow.unify.enabled=false na config" }
      if (!loop.unifyDone) return { kind: "run", command: "/j.unify", because: "check GREEN e --until=unify" }
      return { kind: "done", because: "check GREEN e unify concluído" }
    }
    return { kind: "done", because: "check GREEN e --until=check" }
  }

  return { kind: "abort", because: `check-review.md sem verdict reconhecível (GREEN/BLOCKED) — inspecione o arquivo` }
}

// ---------------------------------------------------------------------------
// Loop state (memória persistente do driver)
// ---------------------------------------------------------------------------

function loopStatePath(workspace: string, slug: string): string {
  return path.join(featureStateDir(workspace, slug), "loop-state.json")
}

// Cada invocação é um run novo (iterations zeradas), mas os contadores de
// guarda que são memória da FEATURE — reentradas, hash/nº de falhas do último
// check, unify já executado — sobrevivem entre invocações via loop-state.json.
function initLoopState(workspace: string, slug: string, until: Until): LoopState {
  let previous: Partial<LoopState> = {}
  const statePath = loopStatePath(workspace, slug)
  if (existsSync(statePath)) {
    try {
      previous = JSON.parse(readFileSync(statePath, "utf-8")) as Partial<LoopState>
    } catch {
      previous = {}
    }
  }

  return {
    startedAt: new Date().toISOString(),
    slug,
    until,
    status: "running",
    iterations: [],
    reentries: previous.reentries ?? 0,
    stallCount: 0,
    checkStallCount: 0,
    unifyDone: previous.unifyDone ?? false,
    lastFailureHash: previous.lastFailureHash ?? null,
    lastCheckFailureCount: previous.lastCheckFailureCount ?? null,
    lastFailureReviewMtimeMs: previous.lastFailureReviewMtimeMs ?? null,
    infraRetryUsed: previous.infraRetryUsed ?? false,
    reviewRetries: previous.reviewRetries ?? {},
    planReviewAttempts: previous.planReviewAttempts ?? 0,
    reviewDispatchedAt: previous.reviewDispatchedAt ?? {},
  }
}

function saveLoopState(workspace: string, slug: string, state: LoopState): void {
  mkdirSync(featureStateDir(workspace, slug), { recursive: true })
  writeJson(loopStatePath(workspace, slug), state)
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

function runOpencode(workspace: string, command: string, timeoutMs: number): { exitCode: number | null; stdoutTail: string; timedOut: boolean; spawnError: string | null } {
  const tmpDir = path.join(workspace, "tmp")
  mkdirSync(tmpDir, { recursive: true })

  const result = spawnSync("opencode", ["run", command], {
    cwd: workspace,
    env: {
      ...process.env,
      PATH: path.join(os.homedir(), ".opencode", "bin") + ":" + (process.env.PATH ?? ""),
      TMPDIR: tmpDir,
    },
    timeout: timeoutMs,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  })

  const timedOut = result.error != null && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT"
  const spawnError = result.error && !timedOut ? result.error.message : null
  const stdoutTail = ((result.stdout ?? "") + (result.stderr ? "\n[stderr] " + result.stderr : "")).slice(-2000)

  return { exitCode: result.status, stdoutTail, timedOut, spawnError }
}

function gitHead(repo: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null
  } catch {
    return null
  }
}

function gitResetHard(repo: string, ref: string): boolean {
  try {
    execFileSync("git", ["reset", "--hard", ref], { cwd: repo, stdio: ["ignore", "ignore", "ignore"] })
    return true
  } catch {
    return false
  }
}

function formatSensorSummary(sensors: Sensors, loop: LoopState, opts: DecisionOptions): string[] {
  const review = sensors.checkReview
  const reviewLine = review
    ? `${review.stale ? "stale" : "fresh"} ${review.verdict} (falhas=${review.failureCount} hash=${review.failureHash.slice(0, 8)}${review.infraOnly ? " infra-only" : ""})`
    : "ausente"
  const planReviewLine = sensors.planReview
    ? `${sensors.planReview.fresh ? "fresh" : "stale"} ${sensors.planReview.verdict}`
    : "ausente"
  const taskReviewLine = sensors.completedIds.length > 0
    ? sensors.completedIds.map((id) => `${id}=${acceptedTaskReview(sensors, loop, id)?.verdict ?? (sensors.taskReviews[id] ? "pendente" : "ausente")}`).join(" ")
    : "(nenhuma completa)"
  return [
    `  tasks: ${sensors.completedIds.length}/${sensors.planTasks.length} completas` + (sensors.pendingIds.length > 0 ? ` (pendentes: ${sensors.pendingIds.join(", ")})` : ""),
    `  check-review: ${reviewLine}`,
    `  reviews: plan=${planReviewLine}  tasks[${taskReviewLine}]`,
    `  reentries: ${loop.reentries}/${opts.maxCheckReentries}  unifyDone: ${loop.unifyDone}  infraRetryUsed: ${loop.infraRetryUsed}`,
  ]
}

function printRollbackHint(sensors: Sensors): void {
  if (sensors.lastValidatedCommit) {
    ok(`rollback sugerido (NÃO executado pelo loop):`)
    ok(`  git reset --hard ${sensors.lastValidatedCommit}`)
  } else {
    ok(`rollback: nenhum validatedCommit no manifest para sugerir git reset --hard`)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  const workspace = args.workspace
  const slug = resolveSlug(workspace, args.slug)

  const config = loadJuninhoConfig(workspace)
  const opts: DecisionOptions = {
    until: args.until,
    maxCheckReentries: config.workflow?.implement?.maxCheckReentries ?? 2,
    unifyEnabled: config.workflow?.unify?.enabled ?? true,
    reviewPlan: config.workflow?.review?.plan ?? true,
    reviewImplement: config.workflow?.review?.implement ?? true,
    reviewMaxAttempts: config.workflow?.review?.maxAttempts ?? 2,
    automation: (config.workflow?.automation?.nonInteractive ?? false) && (config.workflow?.automation?.autoApproveArtifacts ?? false),
  }

  const planPath = path.join(workspace, "docs", "specs", slug, "plan.md")
  // Janela do replan de automation (E6): um replan arquiva plan.md e a próxima
  // iteração re-dispara /j.plan. Se o processo reinicia exatamente nessa janela,
  // plan.md está ausente mas o replan continua pendente (plan-review.json presente
  // + automation) — não morra: o loop dispara /j.plan e regenera o plano.
  const replanPending = opts.reviewPlan && opts.automation && existsSync(planReviewPath(workspace, slug))
  if (!existsSync(planPath)) {
    if (!replanPending) {
      die(`plan.md não encontrado para slug '${slug}' em ${planPath} (slug inexistente ou plano ainda não gerado)`)
    }
  } else if (parsePlanTasks(planPath).length === 0) {
    die(`plan.md de '${slug}' não contém nenhuma task ("## Task N"): ${planPath}`)
  }

  const loop = initLoopState(workspace, slug, args.until)
  const timeoutMs = args.iterationTimeoutMin * 60 * 1000

  ok(`[loop] slug=${slug} until=${args.until} max=${args.maxIterations} timeout=${args.iterationTimeoutMin}min workspace=${workspace}${args.dryRun ? " [dry-run]" : ""}`)

  for (let n = 1; n <= args.maxIterations; n++) {
    const sensors = readSensors(workspace, slug)

    // Plan review APROVOU o plano (veredito PASS fresco) → zera o contador de
    // tentativas. Um FAIL fresco NÃO reseta: em automation cada FAIL gera um
    // replan+re-review, e o contador precisa acumular através desses ciclos para
    // que o teto (decide()) eventualmente pare e chame o humano.
    if (sensors.planReview && sensors.planReview.fresh && sensors.planReview.verdict === "PASS") {
      loop.planReviewAttempts = 0
    }

    const decision = decide(sensors, loop, opts)

    if (args.dryRun) {
      for (const line of formatSensorSummary(sensors, loop, opts)) ok(line)
      if (decision.kind === "run") ok(`decision: ${decision.command} — ${decision.because}`)
      else if (decision.kind === "undo") ok(`decision: UNDO task ${decision.taskId} @ ${decision.commit} — ${decision.because}`)
      else if (decision.kind === "replan") ok(`decision: REPLAN — ${decision.because}`)
      else if (decision.kind === "done") ok(`decision: DONE — ${decision.because}`)
      else {
        ok(`decision: ABORT — ${decision.because}`)
        if (decision.printRollback) printRollbackHint(sensors)
      }
      // Sem execução o estado em disco não muda (o undo NUNCA reseta em dry-run);
      // a decisão seguinte seria idêntica.
      process.exit(0)
    }

    if (decision.kind === "done") {
      loop.status = "done"
      saveLoopState(workspace, slug, loop)
      ok(`[loop] DONE após ${n - 1} iteração(ões) — ${decision.because}`)
      process.exit(0)
    }

    if (decision.kind === "abort") {
      loop.status = "aborted"
      loop.abortReason = decision.because
      saveLoopState(workspace, slug, loop)
      ok(`[loop] ABORT — ${decision.because}`)
      if (decision.printRollback) printRollbackHint(sensors)
      process.exit(2)
    }

    // Desfaz-e-refaz executado pelo DRIVER (nunca em dry-run; o dry-run já saiu
    // acima). Diferente do rollback de regressão do check (só impresso), o undo
    // de review é ação do driver: reset --hard do commit reprovado + limpeza do
    // state/manifest da task → próxima iteração vê a task PENDING → /j.implement.
    if (decision.kind === "undo") {
      const { taskId, commit } = decision
      const { taskDir, runtimePath } = featureStateTaskPaths(workspace, slug, taskId)
      let targetRepoRoot: string | null = null
      try {
        targetRepoRoot = (JSON.parse(readFileSync(runtimePath, "utf-8")) as { targetRepoRoot?: string }).targetRepoRoot ?? null
      } catch {
        targetRepoRoot = null
      }
      if (!targetRepoRoot) {
        loop.status = "aborted"
        loop.abortReason = `undo da task ${taskId} impossível: sem targetRepoRoot em ${runtimePath}`
        saveLoopState(workspace, slug, loop)
        ok(`[loop] ABORT — ${loop.abortReason}`)
        process.exit(2)
      }
      const repo = path.isAbsolute(targetRepoRoot) ? targetRepoRoot : path.join(workspace, targetRepoRoot)
      const head = gitHead(repo)
      if (head !== commit) {
        // O commit revisado não é mais o HEAD: outra task (ou um humano) empilhou
        // commits por cima. Um reset --hard aqui apagaria trabalho não revisado.
        loop.status = "aborted"
        loop.abortReason = `undo da task ${taskId} abortado: HEAD (${head ?? "?"}) != commit revisado (${commit}) em ${repo} — commits empilharam; desfaça manualmente`
        saveLoopState(workspace, slug, loop)
        ok(`[loop] ABORT — ${loop.abortReason}`)
        process.exit(2)
      }
      if (!gitResetHard(repo, `${commit}^`)) {
        loop.status = "aborted"
        loop.abortReason = `undo da task ${taskId} falhou: git reset --hard ${commit}^ não completou em ${repo}`
        saveLoopState(workspace, slug, loop)
        ok(`[loop] ABORT — ${loop.abortReason}`)
        process.exit(2)
      }
      rmSync(taskDir, { recursive: true, force: true })
      removeTaskFromManifest(workspace, slug, taskId)
      loop.reviewRetries[taskId] = (loop.reviewRetries[taskId] ?? 0) + 1
      loop.iterations.push({
        n,
        command: `undo:task-${taskId}`,
        decidedBecause: decision.because,
        startedAt: new Date().toISOString(),
        durationMs: 0,
        exitCode: null,
        stateHashAfter: readSensors(workspace, slug).stateHash,
        outcomeSummary: `reset --hard ${commit}^ em ${repo}; state/tasks/task-${taskId} removido; manifest limpo; reviewRetries[${taskId}]=${loop.reviewRetries[taskId]}`,
      })
      saveLoopState(workspace, slug, loop)
      ok(`[loop] iter ${n}/${args.maxIterations} — UNDO task ${taskId} — reset ${repo} → ${commit}^ (tentativa ${loop.reviewRetries[taskId]}/${opts.reviewMaxAttempts})`)
      continue
    }

    // E6 — Replan em automation: arquiva o plano rejeitado e deixa a PRÓXIMA
    // iteração re-disparar /j.plan (decide() vê plan.md ausente + plan-review.json
    // presente). Só chega aqui em automation (decide() gateia); nunca em dry-run (o
    // dry-run já saiu acima) e NUNCA em modo interativo (lá a decisão é ABORT, que
    // deixa plan.md no lugar pro humano). Arquivar em vez de deletar preserva o
    // histórico e mata o plano ativo, evitando que o `die` de plan.md ausente re-arme.
    if (decision.kind === "replan") {
      if (!existsSync(planPath)) {
        loop.status = "aborted"
        loop.abortReason = `replan de '${slug}' impossível: plan.md ausente em ${planPath} (arquivamento já ocorreu?)`
        saveLoopState(workspace, slug, loop)
        ok(`[loop] ABORT — ${loop.abortReason}`)
        process.exit(2)
      }
      const stateDir = featureStateDir(workspace, slug)
      mkdirSync(stateDir, { recursive: true })
      let rejectedIndex = 1
      while (existsSync(path.join(stateDir, `plan.rejected-${rejectedIndex}.md`))) rejectedIndex++
      const archivedPath = path.join(stateDir, `plan.rejected-${rejectedIndex}.md`)
      renameSync(planPath, archivedPath)
      loop.iterations.push({
        n,
        command: "replan:archive-plan",
        decidedBecause: decision.because,
        startedAt: new Date().toISOString(),
        durationMs: 0,
        exitCode: null,
        stateHashAfter: readSensors(workspace, slug).stateHash,
        outcomeSummary: `plan.md arquivado em ${archivedPath}; próxima iteração re-dispara /j.plan (feedback em ${planReviewPath(workspace, slug).replace(/\.json$/, ".md")})`,
      })
      saveLoopState(workspace, slug, loop)
      ok(`[loop] iter ${n}/${args.maxIterations} — REPLAN — plano rejeitado arquivado em ${archivedPath}; próxima iteração re-dispara /j.plan`)
      continue
    }

    // Anti-forja: registra o instante do dispatch de /j.review-task ANTES de rodar,
    // para que o canon-review.json produzido nesta iteração (mtime posterior) seja
    // aceito e um veredito pré-forjado pelo produtor (mtime anterior) seja recusado.
    if (decision.command === "/j.review-task" && decision.reviewTaskId) {
      loop.reviewDispatchedAt[decision.reviewTaskId] = Date.now()
    }
    // Teto de dispatch de /j.review-plan: conta a tentativa ANTES de rodar.
    if (decision.command === "/j.review-plan") {
      loop.planReviewAttempts += 1
    }

    // Memória de guarda registrada ANTES de executar a reentrada, para que a
    // próxima leitura do check compare contra este pass. O mtime registra a
    // GERAÇÃO do check-review de origem: fingerprints só são comparados entre
    // gerações distintas do arquivo.
    if (decision.reentry && sensors.checkReview) {
      loop.reentries += 1
      loop.lastFailureHash = sensors.checkReview.failureHash
      loop.lastCheckFailureCount = sensors.checkReview.failureCount
      loop.lastFailureReviewMtimeMs = sensors.checkReview.mtimeMs
    }
    // Exceção INFRA: marca a re-execução única ANTES de rodar o /j.check.
    if (decision.infraRetry) loop.infraRetryUsed = true

    ok(`[loop] iter ${n}/${args.maxIterations} — ${decision.command} — ${decision.because}`)

    const iterationStartedAt = new Date().toISOString()
    const startedMs = Date.now()
    // /j.plan (replan de automation): re-dispara o planner com o slug e um ponteiro
    // pro feedback da revisão — o planner respeita workflow.automation e relê o
    // plan-review.md. O log/histórico registra o comando literal (decision.command).
    const runMessage = decision.command === "/j.plan"
      ? `/j.plan revise ${slug} — plano rejeitado pela revisão canônica; leia docs/specs/${slug}/state/plan-review.md e resolva os pontos levantados ou cite a task que autoriza a divergência`
      : decision.command
    const run = runOpencode(workspace, runMessage, timeoutMs)
    const durationMs = Date.now() - startedMs

    if (run.spawnError) {
      loop.status = "aborted"
      loop.abortReason = `falha ao spawnar opencode: ${run.spawnError}`
      saveLoopState(workspace, slug, loop)
      die(`falha ao executar 'opencode run ${decision.command}': ${run.spawnError} (opencode está no PATH?)`)
    }

    const after = readSensors(workspace, slug)

    // Guarda (b) STALL: /j.implement sem nenhum efeito no estado do harness.
    if (decision.command === "/j.implement") {
      if (after.stateHash === sensors.stateHash) loop.stallCount += 1
      else loop.stallCount = 0
    }
    // Guarda análoga para /j.check que não persiste check-review novo.
    if (decision.command === "/j.check") {
      const mtimeBefore = sensors.checkReview?.mtimeMs ?? null
      const mtimeAfter = after.checkReview?.mtimeMs ?? null
      if (mtimeAfter === mtimeBefore) loop.checkStallCount += 1
      else loop.checkStallCount = 0
      // Episódio INFRA encerrado: um check novo sem rota INFRA-only devolve o
      // direito à re-execução única para um futuro problema de ambiente.
      if (after.checkReview && !after.checkReview.infraOnly && mtimeAfter !== mtimeBefore) {
        loop.infraRetryUsed = false
      }
    }

    loop.iterations.push({
      n,
      command: decision.command,
      decidedBecause: decision.because,
      startedAt: iterationStartedAt,
      durationMs,
      exitCode: run.exitCode,
      stateHashAfter: after.stateHash,
      outcomeSummary: run.timedOut ? `TIMEOUT após ${args.iterationTimeoutMin}min\n` + run.stdoutTail : run.stdoutTail,
    })
    saveLoopState(workspace, slug, loop)

    ok(
      `[loop] iter ${n}/${args.maxIterations} — ${decision.command} — exit=${run.exitCode ?? "kill"}${run.timedOut ? " (timeout)" : ""} — ${Math.round(durationMs / 1000)}s — progresso ${after.completedIds.length}/${after.planTasks.length} tasks`,
    )

    if (decision.command === "/j.unify") {
      if ((run.exitCode ?? 1) === 0) {
        loop.unifyDone = true
        saveLoopState(workspace, slug, loop)
      } else {
        loop.status = "aborted"
        loop.abortReason = `/j.unify falhou (exit=${run.exitCode ?? "kill"}) — unify não é retryável com segurança`
        saveLoopState(workspace, slug, loop)
        ok(`[loop] ABORT — ${loop.abortReason}`)
        process.exit(2)
      }
    }

    if (loop.stallCount >= 2) {
      loop.status = "aborted"
      loop.abortReason = "STALL: 2 iterações de /j.implement sem nenhuma mudança no estado do harness (integration-state + statuses)"
      saveLoopState(workspace, slug, loop)
      ok(`[loop] ABORT — ${loop.abortReason}`)
      ok(`[loop] diagnóstico: statuses=${JSON.stringify(after.taskStatuses)} — última saída:\n${run.stdoutTail}`)
      process.exit(2)
    }
    if (loop.checkStallCount >= 2) {
      loop.status = "aborted"
      loop.abortReason = "STALL: 2 iterações de /j.check sem produzir check-review.md novo"
      saveLoopState(workspace, slug, loop)
      ok(`[loop] ABORT — ${loop.abortReason}`)
      process.exit(2)
    }
  }

  loop.status = "aborted"
  loop.abortReason = `maxIterations atingido (${args.maxIterations}) sem alcançar '${args.until}'`
  saveLoopState(workspace, slug, loop)
  ok(`[loop] ABORT — ${loop.abortReason}`)
  process.exit(2)
}

if (import.meta.main) main()
