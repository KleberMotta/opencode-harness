import { execFileSync } from "child_process"
import { existsSync, statSync } from "fs"
import path from "path"
import { createSkillMapResolver, resolveSkillPath, type CompiledEntry } from "../lib/j.skill-map"
import { die, ok } from "./_lib"

// Mechanical audit of skill coverage for a target repo: which files the agent
// can write with a defined pattern, and which it would write blind.
//
// Uses ../lib/j.skill-map.ts — the same resolution the j.skill-inject plugin
// runs at runtime — so the numbers reported here are the numbers the agent
// actually gets. Patterns are tested against the absolute path because that is
// what the Read/Write tools hand the plugin.

const workspaceRoot = path.resolve(import.meta.dir, "..", "..")

const IGNORED_SEGMENTS = new Set([
  ".git",
  ".gradle",
  ".idea",
  "build",
  "dist",
  "node_modules",
  "out",
  "target",
])

const CODE_EXTENSIONS = new Set([".kt", ".java"])

type SkillMatch = { skill: string; source: CompiledEntry["source"]; resolved: boolean }
type FileRow = { rel: string; abs: string; matches: SkillMatch[]; covered: SkillMatch[] }
type PatternStat = { pattern: string; skill: string; source: CompiledEntry["source"]; files: number }
type CoverageStat = { total: number; covered: number; pct: number }
type Cluster = { cluster: string; count: number; example: string }

function parseArgs(argv: string[]): { repo: string; json: boolean } {
  let repo = ""
  let json = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--json") json = true
    else if (arg === "--repo") repo = argv[++i] ?? ""
    else if (arg.startsWith("--repo=")) repo = arg.slice("--repo=".length)
    else die(`argumento desconhecido: ${arg}\nuso: bun run skills:coverage -- --repo <path> [--json]`)
  }

  if (!repo) die("--repo <path> é obrigatório\nuso: bun run skills:coverage -- --repo <path> [--json]")

  const resolved = path.resolve(repo)
  if (!existsSync(resolved)) die(`repo não encontrado: ${resolved}`)
  try {
    if (!statSync(resolved).isDirectory()) die(`--repo precisa ser um diretório: ${resolved}`)
  } catch {
    die(`repo ilegível: ${resolved}`)
  }

  return { repo: resolved, json }
}

function ignored(rel: string): boolean {
  return rel.split("/").some((segment) => IGNORED_SEGMENTS.has(segment))
}

function listFiles(repoRoot: string): { files: string[]; source: string } {
  try {
    const stdout = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], {
      encoding: "utf-8",
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
    const files = stdout.split("\0").filter(Boolean)
    if (files.length > 0) return { files, source: "git ls-files" }
  } catch {
    // not a git repo (or git unavailable) — fall through to find
  }

  const stdout = execFileSync("find", [repoRoot, "-type", "f"], {
    encoding: "utf-8",
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  })
  const files = stdout
    .split("\n")
    .filter(Boolean)
    .map((absolute) => path.relative(repoRoot, absolute).split(path.sep).join("/"))
  return { files, source: "find" }
}

// Groups an uncovered file with its siblings of the same shape: same directory
// and same trailing type word (FooRepository.kt -> */*Repository.kt), falling
// back to the extension when the name carries no type word.
function clusterKey(rel: string): string {
  const dir = path.posix.dirname(rel)
  const base = path.posix.basename(rel)
  const ext = path.posix.extname(base)
  const stem = ext ? base.slice(0, -ext.length) : base
  const typeWord = stem.match(/(?:[A-Z][a-z0-9]+|[A-Z]+)$/)
  const suffix = typeWord ? `*${typeWord[0]}${ext}` : `*${ext || base}`
  return dir === "." ? suffix : `${dir}/${suffix}`
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length)
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

// Paths carry their signal in the tail (.../exception/*Exception.kt), so drop
// the head instead of the end.
function truncatePath(value: string, max: number): string {
  return value.length <= max ? value : `…${value.slice(value.length - (max - 1))}`
}

function pct(covered: number, total: number): number {
  return total === 0 ? 0 : Math.round((covered / total) * 1000) / 10
}

