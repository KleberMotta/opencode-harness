import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { buildCanonAuditCoverage, canonAuditVerdict } from "../../../lib/j.canon-audit"
import { createGitRepo, createTempDir, removeDir, runCommand } from "../../lib/test-utils"

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) removeDir(tempDirs.pop()!)
})

function scaffold(): { root: string; entity: string; plan: string } {
  const root = createTempDir("juninho-canon-audit-")
  tempDirs.push(root)
  const contextRoot = path.join(root, "contexts", "trp", ".context")
  const repo = path.join(root, "contexts", "trp", "seller-api")
  const entity = path.join(repo, "src", "main", "kotlin", "seller", "persistence", "entity", "SellerEntity.kt")
  const plan = path.join(root, "docs", "specs", "feature-x", "plan.md")
  mkdirSync(path.dirname(entity), { recursive: true })
  mkdirSync(path.join(contextRoot, "skills", "j.entity-writing"), { recursive: true })
  mkdirSync(path.dirname(plan), { recursive: true })
  createGitRepo(repo)
  writeFileSync(
    path.join(contextRoot, "skill-map.json"),
    JSON.stringify([{ pattern: "persistence/entity/.*Entity\\.kt$", skill: "j.entity-writing" }], null, 2) + "\n",
    "utf-8"
  )
  writeFileSync(
    path.join(contextRoot, "skills", "j.entity-writing", "SKILL.md"),
    [
      "---",
      "name: j.entity-writing",
      "description: entity test canon",
      "---",
      "",
      "## Required Steps",
      "- For required JSONB, initialize the value in the owning creation factory.",
      "",
      "## Anti-patterns to avoid",
      "- Defaulting a required JSONB value object in an entity constructor instead of the aggregate's creation factory.",
      "",
    ].join("\n"),
    "utf-8"
  )
  writeFileSync(
    entity,
    [
      "class SellerEntity(",
      "  @JdbcTypeCode(SqlTypes.JSON)",
      "  @Column(name = \"preferences\", nullable = false, columnDefinition = \"jsonb\")",
      "  var preferences: SellerPreferences = SellerPreferences(),",
      ")",
      "",
    ].join("\n"),
    "utf-8"
  )
  writeFileSync(
    plan,
    [
      "## Task 1 - Add preferences",
      "",
      "### Files",
      `- \`${path.relative(repo, entity)}\``,
      "",
      "### Action",
      "- Initialize preferences in the entity constructor and creation factory.",
      "",
      "### Done Criteria",
      "- New sellers have default preferences.",
      "",
    ].join("\n"),
    "utf-8"
  )
  return { root, entity, plan }
}

function scaffoldOutputChange(options: { optional: boolean }): {
  root: string
  repo: string
  output: string
  plan: string
  commit: string
} {
  const root = createTempDir("juninho-canon-output-")
  tempDirs.push(root)
  const contextRoot = path.join(root, "contexts", "trp", ".context")
  const repo = path.join(root, "contexts", "trp", "seller-api")
  const output = path.join(repo, "src", "main", "kotlin", "seller", "model", "AccountOutput.kt")
  const caller = path.join(repo, "src", "test", "kotlin", "seller", "AccountOutputTest.kt")
  const plan = path.join(root, "docs", "specs", "feature-x", "plan.md")
  mkdirSync(path.dirname(output), { recursive: true })
  mkdirSync(path.dirname(caller), { recursive: true })
  mkdirSync(path.join(contextRoot, "skills", "j.model-writing"), { recursive: true })
  mkdirSync(path.dirname(plan), { recursive: true })
  createGitRepo(repo)
  writeFileSync(
    path.join(contextRoot, "skill-map.json"),
    JSON.stringify([{ pattern: "model/.*Output\\.kt$", skill: "j.model-writing" }], null, 2) + "\n",
    "utf-8"
  )
  writeFileSync(
    path.join(contextRoot, "skills", "j.model-writing", "SKILL.md"),
    [
      "---",
      "name: j.model-writing",
      "description: model test canon",
      "---",
      "",
      "## Required Steps",
      "- Keep mandatory output properties non-null and explicit; defaults are reserved for genuinely optional properties.",
      "- Preserve the local constructor shape and update every direct caller when adding a required property.",
      "",
    ].join("\n"),
    "utf-8"
  )
  writeFileSync(
    output,
    [
      "package seller.model",
      "",
      "data class AccountOutput(",
      "    val id: String,",
      "    val accountId: String,",
      "    val status: String,",
      ")",
      "",
    ].join("\n"),
    "utf-8"
  )
  writeFileSync(
    caller,
    "package seller\n\nimport seller.model.AccountOutput\n\nval output = AccountOutput(id = \"id\", accountId = \"account\", status = \"ACTIVE\")\n",
    "utf-8"
  )
  writeFileSync(
    plan,
    [
      "## Task 1 - Add account output field",
      "",
      "### Files",
      `- \`${path.relative(repo, output)}\``,
      "",
      "### Action",
      options.optional
        ? "- Add nullable note to AccountOutput; omission is part of the optional contract."
        : "- Add required preferences to AccountOutput and propagate it from the source.",
      "",
      "### Done Criteria",
      "- AccountOutput exposes the new field.",
      "",
    ].join("\n"),
    "utf-8"
  )
  runCommand("git", ["add", "."], { cwd: repo })
  runCommand("git", ["commit", "-m", "seed output pattern"], { cwd: repo })

  const addedProperty = options.optional
    ? "    val note: String? = null,"
    : "    val preferences: Preferences = Preferences(),"
  const baseline = readFileSync(output, "utf-8")
  writeFileSync(output, baseline.replace("    val status: String,", `    val status: String,\n${addedProperty}`), "utf-8")
  if (!options.optional) {
    writeFileSync(
      path.join(path.dirname(output), "Preferences.kt"),
      "package seller.model\n\ndata class Preferences(val enabled: Boolean = false)\n",
      "utf-8"
    )
  }
  runCommand("git", ["add", "."], { cwd: repo })
  runCommand("git", ["commit", "-m", "candidate output change"], { cwd: repo })
  const commit = runCommand("git", ["rev-parse", "HEAD"], { cwd: repo }).stdout.trim()
  return { root, repo, output, plan, commit }
}

