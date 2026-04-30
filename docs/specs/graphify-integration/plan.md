# Plan: Graphify Integration

- **Goal**: Integrar Graphify ao harness Juninho como camada opcional de redução de contexto e detecção de acoplamento, com doc-sync commit em `/j.unify` e smoke no `trp-seller-api`.
- **Spec**: N/A
- **Context**: docs/specs/graphify-integration/CONTEXT.md
- **Intent Type**: FEATURE
- **Complexity**: HIGH

## Write Targets
- `KleberMotta/opencode-harness` at `/Users/kleber.motta/repos`

## Reference Projects
- `olxbr/trp-seller-api` — ambiente read-only de smoke para rodar Graphify; o smoke pode manter outputs úteis em `docs/domain/graphify/`, mas não modifica source nem recebe artefatos de spec/plan/context.

## Context Map
- `CONTEXT.md#Goal` — integração Graphify opcional, redução de contexto e coupling detection.
- `CONTEXT.md#Constraints` — target único, smoke reference project, Graphify disabled by default, sem watch/pre-commit.
- `CONTEXT.md#Graphify-External-Contract` — pacote `graphifyy`, CLI, outputs, MCP e comandos.
- `CONTEXT.md#Business-Vocabulary-and-Identifier-Mapping` — chaves config, `GRAPHIFY_MODEL`, output e nomes de artefatos.
- `CONTEXT.md#Existing-Code-Patterns-To-Reuse` — CLIs, plugins, scripts e agent markdown canônicos.
- `CONTEXT.md#Integration-Contracts` — npm scripts, wrappers, MCP, finish-setup, unify e plugins.
- `CONTEXT.md#Data-and-Persistence-Constraints` — output versionado em `docs/domain/graphify`, cache e limite de 100MB.
- `CONTEXT.md#Test-and-Build-Policy` — comandos de validação e smoke.
- `CONTEXT.md#Decisions-Made` — decisões já aprovadas.
- `CONTEXT.md#Anti-Patterns-to-Avoid` — abordagens proibidas.

## Task 1 — Phase 0: habilitar commit único de doc-sync no /j.unify
- **Project**: `KleberMotta/opencode-harness`
- **Wave**: 1
- **Agent**: j.implementer
- **Depends**: None
- **Skills**: j.planning-artifact-writing

### Context References
- `CONTEXT.md#Constraints` — Phase 0 é pré-requisito obrigatório antes de publicar Graphify.
- `CONTEXT.md#Research-Findings` — `j.unify.md` hoje proíbe commits sintéticos de docs.
- `CONTEXT.md#Business-Vocabulary-and-Identifier-Mapping` — `workflow.unify.commitDocUpdates` default `true`.
- `CONTEXT.md#Anti-Patterns-to-Avoid` — não criar múltiplos commits de docs.

### Files
- `.opencode/juninho-config.json`
- `.opencode/lib/j.juninho-config.ts`
- `.opencode/cli/config-validate.ts`
- `.opencode/agents/j.unify.md`
- `AGENTS.md`

### Action
- Adicione `workflow.unify.commitDocUpdates` em `.opencode/juninho-config.json` com valor explícito `true`.
- Atualize o tipo `JuninhoConfig` e `DEFAULT_CONFIG.workflow.unify` em `.opencode/lib/j.juninho-config.ts` para incluir `commitDocUpdates: true`.
- Atualize `.opencode/cli/config-validate.ts` para aceitar `workflow.unify.commitDocUpdates`; não remova chaves existentes.
- Em `.opencode/agents/j.unify.md`, insira Step 5.5 `Commit Doc Updates`, depois dos Steps 4/5 e antes do cleanup/artifacts.
- O Step 5.5 deve detectar mudanças elegíveis com `git diff --name-only` e incluir apenas `docs/**`, `AGENTS.md`, `*/AGENTS.md`, `README.md`, `docs/domain/graphify/**`.
- O Step 5.5 deve criar exatamente um commit por write target quando existirem mudanças elegíveis, no branch `feature/{feature-slug}`, com mensagem `chore(docs): refresh after {feature-slug}`.
- O Step 5.5 não deve incluir source code, config não documental, migrações, testes ou `docs/specs/{feature-slug}/state/**`.
- Atualize a regra final de `j.unify.md` para permitir commit de doc-sync gated por `commitDocUpdates` e artifact commit gated por `commitFeatureArtifacts`, continuando a proibir commits sintéticos de código.
- Atualize `AGENTS.md` se necessário para documentar que `/j.unify` pode criar commit único de doc-sync.
- Não implemente Graphify refresh nesta tarefa; apenas deixe a ordem compatível.