function coverageFor(rows: FileRow[], predicate: (rel: string) => boolean): CoverageStat {
  const scoped = rows.filter((row) => predicate(row.rel))
  const covered = scoped.filter((row) => row.covered.length > 0).length
  return { total: scoped.length, covered, pct: pct(covered, scoped.length) }
}

function isCode(rel: string): boolean {
  return CODE_EXTENSIONS.has(path.posix.extname(rel))
}

const { repo, json } = parseArgs(process.argv.slice(2))
const getSkillMap = createSkillMapResolver(workspaceRoot)
const { files, source: fileSource } = listFiles(repo)

const patternStats = new Map<string, PatternStat>()
const skillPathCache = new Map<string, string | null>()
const rows: FileRow[] = []

for (const rel of files) {
  if (ignored(rel)) continue
  const abs = path.join(repo, rel)
  if (!existsSync(abs)) continue // tracked but deleted in the working tree

  const entries = getSkillMap(abs)
  for (const entry of entries) {
    const key = `${entry.source}::${entry.skill}::${entry.pattern.source}`
    if (!patternStats.has(key)) {
      patternStats.set(key, { pattern: entry.pattern.source, skill: entry.skill, source: entry.source, files: 0 })
    }
  }

  const matched = entries.filter((entry) => entry.pattern.test(abs))
  const matches: SkillMatch[] = []
  const seenSkills = new Set<string>()

  for (const entry of matched) {
    const statKey = `${entry.source}::${entry.skill}::${entry.pattern.source}`
    patternStats.get(statKey)!.files += 1

    if (seenSkills.has(entry.skill)) continue
    seenSkills.add(entry.skill)

    const cacheKey = `${entry.skill}::${path.dirname(abs)}`
    if (!skillPathCache.has(cacheKey)) skillPathCache.set(cacheKey, resolveSkillPath(workspaceRoot, entry.skill, abs))
    matches.push({ skill: entry.skill, source: entry.source, resolved: skillPathCache.get(cacheKey) !== null })
  }

  // A pattern whose SKILL.md cannot be resolved never injects anything, so it
  // does not count as coverage — same rule the plugin applies.
  rows.push({ rel, abs, matches, covered: matches.filter((match) => match.resolved) })
}

const bySkill = new Map<string, { skill: string; source: CompiledEntry["source"]; resolved: boolean; files: string[] }>()
for (const row of rows) {
  for (const match of row.matches) {
    const current = bySkill.get(match.skill) ?? { skill: match.skill, source: match.source, resolved: match.resolved, files: [] }
    current.files.push(row.rel)
    bySkill.set(match.skill, current)
  }
}
const skillRows = Array.from(bySkill.values()).sort((a, b) => b.files.length - a.files.length || a.skill.localeCompare(b.skill))

const srcMainCode = (rel: string) => rel.startsWith("src/main/") && isCode(rel)
const srcTestCode = (rel: string) => rel.startsWith("src/test/") && isCode(rel)
const coverage = {
  overall: coverageFor(rows, (rel) => srcMainCode(rel) || srcTestCode(rel)),
  srcMain: coverageFor(rows, srcMainCode),
  srcTest: coverageFor(rows, srcTestCode),
}

const uncovered = rows.filter((row) => row.covered.length === 0)
const clusterMap = new Map<string, Cluster>()
for (const row of uncovered) {
  const key = clusterKey(row.rel)
  const current = clusterMap.get(key) ?? { cluster: key, count: 0, example: row.rel }
  current.count += 1
  clusterMap.set(key, current)
}
const clusters = Array.from(clusterMap.values()).sort((a, b) => b.count - a.count || a.cluster.localeCompare(b.cluster))

const deadPatterns = Array.from(patternStats.values())
  .filter((stat) => stat.files === 0)
  .sort((a, b) => a.skill.localeCompare(b.skill) || a.pattern.localeCompare(b.pattern))

const conflicts = rows
  .filter((row) => row.covered.length >= 2)
  .map((row) => ({ file: row.rel, skills: row.covered.map((match) => `${match.skill} (${match.source})`) }))