describe("canon audit coverage (mechanical detection)", () => {
  test("detects the required JSONB constructor default and the plan conflict", () => {
    const { root, entity, plan } = scaffold()
    const coverage = buildCanonAuditCoverage(root, "PRE_WRITE", [entity], { planPath: plan, taskId: "1" })

    expect(coverage.files[0]?.mechanicalFindings).toContain(
      "Required JSONB property 'preferences' has constructor default 'SellerPreferences(...)'."
    )
    expect(coverage.files[0]?.planFindings[0]).toContain("Initialize preferences in the entity constructor")

    // A mechanical code deviation plus a plan×canon conflict resolves to PLAN_CONFLICT (plan wins).
    const verdict = canonAuditVerdict(coverage)
    expect(verdict.verdict).toBe("PLAN_CONFLICT")
    expect(verdict.reasons.some((reason) => reason.startsWith("PLAN_CONFLICT"))).toBe(true)
    expect(verdict.reasons.some((reason) => reason.startsWith("CODE_DEVIATION"))).toBe(true)
  })

  test("detects a required Output default that masks unchanged constructor callers", () => {
    const { root, output, plan, commit } = scaffoldOutputChange({ optional: false })
    const coverage = buildCanonAuditCoverage(root, commit, [output], { planPath: plan, taskId: "1" })
    const file = coverage.files[0]!

    expect(file.structuralFindings).toHaveLength(1)
    expect(file.structuralFindings[0]?.message).toContain("AccountOutput.preferences")
    expect(file.structuralFindings[0]?.contractEvidenceRefs).toEqual([])
    const callers = file.evidence.filter((entry) => entry.kind === "CALLER")
    expect(callers).toHaveLength(1)
    expect(callers[0]?.path).toEndWith("AccountOutputTest.kt")
    expect(callers[0]?.summary).toContain("relies on its newly introduced default")

    // A required non-null default that the plan does not authorize is a CODE_DEVIATION.
    const verdict = canonAuditVerdict(coverage)
    expect(verdict.verdict).toBe("CODE_DEVIATION")
    expect(verdict.reasons.some((reason) => reason.includes("AccountOutput.preferences"))).toBe(true)
  })

  test("does not treat a nullable null default as a required-field divergence", () => {
    const { root, output, plan, commit } = scaffoldOutputChange({ optional: true })
    const coverage = buildCanonAuditCoverage(root, commit, [output], { planPath: plan, taskId: "1" })

    expect(coverage.files[0]?.structuralFindings).toEqual([])
    // No structural, mechanical, or plan findings -> PASS.
    expect(canonAuditVerdict(coverage).verdict).toBe("PASS")
  })

  test("positional constructor calls are not falsely classified as omitted named arguments", () => {
    const { root, repo, output, plan, commit } = scaffoldOutputChange({ optional: false })
    const caller = path.join(repo, "src", "test", "kotlin", "seller", "AccountOutputTest.kt")
    writeFileSync(
      caller,
      "package seller\n\nimport seller.model.AccountOutput\nimport seller.model.Preferences\n\nval output = AccountOutput(\"id\", \"account\", \"ACTIVE\", Preferences())\n",
      "utf-8"
    )
    runCommand("git", ["add", caller], { cwd: repo })
    runCommand("git", ["commit", "--amend", "--no-edit"], { cwd: repo })
    const amended = runCommand("git", ["rev-parse", "HEAD"], { cwd: repo }).stdout.trim()
    expect(amended).not.toBe(commit)

    const coverage = buildCanonAuditCoverage(root, amended, [output], { planPath: plan, taskId: "1" })
    expect(coverage.files[0]!.evidence.filter((entry) => entry.kind === "CALLER")).toEqual([])
    expect(coverage.files[0]!.structuralFindings).toHaveLength(1)
  })

  test("non-Kotlin files receive same-extension local precedent evidence", () => {
    const root = createTempDir("juninho-canon-sql-")
    tempDirs.push(root)
    const repo = path.join(root, "repo")
    const migrationDir = path.join(repo, "src", "main", "resources", "db", "migration")
    mkdirSync(migrationDir, { recursive: true })
    createGitRepo(repo)
    const sibling = path.join(migrationDir, "V1__CREATE_PREFERENCES_TABLE.sql")
    const target = path.join(migrationDir, "V2__ADD_PREFERENCES.sql")
    writeFileSync(sibling, "CREATE TABLE account (id text primary key);\n", "utf-8")
    writeFileSync(target, "ALTER TABLE account ADD COLUMN note text;\n", "utf-8")
    runCommand("git", ["add", "."], { cwd: repo })
    runCommand("git", ["commit", "-m", "seed migrations"], { cwd: repo })
    writeFileSync(target, "ALTER TABLE account ADD COLUMN preferences jsonb;\n", "utf-8")
    runCommand("git", ["add", target], { cwd: repo })
    runCommand("git", ["commit", "-m", "candidate migration"], { cwd: repo })
    const commit = runCommand("git", ["rev-parse", "HEAD"], { cwd: repo }).stdout.trim()

    const coverage = buildCanonAuditCoverage(root, commit, [target])
    expect(coverage.files[0]!.evidence.some((entry) => entry.kind === "LOCAL_PATTERN" && entry.path === sibling)).toBe(true)
  })
})

