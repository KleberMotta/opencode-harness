import type { Plugin } from "@opencode-ai/plugin"
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs"
import path from "path"
import { loadJuninhoConfig } from "../lib/j.juninho-config"
import { loadActivePlanTarget } from "../lib/j.workspace-paths"

// Pure telemetry listener: appends one JSONL line per relevant bus event.
// Zero context injection, zero prompt mutation, zero blocking — an event with
// an unexpected shape is silently ignored, never thrown.
//
// Sink resolution correlates events to features per session, never through the
// active-plan pointer alone (a stale pointer would route every session into an
// old feature's state dir):
//   1. docs/specs/{slug}/state/sessions/{sessionID}-runtime.json (written by
//      j.task-runtime) — definitive, cached per sessionID;
//   2. the active-plan slug, re-resolved per event (never cached: the session's
//      runtime file may appear after its first events);
//   3. {workspace}/.opencode/state/metrics.jsonl.
// Telemetry never resurrects feature state: docs/specs/{slug}/state/ is only
// written to when it already exists, otherwise the line goes to the global sink.
//
// Note: the local SDK typings (1.14.30) lag the running binary (1.17.20), so
// every payload field below is treated as optional and defensively typed.

const DEDUPE_MAP_MAX = 4096
const SESSION_SINK_MAX = 1024

type MetricsLine = Record<string, unknown>

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function sanitizeTokens(value: unknown): Record<string, unknown> | undefined {
  const raw = asRecord(value)
  const cache = asRecord(raw.cache)
  const tokens: Record<string, unknown> = {
    input: num(raw.input),
    output: num(raw.output),
    reasoning: num(raw.reasoning),
    cache: {
      read: num(cache.read),
      write: num(cache.write),
    },
  }
  const hasAny = num(raw.input) !== undefined || num(raw.output) !== undefined || num(raw.reasoning) !== undefined
  return hasAny ? tokens : undefined
}

