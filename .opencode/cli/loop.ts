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
import { spawnSync } from "child_process"
import { createHash } from "crypto"
import { existsSync, mkdirSync, readFileSync, statSync } from "fs"
import os from "os"
import path from "path"
import { die, ok, writeJson } from "./_lib"
import { loadJuninhoConfig } from "../lib/j.juninho-config"
import { featureStateDir, featureStateManifestPath, featureStateTaskPaths } from "../lib/j.feature-state-paths"

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

type CheckReviewSensor = {
  mtimeMs: number
  verdict: CheckVerdict
  failureHash: string
  failureCount: number
  stale: boolean
  infraOnly: boolean
}

type Sensors = {
  planTasks: PlanTask[]
  taskStatuses: Record<string, string>
  pendingIds: string[]
  completedIds: string[]
  checkReview: CheckReviewSensor | null
  lastValidatedCommit: string | null
  stateHash: string
}

type Decision =
  | { kind: "run"; command: "/j.implement" | "/j.check" | "/j.unify"; because: string; reentry?: boolean; infraRetry?: boolean }
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

function readSensors(workspace: string, slug: string): Sensors {
  const planPath = path.join(workspace, "docs", "specs", slug, "plan.md")
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
  let lastValidatedCommit: string | null = null
  const progressMtimes: number[] = []
  const manifestMtime = safeMtimeMs(manifestPath)
  if (manifestMtime !== null) progressMtimes.push(manifestMtime)

  for (const task of planTasks) {
    const { statePath } = featureStateTaskPaths(workspace, slug, task.id)
    const stateMtime = safeMtimeMs(statePath)
    if (stateMtime !== null) progressMtimes.push(stateMtime)

    const content = existsSync(statePath) ? readFileSync(statePath, "utf-8") : ""
    const status = content.match(/\*\*Status\*\*:\s*([^\n]+)/)?.[1]?.trim() ?? "PENDING"
    taskStatuses[task.id] = status

    const validatedCommit = manifestTasks[task.id]?.validatedCommit
    if (isTaskComplete(status, validatedCommit)) completedIds.push(task.id)
    else pendingIds.push(task.id)
    if (typeof validatedCommit === "string" && validatedCommit.trim() && validatedCommit !== "-") {
      lastValidatedCommit = validatedCommit
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

  const statusFingerprint = planTasks.map((task) => `${task.id}=${taskStatuses[task.id]}`).join(";")
  const stateHash = sha256(manifestRaw + "\n" + statusFingerprint)

  return { planTasks, taskStatuses, pendingIds, completedIds, checkReview, lastValidatedCommit, stateHash }
}

// ---------------------------------------------------------------------------
// Decisão (pura: sensores + memória do loop → próximo comando)
// ---------------------------------------------------------------------------

type DecisionOptions = { until: Until; maxCheckReentries: number; unifyEnabled: boolean }

function decide(sensors: Sensors, loop: LoopState, opts: DecisionOptions): Decision {
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

function formatSensorSummary(sensors: Sensors, loop: LoopState, opts: DecisionOptions): string[] {
  const review = sensors.checkReview
  const reviewLine = review
    ? `${review.stale ? "stale" : "fresh"} ${review.verdict} (falhas=${review.failureCount} hash=${review.failureHash.slice(0, 8)}${review.infraOnly ? " infra-only" : ""})`
    : "ausente"
  return [
    `  tasks: ${sensors.completedIds.length}/${sensors.planTasks.length} completas` + (sensors.pendingIds.length > 0 ? ` (pendentes: ${sensors.pendingIds.join(", ")})` : ""),
    `  check-review: ${reviewLine}`,
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

  const planPath = path.join(workspace, "docs", "specs", slug, "plan.md")
  if (!existsSync(planPath)) {
    die(`plan.md não encontrado para slug '${slug}' em ${planPath} (slug inexistente ou plano ainda não gerado)`)
  }
  if (parsePlanTasks(planPath).length === 0) {
    die(`plan.md de '${slug}' não contém nenhuma task ("## Task N"): ${planPath}`)
  }

  const config = loadJuninhoConfig(workspace)
  const opts: DecisionOptions = {
    until: args.until,
    maxCheckReentries: config.workflow?.implement?.maxCheckReentries ?? 2,
    unifyEnabled: config.workflow?.unify?.enabled ?? true,
  }

  const loop = initLoopState(workspace, slug, args.until)
  const timeoutMs = args.iterationTimeoutMin * 60 * 1000

  ok(`[loop] slug=${slug} until=${args.until} max=${args.maxIterations} timeout=${args.iterationTimeoutMin}min workspace=${workspace}${args.dryRun ? " [dry-run]" : ""}`)

  for (let n = 1; n <= args.maxIterations; n++) {
    const sensors = readSensors(workspace, slug)
    const decision = decide(sensors, loop, opts)

    if (args.dryRun) {
      for (const line of formatSensorSummary(sensors, loop, opts)) ok(line)
      if (decision.kind === "run") ok(`decision: ${decision.command} — ${decision.because}`)
      else if (decision.kind === "done") ok(`decision: DONE — ${decision.because}`)
      else {
        ok(`decision: ABORT — ${decision.because}`)
        if (decision.printRollback) printRollbackHint(sensors)
      }
      // Sem execução o estado em disco não muda; a decisão seguinte seria idêntica.
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
    const run = runOpencode(workspace, decision.command, timeoutMs)
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