describe("canonAuditVerdict", () => {
  const file = (overrides: Record<string, unknown>) => ({
    path: "/repo/File.kt",
    canonPaths: [],
    evidence: [],
    structuralFindings: [],
    mechanicalFindings: [],
    planFindings: [],
    ...overrides,
  })
  const coverageOf = (...files: unknown[]) =>
    ({
      schemaVersion: 2,
      candidateCommit: "candidate",
      candidateParent: "parent",
      plan: { path: "", taskId: "", instructions: [] },
      files,
    }) as any

  test("an unauthorized structural finding is a CODE_DEVIATION", () => {
    const coverage = coverageOf(
      file({ structuralFindings: [{ message: "Foo.bar introduces a default", contractEvidenceRefs: [] }] })
    )
    const verdict = canonAuditVerdict(coverage)
    expect(verdict.verdict).toBe("CODE_DEVIATION")
    expect(verdict.reasons).toHaveLength(1)
    expect(verdict.reasons[0]).toContain("CODE_DEVIATION")
    expect(verdict.reasons[0]).toContain("Foo.bar")
  })

  test("a structural finding authorized by the plan (contractEvidenceRefs) is a PASS", () => {
    const coverage = coverageOf(
      file({ structuralFindings: [{ message: "Foo.bar default", contractEvidenceRefs: ["contract-1"] }] })
    )
    expect(canonAuditVerdict(coverage).verdict).toBe("PASS")
    expect(canonAuditVerdict(coverage).reasons).toEqual([])
  })

  test("a mechanical finding is a CODE_DEVIATION", () => {
    const coverage = coverageOf(
      file({ mechanicalFindings: ["Required JSONB property 'x' has constructor default 'Y(...)'."] })
    )
    expect(canonAuditVerdict(coverage).verdict).toBe("CODE_DEVIATION")
  })

  test("a plan finding is a PLAN_CONFLICT and takes priority over a code deviation", () => {
    const coverage = coverageOf(
      file({
        mechanicalFindings: ["Required JSONB property 'x' has constructor default 'Y(...)'."],
        planFindings: ["Plan instruction '...' conflicts with '...' (skill)."],
      })
    )
    const verdict = canonAuditVerdict(coverage)
    expect(verdict.verdict).toBe("PLAN_CONFLICT")
    expect(verdict.reasons.some((reason) => reason.startsWith("CODE_DEVIATION"))).toBe(true)
    expect(verdict.reasons.some((reason) => reason.startsWith("PLAN_CONFLICT"))).toBe(true)
  })

  test("no findings yields PASS", () => {
    expect(canonAuditVerdict(coverageOf(file({}))).verdict).toBe("PASS")
  })
})
