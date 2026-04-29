import { readConfig, ok } from "./_lib"

const config = readConfig() as Record<string, any>
ok(`strong:  ${config.strong ?? "(unset)"}`)
ok(`medium:  ${config.medium ?? "(unset)"}`)
ok(`weak:    ${config.weak ?? "(unset)"}`)
