import { createHash } from "crypto"
import { execFileSync } from "child_process"
import { existsSync, readFileSync, statSync } from "fs"
import path from "path"
import { resolveCanonBundle } from "./j.context-canon"

export type CanonEvidenceNode = {
  id: string
  kind: "DIFF" | "BASELINE" | "LOCAL_PATTERN" | "SEARCH" | "CALLER" | "CONTRACT" | "CANON"
  path: string
  line?: number
  symbol?: string
  summary: string
  fingerprint: string
}

export type CanonStructuralFinding = {
  id: string
  kind: "NON_NULL_DEFAULT_DIVERGENCE"
  path: string
  line: number
  symbol: string
  property: string
  message: string
  evidenceRefs: string[]
  contractEvidenceRefs: string[]
}

export type CanonPatternCheck = {
  id: string
  kind: "STRUCTURAL_DELTA" | "FILE_DELTA"
  path: string
  symbol: string
  summary: string
  evidenceRefs: string[]
}

export type CanonAuditFile = {
  path: string
  canonPaths: string[]
  evidence: CanonEvidenceNode[]
  structuralFindings: CanonStructuralFinding[]
  mechanicalFindings: string[]
  planFindings: string[]
}

export type CanonAuditCoverage = {
  schemaVersion: 2
  candidateCommit: string
  candidateParent: string
  plan: {
    path: string
    taskId: string
    instructions: string[]
  }
  files: CanonAuditFile[]
}

export type CanonAuditOptions = {
  planPath?: string
  specPath?: string
  contextPath?: string
  taskId?: string
}

export type CanonVerdict = {
  verdict: "PASS" | "CODE_DEVIATION" | "PLAN_CONFLICT"
  reasons: string[]
}

type KotlinProperty = {
  name: string
  type: string
  nullable: boolean
  hasDefault: boolean
  defaultExpression: string
  line: number
}

type KotlinConstructor = {
  name: string
  line: number
  dataClass: boolean
  properties: KotlinProperty[]
}

type ConstructorCall = {
  path: string
  line: number
  explicitProperties: string[]
  hasPositionalArguments: boolean
}

