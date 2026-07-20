import path from "path"
import { die, ok } from "./_lib"
import { renderCanonBundle, resolveCanonBundle } from "../lib/j.context-canon"

const workspaceRoot = path.resolve(import.meta.dir, "..", "..")
const args = process.argv.slice(2)
const fileIndex = args.indexOf("--file")

if (fileIndex === -1 || !args[fileIndex + 1]) {
  die("uso: bun .opencode/cli/context-resolve.ts --file <arquivo-absoluto-ou-relativo>")
}

const filePath = path.resolve(workspaceRoot, args[fileIndex + 1])
ok(renderCanonBundle(resolveCanonBundle(workspaceRoot, filePath)))
