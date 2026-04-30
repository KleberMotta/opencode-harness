# Context: Graphify Integration

## Goal
Integrar o Graphify (`graphifyy`/CLI `graphify`) ao harness Juninho como camada opcional de redução de contexto e detecção de acoplamento, sem regressão quando desabilitado.

## Constraints
- Write target único: harness workspace `KleberMotta/opencode-harness` em `/Users/kleber.motta/repos`.
- Artefatos desta feature ficam somente em `/Users/kleber.motta/repos/docs/specs/graphify-integration/`.
- Projeto de referência/smoke: `olxbr/trp-seller-api` em `/Users/kleber.motta/repos/olxbr/trp-seller-api`; não modificar source desse projeto nem criar spec/plan/context nele.
- O smoke pode gerar e manter grafos úteis em `olxbr/trp-seller-api/docs/domain/graphify/`; não deletar esses outputs se forem reutilizáveis.
- Graphify deve ficar desabilitado por padrão até um target optar por habilitar.
- Build trigger oficial: `/j.finish-setup` Step 7 e scripts manuais; não usar watch mode nem pre-commit.
- Scripts shell seguem POSIX `#!/bin/sh`, `set -e`, variáveis quotadas e mensagens curtas.
- CLIs Bun seguem padrões existentes em `.opencode/cli/*.ts`.
- Linguagem natural dos artefatos e docs novas: português brasileiro; identificadores técnicos em English.
- O plano não cria `spec.md`; validação usa `CONTEXT.md` + `plan.md`.

## Research Findings
- `.opencode/juninho-config.json` já define `weak = github-copilot/claude-haiku-4.5`; scripts Graphify devem expor esse valor como `GRAPHIFY_MODEL`.
- `.opencode/cli/_lib.ts` centraliza leitura/escrita de config e estado; novos CLIs devem reutilizar helpers locais.
- `.opencode/cli/config-validate.ts` mantém allowlists; novas chaves em `workflow.unify` e `workflow.graphify` precisam entrar nele.
- `.opencode/lib/j.juninho-config.ts` contém defaults tipados; precisa adicionar `workflow.unify.commitDocUpdates`, `workflow.unify.refreshGraphify` e `workflow.graphify` com defaults backward-compatible.
- `.opencode/lib/j.workspace-paths.ts` resolve active plan/write targets; deve receber `getGraphifyPath(targetRepoRoot)` para padronizar `docs/domain/graphify`.
- `opencode.json` registra MCPs em `mcp`; Graphify deve ser registrado como servidor local usando `.opencode/scripts/graphify-serve.sh`.
- `.opencode/agents/j.unify.md` hoje proíbe commits sintéticos de docs; Phase 0 altera isso para permitir exatamente um commit doc-sync quando configurado.
- `.opencode/commands/j.finish-setup.md` tem fases até Phase 5; Graphify entra como Step/Phase 7 após docs/automação.
- Consumers existentes a atualizar: `j.explore`, `j.planner`, `j.reviewer`, `j.implementer`, `j.checker`, `j.librarian`.

## Graphify External Contract
- Pacote correto é `graphifyy`; instalar `graphify` instala pacote não relacionado.
- Requisito Python: `>=3.10,<3.14`.
- Instalação decidida: se `graphify` não existir, scripts tentam `pipx install graphifyy && graphify install`; sem `pipx`/falha, imprimir instrução clara.
- CLI build completo: `graphify <path> --output <dir>`; incremental: `graphify <path> --update --output <dir>`.
- CLI query/path/explain: `graphify query "..." --graph <graph.json> --budget <n>`, `graphify path <A> <B> --graph <graph.json>`, `graphify explain <node> --graph <graph.json>`.
- Outputs esperados: `graph.html`, `graph.json`, `GRAPH_REPORT.md`, `cache/`.
- Output alvo Juninho: `<targetRepoRoot>/docs/domain/graphify/` via `--output`.
- MCP upstream: `python3 -m graphify.serve <graph.json>`; wrapper deve sair silenciosamente sem active plan/graph.
- Tools esperadas pela decisão de produto: `graphify_query`, `graphify_path`, `graphify_explain`; implementação deve documentar mapeamento real se upstream expuser nomes diferentes.
- Watch mode existe mas está fora de escopo.
- Graphify não embute LLM; usa API key do assistente e envia conteúdo semântico, não raw code.

## Business Vocabulary and Identifier Mapping
- `graphifyy`: package PyPI.
- `graphify`: CLI command.
- `GRAPHIFY_MODEL`: env var setada pelo harness a partir de `weak`/`models.weak`; se CLI ignorar, não bloquear.
- `workflow.graphify.enabled`: opt-in, default `false`.
- `workflow.graphify.outputDir`: relativo ao target; default `docs/domain/graphify`.
- `workflow.graphify.staleAfterDays`: default `7`.
- `workflow.graphify.maxCacheMb`: default `100`.
- `workflow.graphify.installMethod`: default `pipx`.
- `workflow.unify.commitDocUpdates`: commit único doc-sync; default `true`.
- `workflow.unify.refreshGraphify`: refresh incremental durante `/j.unify`; default `false` e efetivo apenas com Graphify enabled.
- `GRAPH_REPORT.md`: resumo humano; pode ser injetado em contexto limitado.
- `graph.json`: fonte consultável; nunca colar inteiro no contexto.