const RELEVANCE_STOP_WORDS = new Set([
  "add", "class", "code", "data", "file", "field", "keep", "model", "output", "property", "read", "seller", "step", "type", "use", "write",
])

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${hash(value).slice(0, 16)}`
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    return null
  }
}

function gitRoot(filePath: string): string | null {
  return git(path.dirname(filePath), ["rev-parse", "--show-toplevel"])
}

function relativeToRepo(repo: string, filePath: string): string {
  return path.relative(repo, path.resolve(filePath)).split(path.sep).join("/")
}

function contentAt(repo: string, commit: string, relativePath: string): string | null {
  if (commit === "PRE_WRITE") {
    return git(repo, ["show", `HEAD:${relativePath}`])
  }
  return git(repo, ["show", `${commit}:${relativePath}`])
}

function parentOf(repo: string, commit: string): string {
  if (commit === "PRE_WRITE") return git(repo, ["rev-parse", "HEAD"]) ?? "WORKTREE"
  return git(repo, ["rev-parse", `${commit}^`]) ?? "UNKNOWN"
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = []
  let start = 0
  let round = 0
  let square = 0
  let curly = 0
  let angle = 0
  let quote = ""
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === quote) quote = ""
      continue
    }
    if (char === "\"" || char === "'") {
      quote = char
      continue
    }
    if (char === "(") round += 1
    else if (char === ")") round -= 1
    else if (char === "[") square += 1
    else if (char === "]") square -= 1
    else if (char === "{") curly += 1
    else if (char === "}") curly -= 1
    else if (char === "<") angle += 1
    else if (char === ">") angle = Math.max(0, angle - 1)
    else if (char === "," && round === 0 && square === 0 && curly === 0 && angle === 0) {
      parts.push(value.slice(start, index))
      start = index + 1
    }
  }
  parts.push(value.slice(start))
  return parts
}

function topLevelEquals(value: string): number {
  let round = 0
  let square = 0
  let curly = 0
  let angle = 0
  let quote = ""
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === quote) quote = ""
      continue
    }
    if (char === "\"" || char === "'") quote = char
    else if (char === "(") round += 1
    else if (char === ")") round -= 1
    else if (char === "[") square += 1
    else if (char === "]") square -= 1
    else if (char === "{") curly += 1
    else if (char === "}") curly -= 1
    else if (char === "<") angle += 1
    else if (char === ">") angle = Math.max(0, angle - 1)
    else if (char === "=" && round === 0 && square === 0 && curly === 0 && angle === 0) return index
  }
  return -1
}

function safeFileContent(filePath: string): string {
  try {
    return statSync(filePath).isFile() ? readFileSync(filePath, "utf-8") : filePath
  } catch {
    return filePath
  }
}

function matchingParen(content: string, open: number): number {
  let depth = 0
  let quote = ""
  let escaped = false
  for (let index = open; index < content.length; index += 1) {
    const char = content[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === quote) quote = ""
      continue
    }
    if (char === "\"" || char === "'") quote = char
    else if (char === "(") depth += 1
    else if (char === ")") {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function lineAt(content: string, offset: number): number {
  return content.slice(0, offset).split("\n").length
}

function kotlinConstructors(content: string): KotlinConstructor[] {
  const constructors: KotlinConstructor[] = []
  const pattern = /\b(data\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g
  for (const match of content.matchAll(pattern)) {
    const full = match[0]
    const open = (match.index ?? 0) + full.lastIndexOf("(")
    const close = matchingParen(content, open)
    if (close === -1) continue
    const body = content.slice(open + 1, close)
    const properties: KotlinProperty[] = []
    let searchOffset = open + 1
    for (const raw of splitTopLevel(body)) {
      const segment = raw.trim()
      const property = segment.match(/\b(?:val|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([\s\S]+)/)
      const segmentOffset = content.indexOf(raw, searchOffset)
      searchOffset = Math.max(searchOffset, segmentOffset + raw.length)
      if (!property) continue
      const equals = topLevelEquals(property[2])
      const type = (equals === -1 ? property[2] : property[2].slice(0, equals)).trim().replace(/,$/, "")
      const defaultExpression = equals === -1 ? "" : property[2].slice(equals + 1).trim().replace(/,$/, "")
      properties.push({
        name: property[1],
        type,
        nullable: /\?\s*$/.test(type),
        hasDefault: equals !== -1,
        defaultExpression,
        line: lineAt(content, segmentOffset >= 0 ? segmentOffset : open),
      })
    }
    constructors.push({
      name: match[2],
      line: lineAt(content, match.index ?? 0),
      dataClass: Boolean(match[1]),
      properties,
    })
  }
  return constructors
}

function kotlinFiles(repo: string, commit: string): string[] {
  const output = commit === "PRE_WRITE"
    ? git(repo, ["ls-files", "*.kt"])
    : git(repo, ["ls-tree", "-r", "--name-only", commit])
  return (output ?? "").split("\n").filter((entry) => entry.endsWith(".kt"))
}

function constructorCalls(repo: string, commit: string, className: string): ConstructorCall[] {
  const calls: ConstructorCall[] = []
  const pattern = new RegExp(`\\b${className}\\s*\\(`, "g")
  for (const relativePath of kotlinFiles(repo, commit)) {
    const content = contentAt(repo, commit, relativePath)
    if (!content) continue
    for (const match of content.matchAll(pattern)) {
      const start = match.index ?? 0
      const prefix = content.slice(Math.max(0, start - 24), start)
      if (/\bclass\s+$/.test(prefix) || /\b(?:data|sealed)\s+class\s+$/.test(prefix)) continue
      const open = content.indexOf("(", start)
      const close = matchingParen(content, open)
      if (close === -1) continue
      const argumentsBody = content.slice(open + 1, close)
      const argumentsList = splitTopLevel(argumentsBody).map((argument) => argument.trim()).filter(Boolean)
      const explicitProperties = argumentsList
        .map((argument) => argument.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1])
        .filter((name): name is string => Boolean(name))
      calls.push({
        path: path.join(repo, relativePath),
        line: lineAt(content, start),
        explicitProperties,
        hasPositionalArguments: argumentsList.some((argument) => !/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(argument)),
      })
    }
  }
  return calls
}

function evidenceNode(
  kind: CanonEvidenceNode["kind"],
  filePath: string,
  summary: string,
  options: { line?: number; symbol?: string } = {}
): CanonEvidenceNode {
  const fingerprint = hash(`${kind}\n${filePath}\n${options.line ?? ""}\n${options.symbol ?? ""}\n${summary}`)
  return {
    id: stableId(kind.toLowerCase(), fingerprint),
    kind,
    path: path.resolve(filePath),
    line: options.line,
    symbol: options.symbol,
    summary,
    fingerprint,
  }
}

function taskPlanInstructions(planPath?: string, taskId?: string): string[] {
  if (!planPath || !taskId || !existsSync(planPath)) return []
  const lines = readFileSync(planPath, "utf-8").split(/\r?\n/)
  const taskHeading = new RegExp(`^##\\s+Task\\s+${taskId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
  const start = lines.findIndex((line) => taskHeading.test(line))
  if (start === -1) return []
  const end = lines.findIndex((line, index) => index > start && /^##\s+Task\s+\d+\b/.test(line))
  const taskLines = lines.slice(start + 1, end === -1 ? undefined : end)
  const instructions: string[] = []
  for (const heading of ["Action", "Done Criteria"]) {
    const sectionStart = taskLines.findIndex((line) => line.trim() === `### ${heading}`)
    if (sectionStart === -1) continue
    const sectionEnd = taskLines.findIndex((line, index) => index > sectionStart && /^###\s+/.test(line))
    for (const line of taskLines.slice(sectionStart + 1, sectionEnd === -1 ? undefined : sectionEnd)) {
      const instruction = line.replace(/^\s*-\s+/, "").trim()
      if (instruction) instructions.push(instruction)
    }
  }
  return instructions
}

function contractEvidence(
  instructions: string[],
  planPath: string | undefined,
  className: string,
  propertyName: string
): CanonEvidenceNode[] {
  if (!planPath) return []
  const subject = new RegExp(`(?:${className}|${propertyName})`, "i")
  const authorization =
    /(?:(?:allow|keep|preserve|retain|compatib|backward|legacy)[\s\S]{0,80}(?:default|omit|omission)|(?:default|omit|omission)[\s\S]{0,80}(?:allow|keep|preserve|retain|compatib|backward|legacy)|(?:may|can)\s+(?:be\s+)?omit|optional[\s\S]{0,50}default|default[\s\S]{0,50}optional)/i
  return instructions
    .filter((instruction) => subject.test(instruction) && authorization.test(instruction) && !/\b(?:do not|must not|never|without|no)\b[\s\S]{0,35}\bdefault/i.test(instruction))
    .map((instruction) => evidenceNode("CONTRACT", planPath, instruction, { symbol: `${className}.${propertyName}` }))
}

function patternContractEvidence(
  instructions: string[],
  planPath: string | undefined,
  filePath: string,
  symbols: string[]
): CanonEvidenceNode[] {
  if (!planPath) return []
  const fileName = path.basename(filePath)
  const fileStem = fileName.replace(/\.[^.]+$/, "")
  const subjects = [fileName, fileStem, ...symbols].filter(Boolean)
  const patternDecision = /\b(pattern|precedent|sibling|mimic|copy|follow|base commit|candidate-parent|no local|no precedent|existing symbol)\b/i
  return instructions
    .filter((instruction) => patternDecision.test(instruction) && subjects.some((subject) => instruction.includes(subject)))
    .map((instruction) => evidenceNode("CONTRACT", planPath, instruction, { symbol: subjects[0] }))
}

function words(value: string): Set<string> {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .match(/[a-z][a-z0-9_-]{2,}/g) ?? []
  return new Set(normalized.filter((word) => !RELEVANCE_STOP_WORDS.has(word)))
}

function addIdentifierTokens(target: Set<string>, identifier: string) {
  const whole = identifier.toLowerCase().replace(/[^a-z0-9]+/g, "")
  if (whole.length >= 5) target.add(whole)
  for (const token of words(identifier)) target.add(token)
}

function localPatternEvidence(
  repo: string,
  candidateCommit: string,
  relativePath: string,
  targetConstructors: KotlinConstructor[]
): CanonEvidenceNode[] {
  const directory = path.posix.dirname(relativePath)
  const targetBase = path.posix.basename(relativePath)
  const siblings = kotlinFiles(repo, candidateCommit)
    .filter((candidate) => path.posix.dirname(candidate) === directory && path.posix.basename(candidate) !== targetBase)
    .slice(0, 3)
  return siblings.flatMap((sibling) => {
    const content = contentAt(repo, candidateCommit, sibling)
    if (!content) return []
    const constructors = kotlinConstructors(content)
    if (constructors.length === 0) return []
    const targetNames = new Set(targetConstructors.map((constructor) => constructor.name.replace(/(?:Input|Output|Request|Response|Entity)$/, "")))
    const ranked = [...constructors].sort((left, right) => {
      const leftStem = left.name.replace(/(?:Input|Output|Request|Response|Entity)$/, "")
      const rightStem = right.name.replace(/(?:Input|Output|Request|Response|Entity)$/, "")
      return Number(targetNames.has(rightStem)) - Number(targetNames.has(leftStem))
    })
    const constructor = ranked[0]
    const required = constructor.properties.filter((property) => !property.nullable)
    const explicit = required.filter((property) => !property.hasDefault)
    const defaults = constructor.properties.filter((property) => property.hasDefault).map((property) => property.name)
    return [
      evidenceNode(
        "LOCAL_PATTERN",
        path.join(repo, sibling),
        `${constructor.name} declares ${explicit.length}/${required.length} non-null properties explicitly; constructor defaults: ${defaults.join(", ") || "none"}.`,
        { line: constructor.line, symbol: constructor.name }
      ),
    ]
  })
}

function roleTokens(filePath: string): Set<string> {
  const base = path.posix.basename(filePath, path.posix.extname(filePath))
    .replace(/^V\d+(?:\.\d+)*__?/i, "")
    .replace(/\b(?:PGW|TRP)[_-]?\d+\b/gi, "")
  const ignored = new Set(["add", "change", "create", "delete", "file", "new", "remove", "update"])
  return new Set(Array.from(words(base)).filter((token) => !ignored.has(token) && !/^\d+$/.test(token)))
}

function languageNeutralPatternEvidence(repo: string, commit: string, relativePath: string): CanonEvidenceNode[] {
  const directory = path.posix.dirname(relativePath)
  const targetBase = path.posix.basename(relativePath)
  const extension = path.posix.extname(relativePath)
  const targetRoles = roleTokens(relativePath)
  const output = commit === "PRE_WRITE"
    ? git(repo, ["ls-files"])
    : git(repo, ["ls-tree", "-r", "--name-only", commit])
  const candidates = (output ?? "")
    .split("\n")
    .filter((candidate) =>
      candidate &&
      path.posix.dirname(candidate) === directory &&
      path.posix.basename(candidate) !== targetBase &&
      path.posix.extname(candidate) === extension
    )
  const ranked = candidates
    .map((candidate) => {
      const candidateRoles = roleTokens(candidate)
      const overlap = Array.from(targetRoles).filter((token) => candidateRoles.has(token))
      const union = new Set([...targetRoles, ...candidateRoles])
      return { candidate, overlap, score: union.size === 0 ? 0 : overlap.length / union.size }
    })
    .filter((entry) => entry.overlap.length > 0 && entry.score >= 0.2)
    .sort((left, right) => right.score - left.score)
  const search = evidenceNode(
    "SEARCH",
    path.join(repo, directory),
    `Same-directory ${extension || "extensionless"} precedent search inspected ${candidates.length} candidate(s), found ${ranked.length} role-equivalent match(es), target roles: ${Array.from(targetRoles).join(", ") || "none"}.`,
    { line: 1, symbol: targetBase }
  )
  const matches = ranked.slice(0, 3).flatMap(({ candidate, overlap, score }) => {
      const content = contentAt(repo, commit, candidate)
      if (content === null) return []
      const nonBlank = content.split(/\r?\n/).filter((line) => line.trim()).length
      const declarations = Array.from(content.matchAll(/^\s*(?:class|data\s+class|fun|def|CREATE\s+(?:TABLE|INDEX)|ALTER\s+TABLE)\s+([^\s({;]+)/gim))
        .slice(0, 5)
        .map((match) => match[1])
      return [
        evidenceNode(
          "LOCAL_PATTERN",
          path.join(repo, candidate),
          `Role-equivalent same-directory ${extension || "extensionless"} precedent (score ${score.toFixed(2)}, shared roles: ${overlap.join(", ")}) has ${nonBlank} non-blank lines; declarations/statements: ${declarations.join(", ") || "none detected"}; fingerprint ${hash(content).slice(0, 16)}.`,
          { line: 1, symbol: path.posix.basename(candidate) }
        ),
      ]
    })
  return [search, ...matches]
}

function structuralEvidence(
  filePath: string,
  candidateCommit: string,
  instructions: string[],
  planPath?: string
): {
  evidence: CanonEvidenceNode[]
  findings: CanonStructuralFinding[]
  checks: CanonPatternCheck[]
  tokens: Set<string>
} {
  const repo = gitRoot(filePath)
  const tokens = new Set<string>()
  addIdentifierTokens(tokens, path.basename(filePath).replace(/\.[^.]+$/, ""))
  if (!repo) return { evidence: [], findings: [], checks: [], tokens }
  const relativePath = relativeToRepo(repo, filePath)
  const parent = parentOf(repo, candidateCommit)
  const after = contentAt(repo, candidateCommit, relativePath)
  if (after === null) {
    const plannedNode = evidenceNode(
      "DIFF",
      filePath,
      "Planned new file is absent at PRE_WRITE; its role and shape must be bound to a local precedent or an explicit no-precedent task contract before creation.",
      { line: 1, symbol: path.basename(filePath) }
    )
    const localNodes = languageNeutralPatternEvidence(repo, parent, relativePath)
    const contracts = patternContractEvidence(instructions, planPath, filePath, [])
    const evidence = [plannedNode, ...localNodes, ...contracts]
    return {
      evidence,
      findings: [],
      checks: [{
        id: stableId("pattern", `${relativePath}\nplanned-new-file`),
        kind: "STRUCTURAL_DELTA",
        path: path.resolve(filePath),
        symbol: path.basename(filePath),
        summary: `Planned new file ${path.basename(filePath)} requires a same-role local precedent or an explicit task-contract statement that no local precedent exists.`,
        evidenceRefs: evidence.map((node) => node.id),
      }],
      tokens,
    }
  }
  const before = parent === "WORKTREE" || parent === "UNKNOWN" ? null : contentAt(repo, parent, relativePath)
  const afterConstructors = kotlinConstructors(after)
  const beforeByName = new Map(kotlinConstructors(before ?? "").map((constructor) => [constructor.name, constructor]))
  const evidence: CanonEvidenceNode[] = []
  const findings: CanonStructuralFinding[] = []
  const checks: CanonPatternCheck[] = []
  const diffSummary = candidateCommit === "PRE_WRITE"
    ? `PRE_WRITE:${relativePath}:${hash(instructions.join("\n"))}`
    : git(repo, ["diff", "--unified=0", parent, candidateCommit, "--", relativePath]) ?? "candidate diff unavailable"
  const diffNode = evidenceNode("DIFF", filePath, `Exact candidate delta fingerprint ${hash(diffSummary).slice(0, 16)}.`, { line: 1 })
  evidence.push(diffNode)
  const fileBaselineNode = before === null
    ? null
    : evidenceNode(
        "BASELINE",
        filePath,
        `Candidate-parent file fingerprint ${hash(before).slice(0, 16)}; structural review must explain every departure from this baseline.`,
        { line: 1, symbol: path.basename(filePath) }
      )
  if (fileBaselineNode) evidence.push(fileBaselineNode)
  const localNodes = Array.from(
    new Map(
      [...localPatternEvidence(repo, candidateCommit, relativePath, afterConstructors), ...languageNeutralPatternEvidence(repo, candidateCommit, relativePath)]
        .map((node) => [node.path, node])
    ).values()
  )
  evidence.push(...localNodes)
  const patternContracts = patternContractEvidence(
    instructions,
    planPath,
    filePath,
    afterConstructors.map((constructor) => constructor.name)
  )
  evidence.push(...patternContracts)

  let hasStructuralDelta = false

  for (const constructor of afterConstructors) {
    addIdentifierTokens(tokens, constructor.name)
    if (constructor.dataClass) tokens.add("shape")
    const baseline = beforeByName.get(constructor.name)
    if (!baseline) {
      const refs = [diffNode.id, ...localNodes.map((node) => node.id), ...patternContracts.map((node) => node.id)]
      checks.push({
        id: stableId("pattern", `${relativePath}\n${constructor.name}\nnew-constructor`),
        kind: "STRUCTURAL_DELTA",
        path: path.resolve(filePath),
        symbol: constructor.name,
        summary: `New constructor shape ${constructor.name} must mimic the nearest local role-equivalent shape or cite an explicit no-precedent contract.`,
        evidenceRefs: [...refs, ...(fileBaselineNode ? [fileBaselineNode.id] : [])],
      })
      hasStructuralDelta = true
      continue
    }
    const required = baseline.properties.filter((property) => !property.nullable)
    const explicit = required.filter((property) => !property.hasDefault)
    const defaulted = required.filter((property) => property.hasDefault)
    const baselineNode = evidenceNode(
      "BASELINE",
      filePath,
      `${constructor.name} at candidate parent has ${explicit.length}/${required.length} non-null constructor properties explicit and ${defaulted.length} defaulted (${defaulted.map((property) => property.name).join(", ") || "none"}).`,
      { line: baseline.line, symbol: constructor.name }
    )
    evidence.push(baselineNode)

    const baselineProperties = new Map(baseline.properties.map((property) => [property.name, property]))
    const deltas: string[] = []
    const changedProperties: KotlinProperty[] = []
    for (const property of constructor.properties) {
      const previous = baselineProperties.get(property.name)
      if (!previous) {
        deltas.push(`added ${property.name}: ${property.type}${property.hasDefault ? ` = ${property.defaultExpression}` : " (explicit)"}`)
        changedProperties.push(property)
      } else if (
        previous.type !== property.type ||
        previous.hasDefault !== property.hasDefault ||
        previous.defaultExpression !== property.defaultExpression
      ) {
        deltas.push(
          `changed ${property.name} from ${previous.type}${previous.hasDefault ? ` = ${previous.defaultExpression}` : " (explicit)"} ` +
          `to ${property.type}${property.hasDefault ? ` = ${property.defaultExpression}` : " (explicit)"}`
        )
        changedProperties.push(property)
      }
    }
    for (const property of baseline.properties) {
      if (!constructor.properties.some((candidate) => candidate.name === property.name)) {
        deltas.push(`removed ${property.name}`)
        addIdentifierTokens(tokens, property.name)
      }
    }
    if (deltas.length > 0) {
      checks.push({
        id: stableId("pattern", `${relativePath}\n${constructor.name}\n${deltas.join("\n")}`),
        kind: "STRUCTURAL_DELTA",
        path: path.resolve(filePath),
        symbol: constructor.name,
        summary: `${constructor.name} constructor delta: ${deltas.join("; ")}. Compare this exact delta with the candidate-parent shape, impacted callers, local precedents, and task contract.`,
        evidenceRefs: [diffNode.id, baselineNode.id, ...localNodes.map((node) => node.id), ...patternContracts.map((node) => node.id)],
      })
      hasStructuralDelta = true
    }
    for (const property of changedProperties) {
      addIdentifierTokens(tokens, property.name)
      if (property.nullable) tokens.add("nullable")
      if (property.hasDefault) tokens.add("default")
      if (property.nullable && /^null\b/.test(property.defaultExpression)) tokens.add("optional")
      const previous = baselineProperties.get(property.name)
      const defaultIntroduced = property.hasDefault && (!previous || !previous.hasDefault)
      if (!defaultIntroduced || property.nullable || /^null\b/.test(property.defaultExpression)) continue
      for (const token of ["caller", "constructor", "default", "explicit", "mandatory", "non-null", "omission", "optional", "required"]) tokens.add(token)
      const calls = constructorCalls(repo, candidateCommit, constructor.name)
      const omitted = calls.filter((call) => !call.hasPositionalArguments && !call.explicitProperties.includes(property.name))
      const callerNodes = omitted.map((call) =>
        evidenceNode(
          "CALLER",
          call.path,
          `${constructor.name}(...) omits non-null property '${property.name}' and therefore relies on its newly introduced default.`,
          { line: call.line, symbol: `${constructor.name}.${property.name}` }
        )
      )
      evidence.push(...callerNodes)
      const contracts = contractEvidence(instructions, planPath, constructor.name, property.name)
      evidence.push(...contracts)
      const refs = [baselineNode.id, ...callerNodes.map((node) => node.id)]
      const message =
        `${constructor.name}.${property.name} introduces a default for a non-null constructor property while the candidate-parent class makes ` +
        `${explicit.length}/${required.length} comparable properties explicit` +
        (callerNodes.length > 0 ? `; ${callerNodes.length} caller(s) now compile by omitting it` : "") +
        ". Treat this as a local-pattern divergence unless the task contract explicitly authorizes the default/compatibility behavior."
      findings.push({
        id: stableId("finding", `${relativePath}\n${constructor.name}\n${property.name}\n${message}`),
        kind: "NON_NULL_DEFAULT_DIVERGENCE",
        path: path.resolve(filePath),
        line: property.line,
        symbol: constructor.name,
        property: property.name,
        message,
        evidenceRefs: refs,
        contractEvidenceRefs: contracts.map((node) => node.id),
      })
    }
  }
  if (!hasStructuralDelta) {
    checks.push({
      id: stableId("pattern", `${relativePath}\nfile-delta\n${diffNode.fingerprint}`),
      kind: "FILE_DELTA",
      path: path.resolve(filePath),
      symbol: path.basename(filePath),
      summary: "The exact file delta must preserve the candidate-parent structure and nearest local role-equivalent pattern; any intentional divergence needs explicit task-contract evidence.",
      evidenceRefs: [
        diffNode.id,
        ...(fileBaselineNode ? [fileBaselineNode.id] : []),
        ...localNodes.map((node) => node.id),
        ...patternContracts.map((node) => node.id),
      ],
    })
  }
  return { evidence, findings, checks, tokens }
}

function requiredJsonbConstructorDefaults(filePath: string): string[] {
  if (!/Entity\.kt$/.test(filePath) || !existsSync(filePath)) return []
  const content = readFileSync(filePath, "utf-8")
  const pattern = /@JdbcTypeCode\(SqlTypes\.JSON\)[\s\S]{0,220}?@Column\([^)]*nullable\s*=\s*false[^)]*\)[\s\S]{0,120}?(?:var|val)\s+(\w+)\s*:\s*([\w.<>?]+)\s*=\s*([\w.]+)\s*\(/g
  return Array.from(content.matchAll(pattern)).map(
    (match) => `Required JSONB property '${match[1]}' has constructor default '${match[3]}(...)'.`
  )
}

// Mechanical plan×canon conflict: when a canon source forbids defaulting a required JSONB value
// object in an entity constructor, flag any task instruction that directs exactly that. The canon
// rule text is read straight from the resolved skill sources (no per-file rule apparatus needed).
function mechanicalPlanFindings(
  instructions: string[],
  canonSources: { path: string; content: string }[]
): string[] {
  const jsonbRulePattern = /Defaulting a required JSONB value object in an entity constructor/i
  let ruleText = ""
  let ruleSource = ""
  for (const source of canonSources) {
    const line = source.content
      .split(/\r?\n/)
      .map((entry) => entry.replace(/^\s*(?:\d+\.|-)\s+/, "").trim())
      .find((entry) => jsonbRulePattern.test(entry))
    if (line) {
      ruleText = line
      ruleSource = source.path
      break
    }
  }
  if (!ruleText) return []
  return instructions
    .filter((instruction) => /\binitializ\w*\b.*\bin (?:the )?entity constructor\b/i.test(instruction))
    .map(
      (instruction) =>
        `Plan instruction '${instruction}' conflicts with '${ruleText}' (${ruleSource}).`
    )
}

export function canonAuditCoverageDigest(coverage: CanonAuditCoverage): string {
  return hash(JSON.stringify(coverage))
}

export function buildCanonAuditCoverage(
  workspaceRoot: string,
  candidateCommit: string,
  files: string[],
  options: CanonAuditOptions = {}
): CanonAuditCoverage {
  const instructions = taskPlanInstructions(options.planPath, options.taskId)
  const parents = files
    .map((filePath) => gitRoot(filePath))
    .filter((repo): repo is string => Boolean(repo))
    .map((repo) => parentOf(repo, candidateCommit))
  return {
    schemaVersion: 2,
    candidateCommit,
    candidateParent: Array.from(new Set(parents)).join(",") || "UNKNOWN",
    plan: {
      path: options.planPath ? path.resolve(options.planPath) : "",
      taskId: options.taskId ?? "",
      instructions,
    },
    files: files.map((filePath) => {
      const absolutePath = path.resolve(filePath)
      const bundle = resolveCanonBundle(workspaceRoot, absolutePath)
      const canonSources = bundle.skills.flatMap((skill) =>
        [skill.path, skill.systemPath, skill.gotchasPath].filter((value): value is string => Boolean(value))
      )
      const canonPaths = Array.from(
        new Set([
          ...bundle.projectEvidence,
          ...bundle.projectAgents,
          ...bundle.contextAgents,
          ...canonSources,
        ])
      )
      const structural = structuralEvidence(absolutePath, candidateCommit, instructions, options.planPath)
      const canonNodes = canonPaths.map((canonPath) =>
        evidenceNode("CANON", canonPath, `Canon source fingerprint ${hash(safeFileContent(canonPath)).slice(0, 16)}.`)
      )
      const canonContents = canonSources
        .filter((source) => existsSync(source))
        .map((source) => ({ path: source, content: readFileSync(source, "utf-8") }))
      return {
        path: absolutePath,
        canonPaths,
        evidence: [...structural.evidence, ...canonNodes],
        structuralFindings: structural.findings,
        mechanicalFindings: requiredJsonbConstructorDefaults(absolutePath),
        planFindings: mechanicalPlanFindings(instructions, canonContents),
      }
    }),
  }
}

// Direct verdict computed from the mechanical detection alone (no agent-filled form):
// - a structural NON_NULL_DEFAULT_DIVERGENCE without a plan authorization (`contractEvidenceRefs`
//   empty) is a CODE_DEVIATION;
// - a mechanical finding (required JSONB constructor default) is a CODE_DEVIATION;
// - a mechanical plan×canon conflict is a PLAN_CONFLICT (which takes priority over CODE_DEVIATION);
// - otherwise PASS.
export function canonAuditVerdict(coverage: CanonAuditCoverage): CanonVerdict {
  const reasons: string[] = []
  for (const file of coverage.files) {
    for (const finding of file.structuralFindings) {
      if (finding.contractEvidenceRefs.length === 0) {
        reasons.push(`CODE_DEVIATION: ${file.path}: ${finding.message}`)
      }
    }
    for (const mechanical of file.mechanicalFindings) {
      reasons.push(`CODE_DEVIATION: ${file.path}: ${mechanical}`)
    }
    for (const planFinding of file.planFindings) {
      reasons.push(`PLAN_CONFLICT: ${file.path}: ${planFinding}`)
    }
  }
  const verdict = reasons.some((reason) => reason.startsWith("PLAN_CONFLICT"))
    ? "PLAN_CONFLICT"
    : reasons.length > 0
      ? "CODE_DEVIATION"
      : "PASS"
  return { verdict, reasons }
}
