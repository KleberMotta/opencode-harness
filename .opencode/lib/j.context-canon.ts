import { existsSync, readFileSync } from "fs"
import path from "path"
import {
  contextRootsForFile,
  findContainingProjectRoot,
} from "./j.workspace-paths"
import { createSkillMapResolver, resolveSkillPath } from "./j.skill-map"

export type CanonFileBundle = {
  file: string
  projectAgents: string[]
  projectEvidence: string[]
  contextRoots: string[]
  contextAgents: string[]
  projectDomainRoot?: string
  contextDomainRoots: string[]
  projectPrinciplesRoot?: string
  contextPrinciplesRoots: string[]
  skills: Array<{ name: string; path: string; systemPath?: string; gotchasPath?: string }>
}

const ROOT_EVIDENCE_FILES = [
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  ".cursorrules",
  ".windsurfrules",
  "Makefile",
  "Justfile",
  "pom.xml",
  "package.json",
  "pyproject.toml",
  "build.gradle",
  "build.gradle.kts",
  "settings.gradle",
  "settings.gradle.kts",
  "gradle.properties",
]

function projectEvidence(projectRoot: string): string[] {
  const candidates = ROOT_EVIDENCE_FILES.map((name) => path.join(projectRoot, name))
  candidates.push(
    path.join(projectRoot, ".github", "copilot-instructions.md"),
    path.join(projectRoot, ".cursor", "rules"),
    path.join(projectRoot, ".claude", "rules"),
  )
  return candidates.filter((candidate) => existsSync(candidate))
}

function agentsForFile(filePath: string, projectRoot: string): string[] {
  const agents: string[] = []
  let current = path.dirname(filePath)
  while (current !== projectRoot && current !== path.dirname(current)) {
    const candidate = path.join(current, "AGENTS.md")
    if (existsSync(candidate)) agents.unshift(candidate)
    current = path.dirname(current)
  }
  const rootAgent = path.join(projectRoot, "AGENTS.md")
  if (existsSync(rootAgent)) agents.unshift(rootAgent)
  return agents
}

export function resolveCanonBundle(workspaceRoot: string, filePath: string): CanonFileBundle {
  const projectRoot = findContainingProjectRoot(workspaceRoot, filePath) ?? workspaceRoot
  const contextRoots = contextRootsForFile(workspaceRoot, filePath)
  const resolveMap = createSkillMapResolver(workspaceRoot)
  const skills = resolveMap(filePath)
    .filter(({ pattern }) => pattern.test(filePath))
    .map(({ skill }) => {
      const skillPath = resolveSkillPath(workspaceRoot, skill, filePath)
      if (!skillPath) return null
      const skillDir = path.dirname(skillPath)
      const systemPath = path.join(skillDir, "SYSTEM.md")
      const gotchasPath = path.join(skillDir, "GOTCHAS.md")
      return {
        name: skill,
        path: skillPath,
        systemPath: existsSync(systemPath) ? systemPath : undefined,
        gotchasPath: existsSync(gotchasPath) ? gotchasPath : undefined,
      }
    })
    .filter((skill): skill is NonNullable<typeof skill> => skill !== null)

  return {
    file: filePath,
    projectAgents: agentsForFile(filePath, projectRoot),
    projectEvidence: projectEvidence(projectRoot),
    contextRoots,
    contextAgents: contextRoots
      .map((root) => path.join(root, "AGENTS.md"))
      .filter((file) => existsSync(file)),
    projectDomainRoot: path.join(projectRoot, "docs", "domain"),
    contextDomainRoots: contextRoots.map((root) => path.join(root, "docs", "domain")),
    projectPrinciplesRoot: path.join(projectRoot, "docs", "principles"),
    contextPrinciplesRoots: contextRoots.map((root) => path.join(root, "docs", "principles")),
    skills,
  }
}

export function contextRootForProject(workspaceRoot: string, projectRoot: string): string | null {
  return contextRootsForFile(workspaceRoot, projectRoot)[0] ?? null
}

export function renderCanonBundle(bundle: CanonFileBundle): string {
  const lines = [`FILE: ${bundle.file}`]
  for (const contextRoot of bundle.contextRoots) lines.push(`CONTEXT: ${contextRoot}`)
  for (const agents of bundle.contextAgents) lines.push(`CONTEXT_AGENTS: ${agents}`)
  if (bundle.projectDomainRoot) lines.push(`PROJECT_DOMAIN: ${bundle.projectDomainRoot}`)
  for (const domain of bundle.contextDomainRoots) lines.push(`CONTEXT_DOMAIN: ${domain}`)
  if (bundle.projectPrinciplesRoot) lines.push(`PROJECT_PRINCIPLES: ${bundle.projectPrinciplesRoot}`)
  for (const principles of bundle.contextPrinciplesRoots) lines.push(`CONTEXT_PRINCIPLES: ${principles}`)
  for (const agent of bundle.projectAgents) lines.push(`AGENTS: ${agent}`)
  for (const evidence of bundle.projectEvidence) lines.push(`PROJECT_EVIDENCE: ${evidence}`)
  for (const skill of bundle.skills) {
    lines.push(`SKILL: ${skill.name} ${skill.path}`)
    if (skill.systemPath) lines.push(`SYSTEM: ${skill.systemPath}`)
    if (skill.gotchasPath) lines.push(`GOTCHAS: ${skill.gotchasPath}`)
  }
  return lines.join("\n")
}

export function readCanonFile(filePath: string): string | null {
  return existsSync(filePath) ? readFileSync(filePath, "utf-8") : null
}