### Verification
- `npm run config:validate`
- Inspeção estática de `.opencode/agents/j.unify.md` confirmando Step 5.5, allowlist e mensagem `chore(docs): refresh after {feature-slug}`.

### Done Criteria
- `workflow.unify.commitDocUpdates` existe no config, tipo e defaults com default efetivo `true`.
- `config:validate` aceita a nova chave.
- `j.unify.md` contém Step 5.5 com exatamente um commit elegível de doc-sync por write target.
- A regra final de `j.unify.md` permite doc-sync commit além de artifact commit e ainda proíbe commits sintéticos de código.
- Aceite documentado: `/j.unify` em feature de teste com mudança em `docs/domain/foo.md` deve produzir exatamente um commit `chore(docs): refresh after {feature-slug}`.

## Task 2 — Validar Phase 0 de doc-sync
- **Project**: `KleberMotta/opencode-harness`
- **Wave**: 2
- **Agent**: j.validator
- **Depends**: 1
- **Skills**: None

### Context References
- `CONTEXT.md#Constraints`
- `CONTEXT.md#Test-and-Build-Policy`
- `CONTEXT.md#Anti-Patterns-to-Avoid`

### Files
- None

### Action
- Leia `CONTEXT.md`, este `plan.md` e o diff da tarefa 1.
- Classifique cada Done Criterion da tarefa 1 como APPROVED/FIX/BLOCK/NOTE.
- Verifique que Step 5.5 não autoriza commits de source code ou múltiplos commits documentais.
- Verifique backward compatibility e separação entre `commitFeatureArtifacts` e `commitDocUpdates`.

### Verification
- `npm run config:validate`
- Todos os critérios da tarefa 1 APPROVED ou NOTE.

### Done Criteria
- Relatório em `docs/specs/graphify-integration/state/tasks/task-2/validator-work.md`.
- Nenhum BLOCK/FIX resta para Phase 0.

## Task 3 — Phase 1: helpers, CLIs, config e npm scripts Graphify
- **Project**: `KleberMotta/opencode-harness`
- **Wave**: 3
- **Agent**: j.implementer
- **Depends**: 2
- **Skills**: j.shell-script-writing,j.planning-artifact-writing

### Context References
- `CONTEXT.md#Graphify-External-Contract` — instalar `graphifyy`, usar `--output`, outputs esperados e comandos CLI.
- `CONTEXT.md#Business-Vocabulary-and-Identifier-Mapping` — chaves `workflow.graphify`, `GRAPHIFY_MODEL`, `workflow.unify.refreshGraphify`.
- `CONTEXT.md#Existing-Code-Patterns-To-Reuse` — CLIs Bun, shell helpers e workspace path helpers.
- `CONTEXT.md#Integration-Contracts` — npm scripts e wrappers esperados.
- `CONTEXT.md#Anti-Patterns-to-Avoid` — não usar pacote `graphify` single-y, watch ou pre-commit.

### Files
- `.opencode/juninho-config.json`
- `.opencode/lib/j.juninho-config.ts`
- `.opencode/lib/j.workspace-paths.ts`
- `.opencode/cli/config-validate.ts`
- `.opencode/cli/graphify-build.ts`
- `.opencode/cli/graphify-status.ts`
- `.opencode/scripts/graphify-build.sh`
- `.opencode/scripts/graphify-serve.sh`
- `package.json`
- `AGENTS.md`

