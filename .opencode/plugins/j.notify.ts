import type { Plugin } from "@opencode-ai/plugin"
import { execFileSync } from "child_process"
import { platform } from "os"

const TITLE = "opencode"

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\"/g, '\\\"')
}

function sendNotification(message: string): void {
  try {
    const os = platform()
    if (os === "darwin") {
      const script = 'display notification "' + escapeAppleScript(message) + '" with title "' + TITLE + '" sound name "Glass"'
      execFileSync("osascript", ["-e", script], {
        stdio: "ignore",
        timeout: 5000,
      })
      return
    }
    if (os === "linux") {
      execFileSync("notify-send", [TITLE, message, "--expire-time=5000"], {
        stdio: "ignore",
        timeout: 5000,
      })
    }
  } catch {
    // Never block the session on notification failures.
  }
}

export default (async (_ctx: { directory: string }) => ({
  "session.idle": async (_input: Record<string, unknown>, output: { metadata?: Record<string, unknown> }) => {
    const reason = typeof output.metadata?.reason === "string" ? output.metadata.reason : "idle session detected"
    sendNotification(reason)
  },
})) satisfies Plugin
