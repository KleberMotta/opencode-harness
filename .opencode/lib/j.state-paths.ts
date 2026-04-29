import path from "path"
import { resolveProjectPaths } from "./j.workspace-paths"

export function resolveStateFile(directory: string, filename: string): string {
  return path.join(directory, ".opencode", "state", filename)
}

export function resolveProjectStateFile(directory: string, filename: string, hints?: { targetRepoRoot?: string; planPath?: string; specPath?: string; contextPath?: string; taskContractPath?: string; prompt?: string }): string | null {
  const projectPaths = resolveProjectPaths(directory, hints)
  if (!projectPaths) return null
  return path.join(projectPaths.projectRoot, ".opencode", "state", filename)
}
