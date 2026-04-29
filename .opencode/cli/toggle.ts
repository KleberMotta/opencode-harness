import { readConfig, writeConfig, setNestedValue, getNestedValue, parseToggleValue, die, ok } from "./_lib"

const dottedPath = process.argv[2]
const rawValue = process.argv[3]

if (!dottedPath || rawValue === undefined) {
  die(
    "uso: bun toggle <key.path> <value>\n" +
      "exemplos:\n" +
      "  bun toggle unify.createPullRequest true            # vira workflow.unify.createPullRequest\n" +
      "  bun toggle implement.postImplementFullCheck false  # vira workflow.implement.postImplementFullCheck\n" +
      "  bun toggle workflow.unify.createPullRequest true   # caminho explícito também aceito",
  )
}

const WORKFLOW_SECTIONS = new Set(["automation", "implement", "unify", "documentation"])

const inputParts = dottedPath.split(".")
const parts =
  !inputParts[0].startsWith("workflow") && WORKFLOW_SECTIONS.has(inputParts[0])
    ? ["workflow", ...inputParts]
    : inputParts

const value = parseToggleValue(rawValue)

const config = readConfig() as Record<string, any>
const previous = getNestedValue(config, parts)
setNestedValue(config, parts, value)
writeConfig(config)

const shownPath = parts.join(".")
ok(`${shownPath}: ${JSON.stringify(previous)} → ${JSON.stringify(value)}`)
