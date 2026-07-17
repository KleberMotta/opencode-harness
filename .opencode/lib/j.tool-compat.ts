// Normalizes tool.execute.* hook payloads across opencode versions and
// harness test fixtures. opencode 1.x registers tool ids in lowercase
// ("read", "edit", "write", "task") and passes camelCase args
// ("filePath", "oldString", "newString"). Older fixtures used Claude Code
// conventions ("Read"/"Edit" + "file_path"/"old_string"). Accept both so
// plugins keep working under either contract.

export function toolIs(tool: string | undefined, ...names: string[]): boolean {
  if (!tool) return false
  const normalized = tool.toLowerCase()
  return names.some((name) => name === normalized)
}

export function argFilePath(args: unknown): string {
  const record = (args ?? {}) as Record<string, unknown>
  for (const key of ["filePath", "file_path", "path", "filename"]) {
    const value = record[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return ""
}

export function argOldString(args: unknown): string {
  const record = (args ?? {}) as Record<string, unknown>
  for (const key of ["oldString", "old_string"]) {
    const value = record[key]
    if (typeof value === "string" && value.length > 0) return value
  }
  return ""
}
