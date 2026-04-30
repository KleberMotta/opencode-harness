/**
 * Mapeamento canônico agente → tier de modelo.
 *
 * Tiers:
 *  - strong: decisão / qualidade (planejamento, validação, revisão)
 *  - medium: execução (implementação)
 *  - weak:   pesquisa read-only (exploração / docs externas)
 *
 * Usado por `bun model:set-<tier>` para propagar trocas de modelo em:
 *  - .opencode/agents/<name>.md (frontmatter `model:`)
 *  - opencode.json (campo `agent.<name>.model`)
 *  - .opencode/evals/lib/opencode-behavioral-runner.ts (defaults)
 */
export type Tier = "strong" | "medium" | "weak"

export const AGENTS_BY_TIER: Record<Tier, string[]> = {
  strong: [
    "j.planner",
    "j.plan",
    "j.plan-reviewer",
    "j.spec",
    "j.spec-writer",
    "j.checker",
    "j.reviewer",
    "j.unify",
    "j.validator",
  ],
  medium: ["j.implementer"],
  weak: ["j.explore", "j.librarian"],
}

export function tierForAgent(agentName: string): Tier | null {
  for (const tier of Object.keys(AGENTS_BY_TIER) as Tier[]) {
    if (AGENTS_BY_TIER[tier].includes(agentName)) return tier
  }
  return null
}
