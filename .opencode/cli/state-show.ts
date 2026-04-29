import { existsSync, readFileSync } from "fs"
import path from "path"
import { ACTIVE_PLAN_PATH, ok } from "./_lib"

const stateDir = path.resolve(import.meta.dir, "..", "state")
const execPath = path.join(stateDir, "execution-state.md")

ok("=== active-plan ===")
if (existsSync(ACTIVE_PLAN_PATH)) {
  ok(readFileSync(ACTIVE_PLAN_PATH, "utf-8"))
} else {
  ok("(nenhum)")
}

ok("\n=== execution-state.md ===")
if (existsSync(execPath)) {
  ok(readFileSync(execPath, "utf-8"))
} else {
  ok("(ausente)")
}