## Existing Code Patterns To Reuse
- Bun CLI: `.opencode/cli/config-show.ts`, `.opencode/cli/config-validate.ts`, `.opencode/cli/plan-active.ts`.
- Config helpers: `.opencode/cli/_lib.ts`, `.opencode/lib/j.juninho-config.ts`.
- Workspace helpers: `.opencode/lib/j.workspace-paths.ts`.
- Plugins: `.opencode/plugins/j.plan-autoload.ts`, `.opencode/plugins/j.skill-inject.ts`, `.opencode/plugins/j.intent-gate.ts`.
- Shell: `.opencode/scripts/_resolve-repo.sh`, `.opencode/scripts/_read-config.sh`, `.opencode/scripts/check-all.sh`.
- Agent markdown: `.opencode/agents/*.md`.
- Skill format: `.opencode/skills/*/SKILL.md` + `.opencode/skill-map.json`.

## Integration Contracts
- npm scripts: `graphify:build`, `graphify:refresh`, `graphify:status`.
- `.opencode/scripts/graphify-build.sh`: resolve target, instala/detecta CLI, calcula output, exporta `GRAPHIFY_MODEL`, roda build completo/incremental.
- `.opencode/scripts/graphify-serve.sh`: lê active plan, escolhe primeiro write target, resolve `graph.json`, inicia MCP ou sai silenciosamente.
- `opencode.json`: `mcp.graphify` chama wrapper local.
- `/j.finish-setup` Step 7: se Graphify enabled, build; se disabled, skip intencional.
- `/j.unify`: refresh incremental Graphify antes do commit doc-sync quando habilitado.
- `j.graphify-inject`: injeta resumo curto de `GRAPH_REPORT.md` quando enabled e disponível.
- `j.graphify-stale-warn`: aviso não bloqueante quando mtime >7 dias ou cache >100MB.

## Data and Persistence Constraints
- `docs/domain/graphify/cache/` é versionado por decisão do piloto.
- Se output/cache >100MB, emitir aviso Git LFS; não migrar automaticamente.
- Não gravar em `graphify-out/` por default.
- Não criar watch process, git hook ou pre-commit.
- Não commitar source do projeto de referência; outputs smoke podem permanecer no disco.

## Test and Build Policy
- Base: `npm run config:validate`.
- CLIs: `npm run graphify:status -- --json`, help/status no-op.
- Shell: `sh .opencode/scripts/graphify-build.sh --help` e `sh .opencode/scripts/graphify-serve.sh --help` ou no-op documentado.
- Smoke contra `olxbr/trp-seller-api`: build <10min, custo ≤US$5 quando observável, query ≤3k tokens, god node no report, output em `docs/domain/graphify/`.
- Plugin stale warn: mock mtime >7 dias.

## Decisions Made
- Pilotar em `olxbr/trp-seller-api` como reference smoke, não write target.
- Integração combina `/j.finish-setup` Step 7, npm scripts e plugins `j.graphify-inject`/`j.graphify-stale-warn`.
- Sem watch mode, sem pre-commit.
- Consumers: explore, planner, reviewer, implementer, checker, librarian.
- MCP resolver usa active plan primeiro write target e fallback silencioso.
- Cache versionado; alertar >100MB.
- `/j.unify` refresh roda `graphify:refresh --incremental`; doc-sync fica em commit único `chore(docs): refresh after <feature>`.
- Criar skills `j.graphify-usage` e `j.context-mode-usage`.
- Instalação automática via `pipx install graphifyy && graphify install`.
- Smoke pode manter outputs úteis gerados no repo de referência.

## Anti-Patterns to Avoid
- Não instalar pacote PyPI `graphify` single-y.
- Não ativar Graphify por default.
- Não colar `graph.json` inteiro no contexto.
- Não criar watch mode, hook ou pre-commit.
- Não alterar source de `olxbr/trp-seller-api`.
- Não criar spec/plan/context no projeto de referência.
- Não deixar `/j.unify` criar múltiplos commits de docs.
- Não substituir context-mode/grep/LSP por Graphify.
- Não falhar sessões sem active plan por causa do MCP Graphify.

## Key Files
- `.opencode/juninho-config.json`
- `.opencode/lib/j.juninho-config.ts`
- `.opencode/lib/j.workspace-paths.ts`
- `.opencode/cli/config-validate.ts`
- `.opencode/cli/graphify-build.ts` (novo)
- `.opencode/cli/graphify-status.ts` (novo)
- `.opencode/scripts/graphify-build.sh` (novo)
- `.opencode/scripts/graphify-serve.sh` (novo)
- `package.json`
- `opencode.json`
- `.opencode/agents/j.unify.md`
- `.opencode/agents/j.explore.md`
- `.opencode/agents/j.planner.md`
- `.opencode/agents/j.reviewer.md`
- `.opencode/agents/j.implementer.md`
- `.opencode/agents/j.checker.md`
- `.opencode/agents/j.librarian.md`
- `.opencode/commands/j.finish-setup.md`
- `.opencode/plugins/j.graphify-inject.ts` (novo)
- `.opencode/plugins/j.graphify-stale-warn.ts` (novo)
- `.opencode/skills/j.graphify-usage/SKILL.md` (novo)
- `.opencode/skills/j.context-mode-usage/SKILL.md` (novo)
- `.opencode/skill-map.json`
- `AGENTS.md`

## Open Questions / Resolved Unknowns
- Resolvido: instalação automática via `pipx`.
- Resolvido: smoke pode escrever/manter outputs úteis em `trp-seller-api/docs/domain/graphify/`.
- Resolvido: não criar `spec.md`.
- Em aberto para implementação verificar: nomes exatos das tools MCP reais de `python -m graphify.serve`; se diferirem, documentar/adaptar sem quebrar contrato dos agentes.
