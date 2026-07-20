import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "fs"
import path from "path"
import {
  contextRootsForFile,
  findContainingProjectRoot,
} from "../lib/j.workspace-paths"
import { argFilePath, toolIs } from "../lib/j.tool-compat"

// Tier 1 context mechanism — hierarchical AGENTS.md injection.
// When an agent reads a file, walks the directory tree from the file's location
// to the project root and appends every AGENTS.md found to the Read output.
// When the file lives beside one or more `.context` markers, their AGENTS.md
// files are injected ancestor → nearest
// first (most general → most specific, additive layered context).
// The workspace-root AGENTS.md is never injected — OpenCode auto-loads it.
// Uses tool.execute.after on Read — appends to output.output.

function findAgentsMdFiles(filePath: string, projectRoot: string): string[] {
  const result: string[] = []
  const rootAgents = path.join(projectRoot, "AGENTS.md")
  if (existsSync(rootAgents)) result.push(rootAgents)
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

function findContextAgentsMd(workspaceRoot: string, filePath: string): string[] {
  return contextRootsForFile(workspaceRoot, filePath)
    .slice()
    .reverse()
    .map((root) => path.join(root, "AGENTS.md"))
    .filter((file) => existsSync(file))
}

export default (async ({ directory }: { directory: string }) => {
  const injectedPathsBySession = new Map<string, Set<string>>()

  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args: any },
      output: { title: string; output: string; metadata: any }
    ) => {
      if (!toolIs(input.tool, "read")) return

      const filePath = argFilePath(input.args)
      if (!filePath || !filePath.startsWith(directory)) return

      // Resolve the actual project root containing this file, not the workspace root
      const projectRoot = findContainingProjectRoot(directory, filePath) ?? directory

      const injectedPaths = injectedPathsBySession.get(input.sessionID) ?? new Set<string>()
      injectedPathsBySession.set(input.sessionID, injectedPaths)

      const agentsMdFiles = findAgentsMdFiles(filePath, projectRoot)

      agentsMdFiles.unshift(...findContextAgentsMd(directory, filePath))

      const toInject: string[] = []

      for (const agentsPath of agentsMdFiles) {
        if (injectedPaths.has(agentsPath)) continue
        injectedPaths.add(agentsPath)

        const content = readFileSync(agentsPath, "utf-8")
        let relPath = path.relative(projectRoot, agentsPath)
        if (relPath.startsWith("..")) relPath = path.relative(directory, agentsPath)
        toInject.push(`[directory-agents-injector] Context from ${relPath}:\n\n${content}`)
      }

      if (toInject.length > 0) {
        output.output += "\n\n" + toInject.join("\n\n---\n\n")
      }
    },
  }
}) satisfies Plugin
