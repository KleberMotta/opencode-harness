import type { Plugin } from "@opencode-ai/plugin"
import { execFileSync } from "child_process"
import { platform } from "os"
import { loadJuninhoConfig } from "../lib/j.juninho-config"

const TITLE = "opencode"
const CHILD_SESSIONS_MAX = 4096
const TERMINAL_APPS: Record<string, string> = {
  Apple_Terminal: "Terminal",
  "iTerm.app": "iTerm2",
  vscode: "Code",
  WarpTerminal: "Warp",
  WezTerm: "WezTerm",
  ghostty: "Ghostty",
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\"/g, '\\\"')
}

function hostTerminalIsFrontmost(): boolean | undefined {
  if (platform() !== "darwin") return undefined
  const termProgram = process.env.TERM_PROGRAM
  const terminalApp = termProgram ? TERMINAL_APPS[termProgram] : undefined
  if (!terminalApp) return undefined

  try {
    const activeApp = execFileSync(
      "osascript",
      ["-e", 'tell application "System Events" to get name of first application process whose frontmost is true'],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
    ).trim()
    return activeApp === terminalApp
  } catch {
    // If macOS accessibility automation is unavailable, preserve notifications.
    return undefined
  }
}

function sendNotification(message: string, sound?: string): void {
  try {
    const os = platform()
    if (os === "darwin") {
      const script =
        'display notification "' +
        escapeAppleScript(message) +
        '" with title "' +
        TITLE +
        '"' +
        (sound ? ' sound name "' + escapeAppleScript(sound) + '"' : "")
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

// session.idle is a bus event, not a plugin hook key — it only reaches
// plugins through the generic `event` hook.
export default (async ({ directory }: { directory: string }) => {
  // Child sessions (anything spawned with a parentID, e.g. task subagents)
  // idle constantly as they hand back to their parent; only top-level
  // sessions should raise a desktop notification.
  const childSessions = new Set<string>()

  return {
    event: async ({ event }: { event: { type: string; properties?: Record<string, unknown> } }) => {
      const properties = event.properties ?? {}

      if (event.type === "session.created") {
        const info = properties.info && typeof properties.info === "object" ? (properties.info as Record<string, unknown>) : {}
        const sessionID = str(properties.sessionID) ?? str(info.id)
        if (!sessionID || !str(info.parentID)) return
        if (childSessions.size >= CHILD_SESSIONS_MAX) childSessions.clear()
        childSessions.add(sessionID)
        return
      }

      if (event.type !== "session.idle") return
      const sessionID = str(properties.sessionID)
      if (sessionID && childSessions.has(sessionID)) return
      // Gate re-read per event so the toggle applies without a session restart.
      const automation = loadJuninhoConfig(directory).workflow?.automation
      if (automation?.idleNotifications === false) return
      if (automation?.idleNotificationsOnlyWhenBackground !== false && hostTerminalIsFrontmost()) return
      sendNotification(
        "idle session detected",
        automation?.idleNotificationsSilent ? undefined : automation?.idleNotificationSound,
      )
    },
  }
}) satisfies Plugin
