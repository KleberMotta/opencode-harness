import { readFileSync, writeFileSync, existsSync } from "fs"
import path from "path"
import type { JuninhoConfig } from "../lib/j.juninho-config"

export const CONFIG_PATH = path.resolve(
  import.meta.dir,
  "../..",
  "juninho-config.json",
)

export const ACTIVE_PLAN_PATH = path.resolve(
  import.meta.dir,
  "..",
  "state",
  "active-plan.json",
)

export function readConfig(): JuninhoConfig {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`juninho-config.json não encontrado em ${CONFIG_PATH}`)
  }
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"))
}

export function writeConfig(config: JuninhoConfig): void {
  const formatted = JSON.stringify(config, null, 2) + "\n"
  writeFileSync(CONFIG_PATH, formatted, "utf-8")
}

export function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8"))
}

export function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf-8")
}

export function setNestedValue(
  obj: Record<string, any>,
  pathParts: string[],
  value: unknown,
): void {
  let cursor: Record<string, any> = obj
  for (let i = 0; i < pathParts.length - 1; i++) {
    const key = pathParts[i]
    if (typeof cursor[key] !== "object" || cursor[key] === null) {
      cursor[key] = {}
    }
    cursor = cursor[key]
  }
  cursor[pathParts[pathParts.length - 1]] = value
}

export function getNestedValue(
  obj: Record<string, any>,
  pathParts: string[],
): unknown {
  let cursor: any = obj
  for (const key of pathParts) {
    if (cursor == null) return undefined
    cursor = cursor[key]
  }
  return cursor
}

export function parseToggleValue(raw: string): boolean | string | number {
  if (raw === "true") return true
  if (raw === "false") return false
  const num = Number(raw)
  if (!Number.isNaN(num) && raw.trim() !== "") return num
  return raw
}

export function die(message: string): never {
  console.error(`erro: ${message}`)
  process.exit(1)
}

export function ok(message: string): void {
  console.log(message)
}