const unresolved = skillRows.filter((entry) => !entry.resolved)

if (json) {
  console.log(JSON.stringify({
    repo,
    workspaceRoot,
    fileSource,
    inWorkspace: repo.startsWith(workspaceRoot + path.sep),
    totals: { files: rows.length, covered: rows.length - uncovered.length, uncovered: uncovered.length },
    skills: skillRows.map((entry) => ({
      skill: entry.skill,
      source: entry.source,
      resolved: entry.resolved,
      files: entry.files.length,
      examples: entry.files.slice(0, 2),
    })),
    coverage,
    gaps: { total: uncovered.length, clusterCount: clusters.length, clusters },
    deadPatterns,
    conflicts: { total: conflicts.length, items: conflicts },
  }, null, 2))
  process.exit(0)
}

ok(`repo:      ${repo}`)
ok(`workspace: ${workspaceRoot}`)
ok(`arquivos:  ${rows.length} (via ${fileSource}, sem build/target/node_modules)`)
if (!repo.startsWith(workspaceRoot + path.sep)) {
  ok("aviso:     repo fora do workspace — só o skill-map do workspace se aplica (sem camada de projeto/contexto)")
}

ok("")
ok("SKILLS ATIVADAS")
if (skillRows.length === 0) {
  ok("  nenhuma skill dispara neste repo")
} else {
  ok(`  ${pad("skill", 30)}${pad("origem", 11)}${pad("arquivos", 10)}exemplos`)
  for (const entry of skillRows) {
    const flag = entry.resolved ? "" : "  !! SKILL.md não encontrado (não injeta)"
    const examples = entry.files.slice(0, 2).map((file) => truncatePath(file, 58)).join(", ")
    ok(`  ${pad(truncate(entry.skill, 29), 30)}${pad(entry.source, 11)}${pad(String(entry.files.length), 10)}${examples}${flag}`)
  }
}

ok("")
ok("COBERTURA (.kt/.java em src/main + src/test com >=1 skill)")
ok(`  total:     ${coverage.overall.covered}/${coverage.overall.total} = ${coverage.overall.pct}%`)
ok(`  src/main:  ${coverage.srcMain.covered}/${coverage.srcMain.total} = ${coverage.srcMain.pct}%`)
ok(`  src/test:  ${coverage.srcTest.covered}/${coverage.srcTest.total} = ${coverage.srcTest.pct}%`)

ok("")
ok(`LACUNAS (${uncovered.length} arquivos sem skill em ${clusters.length} clusters)`)
if (clusters.length === 0) {
  ok("  nenhuma")
} else {
  for (const cluster of clusters.slice(0, 10)) {
    ok(`  ${pad(String(cluster.count), 6)}${pad(truncatePath(cluster.cluster, 64), 65)}ex: ${truncatePath(cluster.example, 54)}`)
  }
  if (clusters.length > 10) ok(`  ... +${clusters.length - 10} clusters (use --json para todos)`)
}

ok("")
ok(`PATTERNS MORTOS (${deadPatterns.length} entradas do skill-map que não casam nenhum arquivo)`)
if (deadPatterns.length === 0) {
  ok("  nenhum")
} else {
  for (const stat of deadPatterns) {
    ok(`  ${pad(truncate(stat.skill, 29), 30)}${pad(stat.source, 11)}${truncate(stat.pattern, 70)}`)
  }
}

ok("")
ok(`CONFLITOS (${conflicts.length} arquivos casam >=2 skills — sobreposição pode ser intencional)`)
if (conflicts.length === 0) {
  ok("  nenhum")
} else {
  for (const conflict of conflicts.slice(0, 10)) {
    ok(`  ${pad(truncatePath(conflict.file, 62), 63)}${conflict.skills.join(" + ")}`)
  }
  if (conflicts.length > 10) ok(`  ... +${conflicts.length - 10} arquivos (use --json para todos)`)
}

if (unresolved.length > 0) {
  ok("")
  ok(`aviso: ${unresolved.length} skill(s) mapeadas sem SKILL.md resolvível: ${unresolved.map((entry) => entry.skill).join(", ")}`)
}
