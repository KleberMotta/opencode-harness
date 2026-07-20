import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readdirSync, readFileSync } from "fs"
import path from "path"
import { argFilePaths, toolIs } from "../lib/j.tool-compat"

// Artifact-ownership guard: keeps each producer role writing only the artifact
// it owns, enforced by a cheap PATH check in tool.execute.before.
//
// - implement (the task worker): may write product code + feature state, but
//   NOT the planning artifacts (plan.md / spec.md / CONTEXT.md). It must not
//   self-authorize a divergence by editing the plan that governs it.
// - canon-review (the independent reviewer, j.canon-reviewer): may write only
//   its review artifacts (under the feature state/) plus canon and harness
//   fixes. It must NOT touch product code or the planning artifacts.
//
// The independence of the reviewer's process is the real anti-forgery
// guarantee; this guard is only the thin path check the plan calls for.
//
// The session role is read from the runtime file j.task-runtime persists with a
// `stage` field at docs/specs/{slug}/state/sessions/{sessionID}-runtime.json
// (specsRoot is always {workspace}/docs/specs — see j.workspace-paths).
//
// Tool names and arg keys MUST go through j.tool-compat: opencode passes
// lowercase tool ids ("write"/"edit"/"apply_patch"/"bash") and camelCase args
// ("filePath"). A guard that matched "Write"/"file_path" would never fire — a
// documented failure mode of earlier harness plugins.

type Stage = "implement" | "validate" | "canon-review" | "check-reentry"

function resolveStage(directory: string, sessionID: string): Stage | null {
  if (!sessionID) return null
  const specsRoot = path.join(directory, "docs", "specs")
  let features: string[]
  try {
    features = readdirSync(specsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return null
  }
  for (const slug of features) {
    const runtimePath = path.join(specsRoot, slug, "state", "sessions", `${sessionID}-runtime.json`)
    if (!existsSync(runtimePath)) continue
    try {
      const stage = (JSON.parse(readFileSync(runtimePath, "utf-8")) as { stage?: Stage }).stage
      if (stage) return stage
    } catch {
      return null
    }
  }
  return null
}

function toWorkspaceRelative(directory: string, filePath: string): string {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(directory, filePath)
  return path.relative(directory, abs).replace(/\\/g, "/")
}

// plan.md / spec.md / CONTEXT.md live directly under docs/specs/{slug}/, never
// under its state/ subtree — so state artifacts never match.
const SPEC_ARTIFACT = /(^|\/)docs\/specs\/[^/]+\/(plan|spec|CONTEXT)\.md$/
const FEATURE_STATE = /(^|\/)docs\/specs\/[^/]+\/state\//
const CANON_CONTEXT = /(^|\/)(contexts|agent-context|\.context)\//
const HARNESS = /(^|\/)\.opencode\//

function isSpecArtifact(rel: string): boolean {
  return SPEC_ARTIFACT.test(rel)
}

// The reviewer owns its review artifacts (feature state/) and fixes canon
// (context) and harness. Everything else — product code AND planning
// artifacts — is off-limits.
function isReviewerWritable(rel: string): boolean {
  return FEATURE_STATE.test(rel) || CANON_CONTEXT.test(rel) || HARNESS.test(rel)
}

function argCommand(args: unknown): string {
  const record = (args ?? {}) as Record<string, unknown>
  return typeof record.command === "string" ? record.command : ""
}

// Shallow, on purpose: catches an obvious redirect/edit that writes a planning
// artifact (`>> plan.md`, `tee spec.md`, `sed -i ... CONTEXT.md`, `mv/cp x plan.md`)
// without pretending to be a wall. It does not fire on a plain read
// (`cat plan.md`) or a flag that only names the file (`--plan .../plan.md`).
const BASH_ARTIFACT_WRITE =
  /(>>?\s*(?:"|')?[^\s"'|&;]*\/?(?:plan|spec|CONTEXT)\.md)|((?:\btee\b|\bsed\s+-i\b|\bmv\b|\bcp\b)[^\n]*\b(?:plan|spec|CONTEXT)\.md)/

export default (async ({ directory }: { directory: string }) => {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string },
      output: { args: Record<string, unknown> }
    ) => {
      const isFileWrite = toolIs(input.tool, "write", "edit", "apply_patch")
      const isBash = toolIs(input.tool, "bash")
      if (!isFileWrite && !isBash) return

      const stage = resolveStage(directory, input.sessionID)
      if (stage !== "implement" && stage !== "canon-review") return
      const role = stage === "implement" ? "IMPLEMENTER" : "REVIEWER"

      if (isBash) {
        if (BASH_ARTIFACT_WRITE.test(argCommand(output.args))) {
          throw new Error(
            `[artifact-ownership] ${role}_ARTIFACT_BLOCKED: bash may not write plan/spec/CONTEXT; edit only your own artifact and stop.`
          )
        }
        return
      }

      for (const filePath of argFilePaths(output.args)) {
        const rel = toWorkspaceRelative(directory, filePath)
        if (stage === "implement") {
          if (isSpecArtifact(rel)) {
            throw new Error(
              `[artifact-ownership] IMPLEMENTER_ARTIFACT_BLOCKED: the implementer does not write plan/spec/CONTEXT (${rel}); report the conflict and stop.`
            )
          }
        } else if (!isReviewerWritable(rel)) {
          throw new Error(
            `[artifact-ownership] REVIEWER_ARTIFACT_BLOCKED: the reviewer does not write product code or plan/spec/CONTEXT (${rel}); write only your review artifacts and canon/harness fixes.`
          )
        }
      }
    },
  }
}) satisfies Plugin