### Action
- Adicione `workflow.graphify` em `.opencode/juninho-config.json`: `enabled: false`, `outputDir: "docs/domain/graphify"`, `staleAfterDays: 7`, `maxCacheMb: 100`, `installMethod: "pipx"`.
- Adicione `workflow.unify.refreshGraphify: false`; ela não deve ligar Graphify se `workflow.graphify.enabled` for `false`.
- Atualize `.opencode/lib/j.juninho-config.ts` e `.opencode/cli/config-validate.ts` com tipos/defaults/allowlists para essas chaves.
- Em `.opencode/lib/j.workspace-paths.ts`, crie `getGraphifyPath(targetRepoRoot: string, outputDir?: string): string` retornando path absoluto para `docs/domain/graphify` por default.
- Crie `.opencode/scripts/graphify-build.sh` POSIX: resolver target via `_resolve-repo.sh`, suportar `--incremental`, `--status`, `--output DIR`, `--repo PATH`, `--force` (bypass manual/smoke de `workflow.graphify.enabled` sem mudar config), `--help`.
- O script deve detectar `graphify`; se ausente, tentar `pipx install graphifyy` e depois `graphify install`; se falhar, sair com instrução `pipx install graphifyy && graphify install`.
- O script deve exportar `GRAPHIFY_MODEL` usando `weak` do config e rodar build completo `graphify "$TARGET_REPO_ROOT" --output "$GRAPHIFY_OUTPUT_DIR"`; incremental adiciona `--update`.
- O script nunca deve usar `--watch`, `graphify hook install` ou output default `graphify-out/`.
- Crie `.opencode/scripts/graphify-serve.sh`: ler `.opencode/state/active-plan.json`, escolher primeiro write target, resolver `graph.json`, iniciar `python3 -m graphify.serve "$GRAPH_JSON"` ou comando equivalente real.
- `graphify-serve.sh` deve sair silenciosamente status 0 se não houver active plan, target, graph.json ou Graphify disabled.
- Crie `.opencode/cli/graphify-build.ts` como wrapper Bun para o shell script.
- Crie `.opencode/cli/graphify-status.ts` imprimindo enabled, target, output path, existência de `graph.json`/`GRAPH_REPORT.md`, idade, cache MB, aviso >100MB; suportar `--json`.
- Atualize `package.json` com `graphify:build`, `graphify:refresh`, `graphify:status`.
- Atualize `AGENTS.md` para listar scripts Graphify e helper `getGraphifyPath`.

### Verification
- `npm run config:validate`
- `npm run graphify:status -- --json`
- `sh .opencode/scripts/graphify-build.sh --help`
- `sh .opencode/scripts/graphify-serve.sh --help` ou no-op documentado.

### Done Criteria
- Graphify está disabled by default; build manual em smoke só bypassa isso com `--force`/env explícito e não altera config do target.
- Scripts usam pacote `graphifyy`/CLI `graphify` e nunca instalam pacote `graphify` single-y.
- `graphify-build.sh` suporta build completo e incremental com output em `docs/domain/graphify`.
- `GRAPHIFY_MODEL` vem de `weak`/`models.weak`.
- `graphify-status.ts` avisa cache >100MB sem migrar automaticamente.
- `graphify-serve.sh` é no-op seguro sem active plan/graph.

## Task 4 — Validar fundação Graphify CLI/config
- **Project**: `KleberMotta/opencode-harness`
- **Wave**: 4
- **Agent**: j.validator
- **Depends**: 3
- **Skills**: None

### Context References
- `CONTEXT.md#Graphify-External-Contract`
- `CONTEXT.md#Integration-Contracts`
- `CONTEXT.md#Data-and-Persistence-Constraints`
- `CONTEXT.md#Anti-Patterns-to-Avoid`

### Files
- None

### Action
- Leia `CONTEXT.md`, plano e diffs das tarefas 1 e 3.
- Verifique defaults backward-compatible, scripts, CLIs e npm scripts.
- Verifique que nenhum watch/pre-commit foi adicionado.
- Verifique que `graphify-serve.sh` não quebra sessões sem active plan.

### Verification
- `npm run config:validate`
- `npm run graphify:status -- --json`
- Todos os critérios das tarefas 1 e 3 APPROVED ou NOTE.

