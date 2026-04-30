/**
 * sync-config.ts — Generate opencode.json from template + juninho-config.json
 *
 * Reads opencode.template.json, replaces __STRONG_MODEL__, __MEDIUM_MODEL__,
 * __WEAK_MODEL__ placeholders with values from juninho-config.json, and writes
 * the final opencode.json.
 *
 * Usage:
 *   bun .opencode/cli/sync-config.ts
 *   npm run sync
 */
import { readFileSync, writeFileSync } from "fs"
import path from "path"

const root = path.resolve(import.meta.dir, "../..")
const templatePath = path.join(root, "opencode.template.json")
const configPath = path.join(root, "juninho-config.json")
const outputPath = path.join(root, "opencode.json")

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
  try {
    JSON.parse(template)
  } catch (e) {
    console.error("erro: template substituído não é JSON válido")
    process.exit(1)
  }

  writeFileSync(outputPath, template)
  console.log(
    `✓ opencode.json gerado (strong=${models.strong}, medium=${models.medium}, weak=${models.weak})`,
  )
}

main()
