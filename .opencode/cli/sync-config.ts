/**
 * sync-config.ts — Generate opencode.json from template + juninho-config.json
 *
 * Reads opencode.template.json, replaces __STRONG_MODEL__, __MEDIUM_MODEL__,
 * __WEAK_MODEL__ placeholders with values from juninho-config.json, materializes
 * the "references" block from every contexts/<context>/references.json (paths
 * re-resolved to be relative to the
 * workspace root, where the config file lives), and writes the final
 * opencode.json.
 *
 * Usage:
 *   bun .opencode/cli/sync-config.ts
 *   npm run sync
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { discoverContextRoots } from "../lib/j.workspace-paths"

const root = path.resolve(import.meta.dir, "../..")
const templatePath = path.join(root, "opencode.template.json")
const configPath = path.join(root, "juninho-config.json")
const outputPath = path.join(root, "opencode.json")

type ReferenceObject = {
  path?: string
  repository?: string
  branch?: string
  description?: string
  hidden?: boolean
}
type ReferenceEntry = string | ReferenceObject

function isLocalRelativePath(value: string): boolean {
  if (path.isAbsolute(value)) return false
  if (value.startsWith("~/")) return false
  return true
}

// References paths in opencode.json are resolved relative to the config file
// (the workspace root). Entries in contexts/<context>/references.json are
// relative to that file, so re-anchor them: absolute if outside the workspace,
// workspace-relative otherwise (ex.: "../trp-financial-api" declared in
// `.context/references.json` entries are resolved relative to that marker.
function reanchorPath(referencesDir: string, value: string): string {
  if (!isLocalRelativePath(value)) return value
  const absolute = path.resolve(referencesDir, value)
  const relative = path.relative(root, absolute)
  if (relative === "" || relative.startsWith("..")) return absolute
  return relative
}

function reanchorEntry(referencesDir: string, entry: ReferenceEntry): ReferenceEntry {
  if (typeof entry === "string") {
    // String shorthand: local paths start with "." — anything else is a git
    // repository reference (owner/repo, URL) and must not be rewritten.
    return entry.startsWith(".") ? reanchorPath(referencesDir, entry) : entry
  }
  if (typeof entry === "object" && entry !== null && typeof entry.path === "string") {
    return { ...entry, path: reanchorPath(referencesDir, entry.path) }
  }
  return entry
}

function collectReferences(): { references: Record<string, ReferenceEntry>; contexts: number } {
  const references: Record<string, ReferenceEntry> = {}
  const sourceByKey: Record<string, string> = {}
  let contexts = 0

  for (const contextRoot of discoverContextRoots(root)) {
    const referencesFile = path.join(contextRoot, "references.json")
    if (!existsSync(referencesFile)) continue

    let parsed: Record<string, ReferenceEntry>
    try {
      parsed = JSON.parse(readFileSync(referencesFile, "utf-8"))
    } catch {
      console.warn(`⚠ references.json inválido ignorado: ${referencesFile}`)
      continue
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.warn(`⚠ references.json não é um objeto, ignorado: ${referencesFile}`)
      continue
    }

    contexts += 1
    const referencesDir = path.dirname(referencesFile)
    for (const [key, entry] of Object.entries(parsed)) {
      if (key in references) {
        console.warn(
          `⚠ colisão de reference "${key}" em ${referencesFile} (mantida a de ${sourceByKey[key]})`,
        )
        continue
      }
      references[key] = reanchorEntry(referencesDir, entry)
      sourceByKey[key] = referencesFile
    }
  }

  return { references, contexts }
}

function main() {
  const config = JSON.parse(readFileSync(configPath, "utf-8"))
  const models = config.models
  if (!models?.strong || !models?.medium || !models?.weak) {
    console.error(
      "erro: juninho-config.json deve ter models.strong, models.medium, models.weak",
    )
    process.exit(1)
  }

  let template = readFileSync(templatePath, "utf-8")
  template = template.replaceAll("__STRONG_MODEL__", models.strong)
  template = template.replaceAll("__MEDIUM_MODEL__", models.medium)
  template = template.replaceAll("__WEAK_MODEL__", models.weak)

  // Validate resulting JSON
  let output: Record<string, any>
  try {
    output = JSON.parse(template)
  } catch (e) {
    console.error("erro: template substituído não é JSON válido")
    process.exit(1)
  }

  const { references, contexts } = collectReferences()
  const templateReferences: Record<string, ReferenceEntry> = output.references ?? {}
  for (const key of Object.keys(references)) {
    if (key in templateReferences) {
      console.warn(`⚠ colisão de reference "${key}" com o template (mantida a do template)`)
      delete references[key]
    }
  }
  const referenceKeys = Object.keys(references)
  if (referenceKeys.length > 0) {
    output.references = { ...templateReferences, ...references }
  }

  writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n")
  console.log(
    `✓ opencode.json gerado (strong=${models.strong}, medium=${models.medium}, weak=${models.weak})`,
  )
  if (referenceKeys.length > 0) {
    console.log(
      `✓ references materializadas: ${referenceKeys.length} entrada(s) de ${contexts} contexto(s)`,
    )
  }
}

main()