### Done Criteria
- Relatório em `docs/specs/graphify-integration/state/tasks/task-4/validator-work.md`.
- Nenhum BLOCK/FIX resta na fundação CLI/config.

## Task 5 — Phase 2: atualizar agents consumidores para uso seguro de Graphify
- **Project**: `KleberMotta/opencode-harness`
- **Wave**: 5
- **Agent**: j.implementer
- **Depends**: 4
- **Skills**: j.planning-artifact-writing

### Context References
- `CONTEXT.md#Decisions-Made` — consumers definidos.
- `CONTEXT.md#Integration-Contracts` — report/query/path/explain e fallback.
- `CONTEXT.md#Graphify-External-Contract` — usar `GRAPH_REPORT.md` e queries focadas, não graph.json bruto.
- `CONTEXT.md#Anti-Patterns-to-Avoid` — não substituir context-mode/grep nem falhar quando ausente.

### Files
- `.opencode/agents/j.explore.md`
- `.opencode/agents/j.planner.md`
- `.opencode/agents/j.reviewer.md`
- `.opencode/agents/j.implementer.md`
- `.opencode/agents/j.checker.md`
- `.opencode/agents/j.librarian.md`
- `AGENTS.md`

### Action
- Atualize `j.explore.md`: se Graphify enabled/disponível, usar `GRAPH_REPORT.md` e `graphify_query` antes de grep para god nodes/acoplamentos; se ausente, fluxo atual.
- Atualize `j.planner.md`: Phase 1 lê `GRAPH_REPORT.md` quando disponível para calibrar complexidade, cita pelo menos um god node relevante e grava achados em `CONTEXT.md`.
- Atualize `j.reviewer.md`: Pass 2 usa `graphify_explain` ou equivalente para detectar cross-domain edges; indisponibilidade vira NOTE, não finding.
- Atualize `j.implementer.md`: READ phase permite `graphify_path` opcional entre símbolos/arquivos de tarefa; proibir ampliar escopo só por Graphify.
- Atualize `j.checker.md`: injeta/lê resumo de `GRAPH_REPORT.md` e repassa ao reviewer; nunca persistir `graph.json` inteiro.
- Atualize `j.librarian.md`: no refresh `/j.unify`, consumir diff de `GRAPH_REPORT.md` e resumir mudanças sem pesquisa web desnecessária.
- Atualize `AGENTS.md` Agent Roster/Custom Tools/Plugins para declarar Graphify como camada opcional.
- Cada agente deve declarar fallback explícito quando Graphify está disabled, stale ou sem graph.

### Verification
- Inspeção estática dos seis agent markdowns confirmando Graphify, artefato correto e fallback.
- `npm run config:validate`

### Done Criteria
- Todos os consumers têm instrução exata de quando usar Graphify vs context-mode/grep/LSP.
- Planner Phase 1 exige citar pelo menos um god node quando `GRAPH_REPORT.md` existir.
- Reviewer Pass 2 cobre cross-domain edges via Graphify quando disponível.
- Implementer não pode ampliar escopo só por descoberta Graphify.
- Checker não injeta `graph.json` bruto.

## Task 6 — Phase 3 e 4: finish-setup Step 7 e MCP registration
- **Project**: `KleberMotta/opencode-harness`
- **Wave**: 6
- **Agent**: j.implementer
- **Depends**: 5
- **Skills**: j.planning-artifact-writing,j.shell-script-writing

### Context References
- `CONTEXT.md#Decisions-Made` — build trigger é `/j.finish-setup` Step 7.
- `CONTEXT.md#Integration-Contracts` — MCP resolver `graphify-serve.sh` e output path.
- `CONTEXT.md#Graphify-External-Contract` — MCP server `python3 -m graphify.serve <graph.json>`.
- `CONTEXT.md#Anti-Patterns-to-Avoid` — fallback silencioso sem active plan.

### Files
- `.opencode/commands/j.finish-setup.md`
- `opencode.json`
- `AGENTS.md`

