type HookName = "chat.message" | "tool.execute.before" | "tool.execute.after" | "event" | "experimental.session.compacting"

type PluginModule = Record<string, (...args: any[]) => Promise<void> | void>

export type LoadedPlugin = {
  name: string
  hooks: PluginModule
}

export async function loadPlugin(
  pluginPath: string,
  directory: string,
  options?: { client?: unknown }
): Promise<LoadedPlugin> {
  const mod = await import(pluginPath)
  const factory = mod.default as ((args: { directory: string; client?: unknown }) => Promise<PluginModule>) | undefined
  if (!factory) throw new Error(`Plugin at ${pluginPath} has no default export`)
  const hooks = await factory({ directory, client: options?.client })
  return { name: pluginPath, hooks }
}

export class PluginHarness {
  constructor(private readonly plugins: LoadedPlugin[]) {}

  async runChatMessage(input: { sessionID: string }, output: { message: { system?: string }; parts: unknown[] }) {
    await this.runHook("chat.message", input, output)
  }

  async runToolBefore(input: { tool: string; sessionID: string; callID: string }, output: { args: Record<string, unknown> }) {
    await this.runHook("tool.execute.before", input, output)
  }

  async runToolAfter(
    input: { tool: string; sessionID: string; callID: string; args: Record<string, unknown> },
    output: { title: string; output: string; metadata: Record<string, unknown> }
  ) {
    await this.runHook("tool.execute.after", input, output)
  }

  async runEvent(event: { type: string; properties?: Record<string, unknown> }) {
    await this.runHook("event", { event }, undefined)
  }

  async runCompaction(input: { sessionID?: string }, output: { context: string[]; prompt?: string }) {
    await this.runHook("experimental.session.compacting", input, output)
  }

  private async runHook(name: HookName, input: unknown, output: unknown) {
    for (const plugin of this.plugins) {
      const hook = plugin.hooks[name]
      if (!hook) continue
      if (name === "event") {
        await hook(input)
        continue
      }
      await hook(input, output)
    }
  }
}
