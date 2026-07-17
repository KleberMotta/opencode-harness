import type { Plugin } from "@opencode-ai/plugin"
import { readFileSync } from "fs"
import { createSkillMapResolver, resolveSkillPath } from "../lib/j.skill-map"
import { argFilePath, toolIs } from "../lib/j.tool-compat"

// Injects skill instructions via tool.execute.after on Read + Write.
//
// The resolution rule (merged skill-map, regex compilation, SKILL.md lookup)
// lives in ../lib/j.skill-map.ts so that `bun run skills:coverage` audits the
// exact same behaviour this plugin executes at runtime.

export default (async ({ directory }: { directory: string }) => {
  const injectedSkills = new Set<string>()
  const getSkillMap = createSkillMapResolver(directory)

  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args: any },
      output: { title: string; output: string; metadata: any }
    ) => {
      const filePath = argFilePath(input.args)
      if (!filePath) return

      const skillMap = getSkillMap(filePath)
      const matches = skillMap.filter(({ pattern }) => pattern.test(filePath))
      if (matches.length === 0) return

      if (toolIs(input.tool, "read")) {
        const injectedBlocks: string[] = []
        for (const match of matches) {
          const key = `${input.sessionID}:${match.skill}`
          if (injectedSkills.has(key)) continue

          const skillPath = resolveSkillPath(directory, match.skill, filePath)
          if (!skillPath) continue

          injectedSkills.add(key)
          const skillContent = readFileSync(skillPath, "utf-8")
          injectedBlocks.push(`\n\n[skill-inject] Skill activated for ${match.skill} (${match.source}):\n\n${skillContent}`)
        }
        if (injectedBlocks.length > 0) output.output += injectedBlocks.join("")
      } else if (toolIs(input.tool, "write", "edit")) {
        const reminders: string[] = []
        for (const match of matches) {
          const key = `${input.sessionID}:${match.skill}`
          if (injectedSkills.has(key)) continue

          const skillPath = resolveSkillPath(directory, match.skill, filePath)
          if (!skillPath) continue

          injectedSkills.add(key)
          reminders.push(`[skill-inject] IMPORTANT: Skill "${match.skill}" (${match.source}) exists for this file type. Read the matching file first to receive full skill instructions.`)
        }
        if (reminders.length > 0) output.output += `\n\n${reminders.join("\n")}`
      }
    },
  }
}) satisfies Plugin