### Action
- Em `.opencode/commands/j.finish-setup.md`, adicione Step/Phase 7 “Bootstrap Graphify” depois da Phase 5.
- Step 7 resolve `$PROJECT_ROOT` como fases anteriores e respeita `workflow.graphify.enabled`.
- Quando disabled, Step 7 registra skip e não roda build.
- Quando enabled, Step 7 executa `npm run graphify:build -- --repo "$PROJECT_ROOT"` ou comando real da tarefa 3.
- Step 7 documenta outputs em `$PROJECT_ROOT/docs/domain/graphify/{graph.html,graph.json,GRAPH_REPORT.md,cache/}`.
- Step 7 avisa cache >100MB e recomenda Git LFS sem migrar automaticamente.
- Step 7 proíbe `--watch`, git hook e pre-commit.
- Em `opencode.json`, registre `mcp.graphify` como local stdio usando `.opencode/scripts/graphify-serve.sh`.
- Context7/context-mode permanecem registrados.
- Atualize `AGENTS.md` para documentar Step 7 e MCP Graphify opcional.

### Verification
- `npm run config:validate`
- Inspeção estática de `opencode.json` confirmando `mcp.graphify`.
- Inspeção estática de `j.finish-setup.md` confirmando Step 7 e skip disabled.

### Done Criteria
- `/j.finish-setup` documenta Graphify como Step 7 opcional e não roda quando disabled.
- MCP Graphify está registrado via wrapper, não Python hardcoded direto.
- Context7/context-mode permanecem registrados.
- Nenhuma instrução adiciona watch mode, hook ou pre-commit.

## Task 7 — Phase 5: integrar refresh Graphify no /j.unify e librarian
- **Project**: `KleberMotta/opencode-harness`
- **Wave**: 7
- **Agent**: j.implementer
- **Depends**: 6
- **Skills**: j.planning-artifact-writing,j.shell-script-writing

### Context References
- `CONTEXT.md#Decisions-Made` — refresh roda `graphify:refresh --incremental`, librarian consome diff, commit único.
- `CONTEXT.md#Integration-Contracts` — refresh antes do Step 5.5 commit doc updates.
- `CONTEXT.md#Data-and-Persistence-Constraints` — cache versionado e aviso >100MB.
- `CONTEXT.md#Anti-Patterns-to-Avoid` — não criar múltiplos commits nem hook/watch.

### Files
- `.opencode/agents/j.unify.md`
- `.opencode/agents/j.librarian.md`
- `.opencode/juninho-config.json`
- `.opencode/lib/j.juninho-config.ts`
- `.opencode/cli/config-validate.ts`
- `AGENTS.md`

### Action
- Atualize `j.unify.md` para inserir refresh Graphify antes do Step 5.5 Commit Doc Updates, controlado por `workflow.unify.refreshGraphify` e `workflow.graphify.enabled`.
- Documente comando real com `--incremental`, preferencialmente `npm run graphify:refresh -- --repo "$REPO_ROOT" --incremental` se alinhado à tarefa 3.
- Se Graphify estiver disabled, missing ou sem graph prévio, `/j.unify` reporta skip e continua.
- Mudanças em `docs/domain/graphify/**` entram no Step 5.5 doc-sync commit único, nunca commit separado.
- Documente que `@j.librarian` lê diff de `GRAPH_REPORT.md` após refresh para resumir mudanças sem web; se sem diff, NOTE.
- Complete config/defaults/validator para `workflow.unify.refreshGraphify` se tarefa 3 deixou lacunas.
- Atualize `AGENTS.md` com closeout Graphify refresh.

### Verification
- `npm run config:validate`
- Inspeção estática de `j.unify.md` confirmando refresh antes do Step 5.5 e commit único.

### Done Criteria
- Ordem em `/j.unify`: docs updates → domain index → Graphify incremental refresh → Step 5.5 commit doc updates.
- Graphify refresh não cria commit próprio.
- Librarian tem contrato read-only para resumir diff de `GRAPH_REPORT.md`.
- Unify funciona quando Graphify disabled/missing.

## Task 8 — Validar agents, finish-setup, MCP e unify refresh
- **Project**: `KleberMotta/opencode-harness`
- **Wave**: 8
- **Agent**: j.validator
- **Depends**: 5,6,7
- **Skills**: None

