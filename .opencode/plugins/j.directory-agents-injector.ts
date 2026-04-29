import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "fs"
import path from "path"
import { findContainingProjectRoot } from "../lib/j.workspace-paths"

// Tier 1 context mechanism — hierarchical AGENTS.md injection.
// When an agent reads a file, walks the directory tree from the file's location
// to the project root and appends every AGENTS.md found to the Read output.
// Injects from root → most specific (additive, layered context).
// Uses tool.execute.after on Read — appends to output.output.

function findAgentsMdFiles(filePath: string, projectRoot: string): string[] {
  const result: string[] = []
  let current = path.dirname(filePath)

  // Walk up to project root (exclusive — root AGENTS.md is auto-loaded by OpenCode)
  while (current !== projectRoot && current !== path.dirname(current)) {
    const agentsMd = path.join(current, "AGENTS.md")
    if (existsSync(agentsMd)) {
      result.unshift(agentsMd) // prepend for root → specific order
    }
    current = path.dirname(current)
  }

  return result
}

export default (async ({ directory }: { directory: string }) => {
  const injectedPathsBySession = new Map<string, Set<string>>()

  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args: any },
      output: { title: string; output: string; metadata: any }
    ) => {
      if (input.tool !== "Read") return

      const filePath: string = input.args?.path ?? input.args?.file_path ?? ""
      if (!filePath || !filePath.startsWith(directory)) return

      // Resolve the actual project root containing this file, not the workspace root
      const projectRoot = findContainingProjectRoot(directory, filePath) ?? directory

      const injectedPaths = injectedPathsBySession.get(input.sessionID) ?? new Set<string>()
      injectedPathsBySession.set(input.sessionID, injectedPaths)

      const agentsMdFiles = findAgentsMdFiles(filePath, projectRoot)
      const toInject: string[] = []

      for (const agentsPath of agentsMdFiles) {
        if (injectedPaths.has(agentsPath)) continue
        injectedPaths.add(agentsPath)

        const content = readFileSync(agentsPath, "utf-8")
        const relPath = path.relative(projectRoot, agentsPath)
        toInject.push(`[directory-agents-injector] Context from ${relPath}:\n\n${content}`)
      }

      if (toInject.length > 0) {
        output.output += "\n\n" + toInject.join("\n\n---\n\n")
      }
    },
  }
}) satisfies Plugin
