import { existsSync, unlinkSync } from "fs"
import { ACTIVE_PLAN_PATH, ok } from "./_lib"

if (!existsSync(ACTIVE_PLAN_PATH)) {
  ok("nenhum plano ativo para limpar")
  process.exit(0)
}

unlinkSync(ACTIVE_PLAN_PATH)
ok(`removido: ${ACTIVE_PLAN_PATH}`)