### Context References
- `CONTEXT.md#Decisions-Made`
- `CONTEXT.md#Integration-Contracts`
- `CONTEXT.md#Anti-Patterns-to-Avoid`
- `CONTEXT.md#Test-and-Build-Policy`

### Files
- None

### Action
- Leia `CONTEXT.md`, este `plan.md` e os diffs das tarefas 5, 6 e 7.
- Classifique Done Criteria dos agent markdowns, `/j.finish-setup` Step 7, `opencode.json` MCP e `/j.unify` Graphify refresh como APPROVED/FIX/BLOCK/NOTE.
- Verifique que todos os consumers têm fallback quando Graphify está disabled/missing/stale.
- Verifique que `opencode.json` preserva `context7` e `context-mode`.
- Verifique que `/j.unify` roda refresh Graphify antes do Step 5.5 e que qualquer mudança em `docs/domain/graphify/**` entra no commit único de doc-sync, não em commit separado.

### Verification
- `npm run config:validate`
- Todos os critérios das tarefas 5, 6 e 7 APPROVED ou NOTE.

### Done Criteria
- Relatório em `docs/specs/graphify-integration/state/tasks/task-8/validator-work.md`.
- Nenhum BLOCK/FIX resta para consumers, finish-setup, MCP ou unify refresh.

## Task 9 — Phase 6: plugins Graphify inject e stale warn
- **Project**: `KleberMotta/opencode-harness`
- **Wave**: 9
- **Agent**: j.implementer
- **Depends**: 8
- **Skills**: j.planning-artifact-writing

### Context References
- `CONTEXT.md#Integration-Contracts` — plugins `j.graphify-inject` e `j.graphify-stale-warn`.
- `CONTEXT.md#Business-Vocabulary-and-Identifier-Mapping` — staleAfterDays default 7.
- `CONTEXT.md#Existing-Code-Patterns-To-Reuse` — padrões de plugins existentes.
- `CONTEXT.md#Anti-Patterns-to-Avoid` — não injetar graph.json bruto nem bloquear quando stale.

### Files
- `.opencode/plugins/j.graphify-inject.ts`
- `.opencode/plugins/j.graphify-stale-warn.ts`
- `AGENTS.md`

### Action
- Crie `j.graphify-inject.ts` com padrão dos plugins existentes: resolver active plan/write target, ler config com `loadJuninhoConfig`, usar `getGraphifyPath`.
- Injete apenas resumo curto de `GRAPH_REPORT.md` quando `workflow.graphify.enabled` true, active target existir e report existir.
- Limite injeção a tamanho seguro (~3k tokens); nunca incluir `graph.json`.
- Evite duplicação por sessão.
- Crie `j.graphify-stale-warn.ts` verificando mtime de `GRAPH_REPORT.md`/`graph.json` contra `workflow.graphify.staleAfterDays` default 7.
- Stale warn anexa aviso não bloqueante quando stale, missing ou cache >100MB; não falha ferramentas.
- Ambos plugins são no-op quando disabled ou sem active plan.
- Atualize `AGENTS.md` seção Plugins.
- Não adicione auto-refresh nos plugins.

### Verification
- `npm run config:validate`
- `bun -e "import('./.opencode/plugins/j.graphify-inject.ts').then(()=>import('./.opencode/plugins/j.graphify-stale-warn.ts')).then(()=>console.log('ok'))"`
- Teste manual/mock documentado para mtime >7d.

### Done Criteria
- `j.graphify-inject` injeta `GRAPH_REPORT.md` resumido e nunca `graph.json` bruto.
- `j.graphify-stale-warn` dispara aviso com mock mtime >7d.
- Plugins são no-op seguros quando disabled, missing ou sem active plan.
- Nenhum plugin executa build/refresh automaticamente.

## Task 10 — Phase 7: skills Graphify usage e context-mode usage
- **Project**: `KleberMotta/opencode-harness`
- **Wave**: 9
- **Agent**: j.implementer
- **Depends**: 8
- **Skills**: skill-creator,j.planning-artifact-writing

