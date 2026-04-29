import { readConfig, ok } from "./_lib"

const config = readConfig()
ok(JSON.stringify(config, null, 2))