export default (async ({ directory }: { directory: string }) => {
  // juninho-config gate, cached by the mtimes of the workspace-level config
  // candidates so per-event checks stay cheap while config edits still apply.
  let configCache: { key: string; enabled: boolean } | null = null

  function telemetryEnabled(): boolean {
    const key = [
      path.join(directory, ".opencode", "juninho-config.json"),
      path.join(directory, "juninho-config.json"),
    ]
      .map((candidate) => {
        try {
          return String(statSync(candidate).mtimeMs)
        } catch {
          return "0"
        }
      })
      .join("|")

    if (configCache?.key !== key) {
      const config = loadJuninhoConfig(directory)
      configCache = { key, enabled: config.workflow?.telemetry?.enabled !== false }
    }
    return configCache.enabled
  }

  const specsDir = path.join(directory, "docs", "specs")
  const globalMetricsFile = path.join(directory, ".opencode", "state", "metrics.jsonl")

  // Feature slug listing, cached by the specs dir mtime so per-event runtime
  // lookups stay cheap while new feature dirs are still picked up.
  let specSlugsCache: { key: string; slugs: string[] } | null = null

  function specSlugs(): string[] {
    let key: string
    try {
      key = String(statSync(specsDir).mtimeMs)
    } catch {
      return []
    }
    if (specSlugsCache?.key !== key) {
      try {
        specSlugsCache = {
          key,
          slugs: readdirSync(specsDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name),
        }
      } catch {
        specSlugsCache = { key, slugs: [] }
      }
    }
    return specSlugsCache.slugs
  }

  // Definitive session→sink resolutions (backed by a session runtime file).
  const sessionSink = new Map<string, string>()

  function metricsFile(sessionID: string | undefined): string {
    if (sessionID) {
      const cached = sessionSink.get(sessionID)
      if (cached) return cached

      for (const slug of specSlugs()) {
        if (!existsSync(path.join(specsDir, slug, "state", "sessions", sessionID + "-runtime.json"))) continue
        const file = path.join(specsDir, slug, "state", "metrics.jsonl")
        if (sessionSink.size >= SESSION_SINK_MAX) sessionSink.clear()
        sessionSink.set(sessionID, file)
        return file
      }
    }

    // No runtime correlation (yet): fall back to the active-plan slug without
    // caching it — j.task-runtime may write the session's runtime file after
    // the session's first events, and a cached fallback would pin a stale sink.
    let slug: string | undefined
    try {
      slug = loadActivePlanTarget(directory, { preferProjectState: true })?.slug?.trim() || undefined
    } catch {
      slug = undefined
    }
    return slug ? path.join(specsDir, slug, "state", "metrics.jsonl") : globalMetricsFile
  }

  function writeLine(line: MetricsLine, sessionID?: string): void {
    let file = metricsFile(sessionID)
    // Telemetry never resurrects feature state: if the resolved feature state
    // dir does not exist (stale pointer, plan cleanup), write to the global
    // sink instead of recreating it.
    if (file !== globalMetricsFile && !existsSync(path.dirname(file))) {
      if (sessionID) sessionSink.delete(sessionID)
      file = globalMetricsFile
    }
    if (file === globalMetricsFile) mkdirSync(path.dirname(file), { recursive: true })
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...line }) + "\n")
  }

  // Assistant messages re-emit message.updated as they stream; log a line only
  // when the cost/token fingerprint for (sessionID, messageID) changes.
  // step-finish parts get the same guard keyed by part id.
  const lastFingerprint = new Map<string, string>()

  function shouldLog(key: string, fingerprint: string): boolean {
    if (lastFingerprint.get(key) === fingerprint) return false
    if (lastFingerprint.size >= DEDUPE_MAP_MAX) lastFingerprint.clear()
    lastFingerprint.set(key, fingerprint)
    return true
  }

  return {
    event: async ({ event }: { event: { type: string; properties?: Record<string, unknown> } }) => {
      try {
        const type = event?.type
        if (!type) return
        const properties = asRecord(event.properties)

        if (type === "message.part.updated") {
          const part = asRecord(properties.part)
          if (part.type !== "step-finish") return
          if (!telemetryEnabled()) return

          const cost = num(part.cost)
          const tokens = sanitizeTokens(part.tokens)
          if (cost === undefined && !tokens) return

          const sessionID = str(part.sessionID)
          const messageID = str(part.messageID)
          const partID = str(part.id) ?? `${sessionID}:${messageID}`
          const fingerprint = JSON.stringify({ cost, tokens })
          if (!shouldLog(`step:${sessionID}:${partID}`, fingerprint)) return

          writeLine({ event: "step_finish", sessionID, messageID, cost, tokens }, sessionID)
          return
        }

        if (type === "message.updated") {
          const info = asRecord(properties.info)
          if (info.role !== "assistant") return
          if (!telemetryEnabled()) return

          const cost = num(info.cost)
          const tokens = sanitizeTokens(info.tokens)
          if (cost === undefined && !tokens) return

          const sessionID = str(info.sessionID)
          const messageID = str(info.id)
          const fingerprint = JSON.stringify({ cost, tokens })
          if (!shouldLog(`msg:${sessionID}:${messageID}`, fingerprint)) return

          writeLine({
            event: "message.updated",
            sessionID,
            messageID,
            modelID: str(info.modelID),
            providerID: str(info.providerID),
            cost,
            tokens,
          }, sessionID)
          return
        }

        if (type === "session.created") {
          if (!telemetryEnabled()) return
          const info = asRecord(properties.info)
          const sessionID = str(info.id)
          if (!sessionID) return
          writeLine({
            event: "session.created",
            sessionID,
            parentID: str(info.parentID),
            title: str(info.title),
          }, sessionID)
          return
        }

        if (type === "session.idle") {
          if (!telemetryEnabled()) return
          const sessionID = str(properties.sessionID)
          writeLine({ event: "session.idle", sessionID }, sessionID)
          return
        }

        if (type === "file.edited") {
          if (!telemetryEnabled()) return
          const file = str(properties.file)
          if (!file) return
          writeLine({ event: "file.edited", file })
          return
        }

        if (type === "command.executed") {
          if (!telemetryEnabled()) return
          const sessionID = str(properties.sessionID)
          writeLine({
            event: "command.executed",
            sessionID,
            command: str(properties.name),
            arguments: str(properties.arguments)?.slice(0, 200),
          }, sessionID)
        }
      } catch {
        // Telemetry must never break a session. Swallow everything.
      }
    },
  }
}) satisfies Plugin