### Context References
- `CONTEXT.md#Decisions-Made` — criar `j.graphify-usage` e `j.context-mode-usage`.
- `CONTEXT.md#Graphify-External-Contract` — query/path/explain, report e token budget.
- `CONTEXT.md#Anti-Patterns-to-Avoid` — não substituir context-mode/grep nem colar graph.json.
- `CONTEXT.md#Existing-Code-Patterns-To-Reuse` — registrar skills via `.opencode/skill-map.json`.

### Files
- `.opencode/skills/j.graphify-usage/SKILL.md`
- `.opencode/skills/j.context-mode-usage/SKILL.md`
- `.opencode/skill-map.json`
- `AGENTS.md`

### Action
- Aplique o padrão `skill-creator` antes de escrever as skills.
- Crie `j.graphify-usage/SKILL.md` ensinando uso de `GRAPH_REPORT.md`, `graphify_query`, `graphify_path`, `graphify_explain`, CLI equivalents e budgets.
- A skill Graphify deve dizer: use para mapa semântico, god nodes, acoplamento cross-domain e caminhos entre símbolos; não use para ler código exato, editar, validar compile ou substituir grep/LSP.
- Crie `j.context-mode-usage/SKILL.md` explicando decisão entre Graphify, context-mode, grep/Glob/LSP.
- Atualize `.opencode/skill-map.json` com padrões para `docs/domain/graphify/.*`, agents que mencionam Graphify/context-mode e docs/specs do próprio `graphify-integration`, sem sobrepor `j.planning-artifact-writing`.
- Atualize `AGENTS.md` lista de skills.
- Não crie skills `j.graphify-configuration-writing` ou `j.graphify-generated-artifact-writing`.

### Verification
- `npm run config:validate`
- Inspeção estática de `.opencode/skill-map.json` confirmando JSON/RegExp válidos.
- Leitura estática das skills confirmando matriz Graphify vs context-mode vs grep/LSP.

### Done Criteria
- `j.graphify-usage` existe e ensina uso seguro de report/query/path/explain.
- `j.context-mode-usage` existe e reduz overlap entre Graphify, context-mode e grep/LSP.
- Skill map ativa as skills nos contextos planejados sem substituir `j.planning-artifact-writing`.
- AGENTS.md lista as novas skills.

## Task 11 — Validar plugins e skills
- **Project**: `KleberMotta/opencode-harness`
- **Wave**: 10
- **Agent**: j.validator
- **Depends**: 9,10
- **Skills**: None

### Context References
- `CONTEXT.md#Integration-Contracts`
- `CONTEXT.md#Decisions-Made`
- `CONTEXT.md#Anti-Patterns-to-Avoid`
- `CONTEXT.md#Test-and-Build-Policy`

### Files
- None

### Action
- Leia `CONTEXT.md`, plano, diffs das tarefas 9 e 10.
- Verifique que plugins só injetam/avisam e não rodam refresh/build.
- Verifique stale warn por mock mtime >7d.
- Verifique que skills não conflitam com `j.planning-artifact-writing` e esclarecem context-mode.

### Verification
- `npm run config:validate`
- `bun -e "import('./.opencode/plugins/j.graphify-inject.ts').then(()=>import('./.opencode/plugins/j.graphify-stale-warn.ts')).then(()=>console.log('ok'))"` quando viável.
- Todos os critérios das tarefas 9 e 10 APPROVED ou NOTE.

### Done Criteria
- Relatório em `docs/specs/graphify-integration/state/tasks/task-11/validator-work.md`.
- Plugin stale warn aprovado com evidência de mock mtime >7d ou BLOCK explícito.
- Nenhum BLOCK/FIX resta para plugins/skills.

## Task 12 — Phase 8: smoke manual contra trp-seller-api
- **Project**: `KleberMotta/opencode-harness`
- **Wave**: 11
- **Agent**: j.validator
- **Depends**: 11
- **Skills**: None

### Context References
- `CONTEXT.md#Constraints` — `trp-seller-api` é reference project; outputs úteis podem permanecer.
- `CONTEXT.md#Graphify-External-Contract` — build/query/output contract.
- `CONTEXT.md#Test-and-Build-Policy` — critérios de smoke.
- `CONTEXT.md#Data-and-Persistence-Constraints` — output em `docs/domain/graphify` e cache versionado.

