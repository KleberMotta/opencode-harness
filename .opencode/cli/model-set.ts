import { readConfig, writeConfig, die, ok } from "./_lib"

const tier = process.argv[2]
const model = process.argv[3]

if (!tier || !["strong", "medium", "weak"].includes(tier)) {
  die("uso: bun model:set-<strong|medium|weak> <model-id>")
}
if (!model) {
  die(`uso: bun model:set-${tier} <model-id>\nexemplo: bun model:set-${tier} github-copilot/claude-opus-4.7`)
}

const config = readConfig() as Record<string, any>
const previous = config[tier]
config[tier] = model
writeConfig(config)

ok(`${tier}: ${previous ?? "(unset)"} → ${model}`)