### Files
- `/Users/kleber.motta/repos/olxbr/trp-seller-api/docs/domain/graphify/` (allowed smoke output directory only; no source/spec/plan/context files in `trp-seller-api`)

### Action
- Leia `CONTEXT.md` e plano; confirme active plan `graphify-integration` no harness antes do smoke.
- Execute smoke contra reference repo sem modificar source. Como Graphify é disabled-by-default, o comando de build manual deve aceitar bypass explícito de smoke (`--force`, `GRAPHIFY_FORCE=1`, ou flag equivalente implementada na tarefa 3) sem alterar/commitar config do `trp-seller-api`: `TARGET_REPO_ROOT=/Users/kleber.motta/repos/olxbr/trp-seller-api npm run graphify:build -- --repo /Users/kleber.motta/repos/olxbr/trp-seller-api --force` ou comando real equivalente.
- Permita que outputs úteis permaneçam em `/Users/kleber.motta/repos/olxbr/trp-seller-api/docs/domain/graphify/`; não delete grafos gerados e não modifique source, `docs/specs/**`, `plan.md`, `CONTEXT.md` ou config do repo de referência.
- Meça tempo e registre se <10min.
- Registre custo real se CLI expuser; se não, NOTE com evidência.
- Execute query semântica budget ≤3000 contra o graph do seller-api sobre acoplamento entre seller creation, partner API e messaging; registre comando, saída resumida e tamanho aproximado.
- Verifique que `GRAPH_REPORT.md` existe e contém ao menos um god node; registre o god node.
- Valide `j.graphify-stale-warn` com mock mtime >7d.
- Valide Phase 0: em feature de teste ou simulação documentada, mudança elegível em `docs/domain/foo.md` deve produzir exatamente um commit `chore(docs): refresh after {feature-slug}`; se execução real for insegura, marcar BLOCK/NOTE conforme evidência.
- Confirme que targets disabled não regressam: `npm run graphify:status -- --json` deve reportar disabled/no-op sem erro.
- Não criar commit em `trp-seller-api`.

### Verification
- `npm run config:validate`
- `npm run graphify:status -- --json`
- Build Graphify contra `/Users/kleber.motta/repos/olxbr/trp-seller-api` concluído ou BLOCK com causa.
- Query Graphify com budget ≤3000 concluída ou BLOCK com causa.

### Done Criteria
- Relatório em `docs/specs/graphify-integration/state/tasks/task-12/validator-work.md` com comandos, tempo, outputs, query, god node e status dos critérios.
- Build smoke completa em <10min ou BLOCK explica gargalo.
- Custo ≤US$5 confirmado ou anotado como não observável.
- Query semântica retorna ≤3k tokens ou relatório abre FIX/BLOCK.
- `GRAPH_REPORT.md` gerado contém ao menos um god node citável.
- `/j.unify` doc-sync commit único validado por execução controlada ou BLOCK.
- Nenhuma alteração de source é feita em `trp-seller-api`; outputs Graphify úteis podem permanecer.
- Targets com Graphify disabled não regressam.

## Risks
- **HIGH**: Nomes exatos das tools MCP upstream podem diferir de `graphify_query/path/explain`. Mitigação: wrapper/agent docs mapeiam nomes reais e mantêm fallback CLI.
- **HIGH**: Auto-instalação via `pipx` pode falhar sem Python compatível. Mitigação: scripts falham com instrução clara e fluxos disabled seguem no-op.
- **MEDIUM**: Build pode exceder 10min ou US$5 no seller-api. Mitigação: smoke registra BLOCK/NOTE e uso permanece opt-in.
- **MEDIUM**: Output/cache pode crescer. Mitigação: status avisa >100MB e recomenda Git LFS.
- **MEDIUM**: Plugins podem poluir contexto. Mitigação: limite ~3k tokens e nunca inserir graph.json.
- **LOW**: Doc-sync commit pode incluir arquivos demais. Mitigação: Step 5.5 tem allowlist e exatamente um commit por target.
