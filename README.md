# Workspace `~/repos` — Harness Juninho sobre OpenCode

Este repositório raiz é o meu **workspace pessoal de desenvolvimento**. Ele não contém código de produto — contém apenas a infraestrutura compartilhada do agente (`.opencode/`), documentação (`docs/`) e uma área temporária (`tmp/`). Cada projeto real (ex.: `olxbr/trp-seller-api`) vive em subpastas que **não** são versionadas aqui (cada uma tem seu próprio git remoto).

O que torna este workspace especial é o **harness Juninho**: uma camada de orquestração construída em cima do [opencode](https://opencode.ai) que transforma um agente "chat com tools" em um **fluxo determinístico spec-driven**, com agentes especializados, gates de qualidade automatizados, contexto hierárquico injetado por plugin e estado persistente por feature.

---

## 1. Estrutura do workspace

```
~/repos/
├── .gitignore              # allowlist: só versiona o que importa para o harness
├── AGENTS.md               # contrato global de agentes (carregado automaticamente)
├── README.md               # este arquivo
├── package.json            # CLI utilitário do harness (rodável com `bun <script>`)
├── opencode.json           # configuração do runtime opencode
├── .opencode/              # HARNESS JUNINHO — o coração deste workspace
│   ├── agents/             # subagentes especializados (markdown declarativo)
│   ├── cli/                # scripts TS do CLI utilitário (config, model, plan, state)
│   ├── commands/           # comandos /j.* expostos no CLI
│   ├── plugins/            # plugins runtime em TypeScript (hooks do opencode)
│   ├── lib/                # bibliotecas compartilhadas dos plugins
│   ├── scripts/            # shell scripts (check-all, pre-commit, activate-plan…)
│   ├── skills/             # SKILL.md por padrão de código (ex.: writing services)
│   ├── skill-map.json      # mapeia file pattern → skill
│   ├── juninho-config.json # toggles de workflow do harness
│   ├── state/              # estado de sessão (active-plan, persistent-context)
│   ├── templates/          # templates para artefatos (spec, CONTEXT, plan…)
│   ├── tools/              # custom tools (find_pattern, lsp_*, ast_grep_*, …)
│   ├── evals/              # baterias de eval (structural, behavioral)
│   └── hooks/              # hooks git instalados pelo finish-setup
├── docs/                   # documentação versionada do workspace
└── tmp/                    # rascunhos descartáveis (não versionado)
```

### Por que `.gitignore` usa allowlist?

```
/*
!.gitignore
!AGENTS.md
!README.md
!opencode.json
!.opencode/
!docs/
!tmp/
!package.json
/tmp/*
```

O padrão `/*` ignora **tudo** na raiz por padrão. As linhas `!` re-incluem apenas o que é meu. Isto garante que clonar um projeto novo dentro de `~/repos/olxbr/` **nunca** vai aparecer como untracked aqui — cada projeto tem seu próprio git, e este workspace só rastreia o harness.

---

## 2. O que é o "harness Juninho"

Em uma linha: **um framework agêntico spec-driven plugado no opencode.**

O agente principal nunca implementa código diretamente. Ele **delega** para subagentes especializados, cada um com responsabilidade única, e o estado de cada execução é persistido em disco para sobreviver a compactações de contexto e reinícios de sessão.

### 2.1 Cinco camadas de contexto

| Camada | Mecanismo | Quando dispara |
|---|---|---|
| 1 | `AGENTS.md` hierárquicos + `j.directory-agents-injector` | Sempre que um arquivo é lido — empilha do root até o diretório do arquivo |
| 2 | `j.carl-inject` — princípios + domain docs por content match | Em Read e em compactação |
| 3 | `j.skill-inject` — file pattern → SKILL.md | Em Read/Write quando o caminho casa com o `skill-map.json` |
| 4 | `<skills>` declarado na task do `plan.md` | Explícito por task |
| 5 | Estado persistente em `.opencode/state/` e `docs/specs/{slug}/state/` | Runtime, intersessão, por task |

Resultado: o agente que implementa uma controller Spring MVC já recebe automaticamente o `AGENTS.md` da pasta da controller, o princípio "thin controllers", a skill `j.controller-writing`, o `CONTEXT.md` da feature ativa e o histórico do `implementer-work.md` — sem precisar pedir.

---

## 3. Os dois caminhos de trabalho

### Path A — Spec-driven (features formais)

```
/j.spec  ──►  /j.plan  ──►  /j.implement  ──►  /j.check  ──►  /j.unify
   │            │              │                  │              │
   ▼            ▼              ▼                  ▼              ▼
docs/specs/{slug}/
  spec.md      plan.md       state/             check-       PR + docs
  CONTEXT.md   (aprovado)    tasks/task-N/      review.md    atualizadas
                             implementer-       reentry
                             work.md            contract
```

### Path B — Plan-driven (tarefas leves)

```
/j.plan  ──►  /j.implement  ──►  /j.check  ──►  /j.unify
```

Pula a entrevista de spec; útil para refactors pequenos, fixes pontuais ou melhorias localizadas.

---

## 4. Fluxo detalhado dos comandos

### 4.1 `/j.spec <feature>` — Entrevista de descoberta

Delega para `@j.spec-writer`, que conduz uma entrevista de **5 fases**:

```
Discovery  →  Requirements  →  Contract  →  Data  →  Review
   │              │              │           │         │
   ▼              ▼              ▼           ▼         ▼
explorer       use cases     APIs/eventos   schemas   spec.md
findings       happy path    DTOs           tabelas   CONTEXT.md
vocabulário    edge cases    erros          índices   (aprovado)
```

**Saída:**
- `docs/specs/{feature-slug}/spec.md` — fonte da verdade do negócio
- `docs/specs/{feature-slug}/CONTEXT.md` — descobertas dos exploradores, vocabulário, mapeamentos de identidade, restrições, decisões, anti-padrões e arquivos-chave (este arquivo é **memória durável** para todos os agentes seguintes)

### 4.2 `/j.plan <goal>` — Pipeline de 3 fases

Delega para `@j.planner`, que orquestra internamente:

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│  Phase 1    │ →  │   Phase 2    │ →  │  Phase 3    │
│   Metis     │    │  Prometheus  │    │   Momus     │
├─────────────┤    ├──────────────┤    ├─────────────┤
│ classifica  │    │ entrevista o │    │ loop com    │
│ intent;     │    │ developer    │    │ @j.plan-    │
│ spawn em    │    │ (proporcional│    │ reviewer    │
│ paralelo:   │    │ à complex.); │    │ até OKAY    │
│ @j.explore  │    │ enriquece    │    │ (≤3 issues, │
│ @j.librarian│    │ CONTEXT.md;  │    │ approval    │
│             │    │ escreve      │    │ bias)       │
│             │    │ plan.md      │    │             │
└─────────────┘    └──────────────┘    └─────────────┘
```

**Saída:** `docs/specs/{slug}/plan.md` aprovado, `CONTEXT.md` enriquecido, e o ponteiro `.opencode/state/active-plan.json` atualizado com **todos os write targets** (multi-projeto).

#### Multi-projeto

O `active-plan.json` separa:
- **`writeTargets`**: repos onde código será modificado.
- **`referenceProjects`**: repos lidos apenas para contexto/referência.

Exemplo real (`seller-creation-service`):

```json
{
  "slug": "seller-creation-service",
  "writeTargets": [
    { "project": "olxbr/trp-seller-api", "targetRepoRoot": "...", "planPath": "docs/specs/.../plan.md" },
    { "project": "olxbr/trp-infra",      "targetRepoRoot": "...", "planPath": "docs/specs/.../plan.md" }
  ],
  "referenceProjects": [
    { "project": "olxbr/trp-partner-api",   "reason": "Contrato de criação de seller; somente leitura." },
    { "project": "olxbr/trp-financial-api", "reason": "Padrão MessagingService/XB3; somente leitura." }
  ]
}
```

### 4.3 `/j.implement` — Execução do plano inteiro

Delega para `@j.implementer`, que roda o loop **READ → ACT → COMMIT → VALIDATE** task a task, com **uma branch canônica `feature/{slug}`** por feature.

```
Para cada writeTarget no active-plan.json:
  Para cada task em plan.md (respeitando depends/wave):

    ┌─────────────────────────────────────────────┐
    │ 1. spawn child @j.implementer (contexto     │
    │    fresco; recebe paths absolutos do task   │
    │    contract)                                │
    │                                             │
    │ 2. READ: CONTEXT.md (full) + spec.md +      │
    │    plan.md + arquivos da task               │
    │                                             │
    │ 3. ACT: edita código, gera testes           │
    │                                             │
    │ 4. PRE-COMMIT (rápido):                     │
    │    - lint-structure.sh                      │
    │    - build-verify.sh                        │
    │    - test-related.sh                        │
    │                                             │
    │ 5. COMMIT: 1 commit por task em             │
    │    feature/{slug} (apenas código/config —   │
    │    nada de state aqui)                      │
    │                                             │
    │ 6. VALIDATE: spawn @j.validator             │
    │    BLOCK / FIX / NOTE / APPROVED            │
    │    (FIX-tier: validator pode corrigir       │
    │    diretamente)                             │
    │                                             │
    │ 7. STATE: grava em                          │
    │    docs/specs/{slug}/state/tasks/task-N/    │
    │    - execution-state.md  (lease + status)   │
    │    - validator-work.md   (audit trail)      │
    │    - retry-state.json                       │
    │    - runtime.json                           │
    └─────────────────────────────────────────────┘

Antes de sair com sucesso:
  Para cada writeTarget:
    spawn validator nível-feature → escreve
    docs/specs/{slug}/state/functional-validation-plan.md
```

Regras críticas:
- **1 commit por task** na branch `feature/{slug}`. Sem commits adicionais para state.
- Cada child session começa com **contexto limpo** — protege a janela de contexto do orchestrator.
- Estado fica isolado **por write target** quando o plano é multi-projeto.

### 4.4 `/j.implement-task <repo>:<slug>/task<id>` — Execução focada

Versão cirúrgica do `/j.implement`. Executa **exatamente uma task** em **um único write target**, sai após `COMPLETE`/`FAILED`/`BLOCKED`. Não avança para tasks irmãs nem para o passe `functional-validation-plan.md`.

Sintaxes aceitas:
```
/j.implement-task seller-creation-service/task1
/j.implement-task seller-creation-service/task-1
/j.implement-task olxbr/trp-infra:seller-creation-service/task1
/j.implement-task seller-creation-service/task1 --project olxbr/trp-infra
```

Regra de desambiguação: se `{project}` é omitido e a task existe em múltiplos write targets, o orchestrator **para e pergunta** — nunca chuta.

O delegated prompt tem contrato fixo (paths absolutos para plan/spec/context/state, taskFiles resolvidos antecipadamente). Isto garante que a child session não precise descobrir nada sozinha.

### 4.5 `/j.check` — Quality gate completo

Delega para `@j.checker`, que:

```
1. Lê active-plan.json e descobre todos writeTargets

2. Para cada writeTarget:
   ├─ Roda .opencode/scripts/check-all.sh
   │  (typecheck + lint + tests do projeto inteiro;
   │   adapta para Node, Gradle/Kotlin ou Maven)
   │
   ├─ Lê CONTEXT.md + functional-validation-plan.md
   │
   └─ Delega @j.reviewer em multi-pass review:
      - Pass 1: correctness, bugs, edge cases
      - Pass 2: alinhamento spec/plan/domínio + blind spots
      - Pass 3: padrões do projeto, simplicidade, bloat

3. Persiste em cada writeTarget:
   docs/specs/{slug}/state/check-all-output.txt   (transcript)
   docs/specs/{slug}/state/check-review.md        (relatório)
                                                  + Reentry Contract
```

O **Reentry Contract** dentro do `check-review.md` é a peça-chave: ele lista paths exatos de artefatos e a próxima ação esperada do `/j.implement`, fechando o loop de correção.

**Regra forward-only**: se uma correção atinge uma task já `COMPLETE`, o harness cria uma **nova task de follow-up** em vez de reabrir a antiga. O histórico git permanece linear.

### 4.6 `/j.unify` — Fechamento

Delega para `@j.unify`. Lê os toggles de `juninho-config.json` (`workflow.unify.*`) e executa **apenas** os passos habilitados:

```
┌──────────────────────────────────────────────┐
│ Para cada writeTarget:                       │
│                                              │
│ 1. Reconcilia plan.md vs git diff            │
│    → marca tasks DONE / PARTIAL / SKIPPED    │
│                                              │
│ 2. Se updatePersistentContext: atualiza      │
│    persistent-context.md                     │
│                                              │
│ 3. Se updateDomainDocs: refresh de           │
│    docs/domain/                              │
│                                              │
│ 4. Se cleanupIntegratedTaskBranches:         │
│    cleanup usando integration-state.json     │
│                                              │
│ 5. Se commitFeatureArtifacts: commit dos     │
│    arquivos de docs/specs/{slug}/state/**    │
│                                              │
│ 6. Se createPullRequest: gh pr create        │
│    (corpo rico se createDeliveryPrBody)      │
└──────────────────────────────────────────────┘
```

Pré-requisitos: `gh auth login` ok, todas as tasks `COMPLETE`, validator `APPROVED` em todas, `/j.check` passou.

---

## 5. `juninho-config.json` — toggles do workflow

Arquivo: `~/repos/.opencode/juninho-config.json` (também procurado em projetos descendentes via `ancestorConfigCandidates`).

### 5.1 Modelos

| Chave | Significado | Valor atual |
|---|---|---|
| `strong` | Modelo "forte" para planner/spec-writer/checker | `github-copilot/gpt-5.5` |
| `medium` | Padrão dos demais agentes | `github-copilot/gpt-5.5` |
| `weak` | Para tarefas baratas (parsing, classificação leve) | `github-copilot/claude-haiku-4.5` |

### 5.2 Project metadata

| Chave | Uso |
|---|---|
| `projectType` | Hint para scripts de check (`node-generic`, `kotlin`, `maven`, …) |
| `isKotlin` | Atalho booleano usado em vários plugins |
| `buildTool` | `npm` / `gradle` / `mvn` |

### 5.3 `workflow.automation`

| Chave | Default | O que faz |
|---|---|---|
| `nonInteractive` | `false` | Em `true`, agentes não fazem `question()` — assumem decisões padrão |
| `autoApproveArtifacts` | `false` | Em `true`, planner/spec-writer não pedem aprovação humana antes de escrever artefatos |

### 5.4 `workflow.implement`

| Chave | Default | O que faz |
|---|---|---|
| `preCommitScope` | `"related"` | Escopo do pre-commit: `related` (testes só dos arquivos staged) ou `full` |
| `postImplementFullCheck` | `true` | Ao final do `/j.implement`, dispara `/j.check` automaticamente |
| `reenterImplementOnFullCheckFailure` | `true` | Se `/j.check` falha, reentra em `/j.implement` com o `check-review.md` |
| `watchdogSessionStale` | `true` no default, `false` aqui | Monitora sessões de child implementer; pode disparar 1 retry |
| `refreshExecutionHeartbeat` | `false` | Reescreve periodicamente `execution-state.md` para sinalizar vida |
| `skipLintOnPrecommit` | `false` | Em `true`, `pre-commit.sh` pula o `lint-structure.sh` (útil em repos sem lint configurado) |
| `skipTestOnPrecommit` | `false` | Em `true`, `pre-commit.sh` pula o `test-related.sh` (útil em repos sem test runner) |

### 5.5 `workflow.unify`

| Chave | Default | O que faz |
|---|---|---|
| `enabled` | `true` | Liga/desliga `/j.unify` por completo |
| `updatePersistentContext` | `true` | Reconcilia `.opencode/state/persistent-context.md` |
| `updateDomainDocs` | `true` | Refresca `docs/domain/` por target |
| `updateDomainIndex` | `true` | Atualiza `docs/domain/INDEX.md` |
| `cleanupIntegratedTaskBranches` | `true` | Limpa branches/worktrees integrados |
| `commitFeatureArtifacts` | (não-default `false` aqui) | Cria commit opcional de `docs/specs/{slug}/state/**` |
| `createPullRequest` | `true` no default, `false` aqui | Roda `gh pr create` |
| `createDeliveryPrBody` | `true` no default, `false` aqui | Gera corpo de PR rico (purpose/problem/solution/changes/validation) |

### 5.6 `workflow.documentation`

| Chave | Default | O que faz |
|---|---|---|
| `preferAgentsMdForLocalRules` | `true` | Regras de pasta vão em `AGENTS.md` daquela pasta, não em readmes soltos |
| `preferDomainDocsForBusinessBehavior` | `true` | Comportamento de negócio em `docs/domain/`, com sync markers |
| `preferPrincipleDocsForCrossCuttingTech` | `true` | Regras técnicas transversais em `docs/principles/` |
| `syncMarkers` | `true` | Usa `<!-- juninho:sync source=… hash=… -->` para detectar drift doc↔código |

### 5.7 Configuração ativa

```json
{
  "strong":  "github-copilot/gpt-5.5",
  "medium":  "github-copilot/gpt-5.5",
  "weak":    "github-copilot/claude-haiku-4.5",
  "projectType": "node-generic",
  "workflow": {
    "automation": { "nonInteractive": false, "autoApproveArtifacts": false },
    "implement":  {
      "preCommitScope": "related",
      "postImplementFullCheck": true,
      "reenterImplementOnFullCheckFailure": true,
      "watchdogSessionStale": false,
      "refreshExecutionHeartbeat": false
    },
    "unify": {
      "enabled": true,
      "updatePersistentContext": true,
      "updateDomainDocs": false,
      "updateDomainIndex": false,
      "cleanupIntegratedTaskBranches": true,
      "commitFeatureArtifacts": false,
      "createPullRequest": false,
      "createDeliveryPrBody": false
    },
    "documentation": {
      "preferAgentsMdForLocalRules": true,
      "preferDomainDocsForBusinessBehavior": true,
      "preferPrincipleDocsForCrossCuttingTech": true,
      "syncMarkers": true
    }
  }
}
```

A configuração local **desativou** PR automation, doc updates, e watchdog/heartbeat — provavelmente porque o workflow atual é supervisionado e os PRs são abertos manualmente.

---

## 6. Roster de agentes

| Agente | Papel |
|---|---|
| `@j.spec-writer` | Entrevista 5-fases → `spec.md` + `CONTEXT.md` rico |
| `@j.planner` | Pipeline 3-fases (Metis/Prometheus/Momus) → `plan.md` + `CONTEXT.md` enriquecido |
| `@j.explore` | Read-only research no codebase. Spawn pelo planner Phase 1 |
| `@j.librarian` | Read-only research em docs externas (Context7, MCPs). Spawn pelo planner Phase 1 |
| `@j.plan-reviewer` | Gate de executabilidade do plano. Approval bias, ≤3 issues. Interno ao planner |
| `@j.implementer` | READ→ACT→COMMIT→VALIDATE. Wave-based, 1 commit/task em `feature/{slug}` |
| `@j.validator` | Gate por task. BLOCK/FIX/NOTE/APPROVED. Pode corrigir FIX-tier diretamente |
| `@j.checker` | Orquestra `check-all.sh` + delega `@j.reviewer`. Persiste `check-review.md` |
| `@j.reviewer` | Multi-pass code review (correctness/intent/patterns) |
| `@j.unify` | Fecha o loop conforme toggles `workflow.unify.*` |

---

## 7. Plugins runtime

Instalados em `.opencode/plugins/`, carregados automaticamente pelo opencode. Cada um plugado em hooks específicos do runtime.

| Plugin | Hook | Função |
|---|---|---|
| `j.directory-agents-injector` | `tool.execute.after` (Read) | Anexa todo `AGENTS.md` da árvore (root → arquivo) |
| `j.env-protection` | `tool.execute.before` | Bloqueia leitura/escrita de `.env`, `*.pem`, `id_rsa`, `*.key`, "secret"/"credential" |
| `j.auto-format` | `tool.execute.after` (Write/Edit) | Roda prettier/black/gofmt/rustfmt conforme extensão |
| `j.plan-autoload` | `chat.message` + compaction + Read | Injeta o plano ativo em todas as child sessions |
| `j.carl-inject` | Read + compaction | Injeta princípios + domain docs por content match (CARL v3) |
| `j.skill-inject` | Read/Write | Injeta SKILL.md quando o path bate com `skill-map.json` |
| `j.task-runtime` | Task spawn + session created | Persiste metadata de runtime/lease/heartbeat |
| `j.task-board` | tool.after + compaction | Mantém board por task atualizado em estado de feature |
| `j.intent-gate` | Write/Edit | Avisa se o edit drift sai do escopo do plan |
| `j.todo-enforcer` | Write/Edit + compaction | Re-injeta tasks pendentes para evitar esquecimento |
| `j.notify` | session idle | Notificação local (osascript no macOS) em sessões paradas |
| `j.memory` | First tool call + compaction | Injeta `persistent-context.md` (memória de longo prazo) |
| `j.comment-checker` | Write/Edit | Flagga comentários óbvios (`// increment x`, `// loop through`, …) |
| `j.hashline-read` | Read | Prefixa cada linha lida com `NNN#XX:` (hash MD5 truncado) |
| `j.hashline-edit` | Edit | Valida que as referências `NNN#XX:` ainda batem antes de editar — protege contra edits cegos sobre conteúdo já desatualizado |

Os helpers compartilhados (`j.state-paths`, `j.feature-state-paths`, `j.workspace-paths`, `j.juninho-config`) ficam em `.opencode/lib/`.

---

## 8. Custom tools

Expostos pelo harness para os agentes (em `.opencode/tools/`):

| Tool | Para que serve |
|---|---|
| `find_pattern` | Devolve um exemplo canônico curado para um tipo de pattern (`api-route`, `service`, `repository`, `test-unit`, `error-handler`) |
| `next_version` | Gera o próximo nome de arquivo de migration/schema |
| `lsp_diagnostics` | Errors/warnings do workspace via LSP |
| `lsp_goto_definition` | Salta para a definição de um símbolo |
| `lsp_find_references` | Lista todos usos de um símbolo |
| `lsp_prepare_rename` | Valida segurança de rename |
| `lsp_rename` | Rename atômico cross-workspace |
| `lsp_workspace_symbols` / `lsp_document_symbols` | Outline / busca de símbolos |
| `ast_grep_search` | Busca estrutural por padrão (não regex) |
| `ast_grep_replace` | Substituição estrutural (com `dryRun`) |

---

## 9. Skills disponíveis

Skills são **pacotes de conhecimento dirigidos por padrão de arquivo**. Quando você lê/escreve um arquivo cujo path bate com uma entrada do `skill-map.json`, a `SKILL.md` correspondente é injetada na conversa.

Família atual (em `.opencode/skills/`):

- **Padrões de escrita Kotlin/Spring (TRP):** `j.controller-writing`, `j.service-writing`, `j.repository-writing`, `j.entity-writing`, `j.dto-writing`, `j.mapper-writing`, `j.model-writing`, `j.exception-writing`, `j.configuration-writing`, `j.listener-writing`, `j.utility-writing`, `j.client-writing`, `j.api-client-writing`, `j.partner-api-client-writing`, `j.seller-domain-model-writing`, `j.migration-writing`
- **Documentação:** `j.agents-md-writing`, `j.domain-doc-writing`, `j.principle-doc-writing`, `j.planning-artifact-writing`
- **Tests/automação:** `j.test-writing`, `j.shell-script-writing`
- **Meta:** `skill-creator` (cria/refina skills, define cenários de eval)

Cada `SKILL.md` contém: quando aplicar, regras canônicas, exemplos do código real, anti-padrões e checklist.

---

## 10. Estado persistente

### 10.1 Estado global (`.opencode/state/`, **não versionado**)

| Arquivo | Conteúdo |
|---|---|
| `active-plan.json` | Ponteiro para o plano ativo (slug, writeTargets, referenceProjects) |
| `execution-state.md` | Resumo de sessão global (objetivo ativo, plano, log de sessão) |
| `persistent-context.md` | Memória de longo prazo do projeto (atualizada pelo UNIFY) |

### 10.2 Estado por feature (`docs/specs/{slug}/state/`, versionado dentro de cada projeto)

| Arquivo | Conteúdo |
|---|---|
| `implementer-work.md` | Log append-only do implementer (decisões, retries, deviations) |
| `check-review.md` | Último relatório de `/j.check` + Reentry Contract |
| `check-all-output.txt` | Transcript bruto do `check-all.sh` |
| `functional-validation-plan.md` | Plano de validação funcional (gerado pelo validator nível-feature) |
| `integration-state.json` | Manifesto canônico: task → commit validado |
| `tasks/task-{id}/execution-state.md` | Lease, heartbeat, status, validated commit |
| `tasks/task-{id}/validator-work.md` | Audit trail do validator |
| `tasks/task-{id}/retry-state.json` | Budget de retry e bookkeeping |
| `tasks/task-{id}/runtime.json` | Metadata para watchdog/orquestração |
| `sessions/{sessionID}-runtime.json` | Mapa session → task runtime |

---

## 11. Vantagens deste setup

### 11.1 Determinismo em fluxos não-determinísticos
LLMs são estocásticos. O harness encapsula cada decisão em um agente isolado, com contrato escrito, sub-prompts fixos, gates automatizados e estado persistido. Resultado: o mesmo `/j.spec` rodado duas vezes produz `spec.md` semanticamente equivalentes mesmo com modelos diferentes.

### 11.2 Proteção da janela de contexto
Cada child session começa **limpa**. O orchestrator não acumula 200KB de leitura por task. Plugins (`j.plan-autoload`, `j.carl-inject`, `j.skill-inject`, `j.memory`) re-injetam apenas o necessário — e sobrevivem a compactações.

### 11.3 Spec-driven, não vibe-coded
`spec.md` + `CONTEXT.md` viram contratos verificáveis. O `@j.validator` valida cada task **contra a spec**, não contra "achismo". Code review (`@j.reviewer`) é multi-pass com critérios explícitos.

### 11.4 Multi-projeto nativo
Um único plano pode abranger N repositórios (write targets) + M referências. O harness mantém estado isolado por projeto, branches consistentes (`feature/{slug}` em cada repo), e cleanups coordenados.

### 11.5 Forward-only history
Tasks `COMPLETE` nunca são reabertas — correções viram follow-up tasks. Histórico git fica linear, auditável, e cada commit tem contexto rastreável até a spec original.

### 11.6 Configurabilidade granular
Praticamente todo passo automatizado tem um toggle em `juninho-config.json`. Em ambientes manuais, desligo `createPullRequest` e gerencio PRs no GitHub. Em ambientes batch, ligo `nonInteractive` e `autoApproveArtifacts`.

### 11.7 Skills como documentação executável
Em vez de "documentação que ninguém lê", as skills são injetadas **exatamente quando** o agente toca um arquivo daquele padrão. Conhecimento de pattern vira lei aplicada — não sugestão ignorada.

### 11.8 Hashlines para edits seguros
Toda Read tagga linhas com `NNN#XX:` (hash MD5 truncado da linha). Toda Edit valida o hash antes de aplicar. Isto **impede edits cegos** sobre arquivos que mudaram entre a leitura e a escrita — bug clássico em agentes que não validam estado.

---

## 12. TODO de melhorias

### 12.1 Documentação
- [ ] Criar `docs/principles/` com os princípios canônicos (thin controllers, error translation, idempotence, …)
- [ ] Criar `docs/domain/INDEX.md` e popular com os domínios reais dos projetos (seller, partner, financial, wallet)
- [ ] Adicionar diagrama (ASCII) do fluxo multi-projeto em `docs/`
- [ ] Versionar exemplos reais de `spec.md` / `CONTEXT.md` / `plan.md` aprovados como referência
- [ ] Criar guia "como adicionar uma skill nova" passo-a-passo
- [ ] Documentar evals: quando rodar `evals/run-layer.mjs` vs `evals/run-behavioral.mjs`

### 12.2 Workflow / configuração
- [ ] Avaliar reativar `watchdogSessionStale=true` para detectar sessions paradas em background
- [ ] Avaliar `refreshExecutionHeartbeat=true` em features longas (sessions de mais de ~30 min)
- [ ] Decidir política definitiva sobre `commitFeatureArtifacts` — atualmente `false`, mas isto perde o histórico do `state/`
- [ ] Reativar `createPullRequest` quando o fluxo de revisão de PR estiver maduro
- [ ] Considerar `autoApproveArtifacts=true` para refactors triviais (fast path para tasks pequenas)

### 12.3 Plugins / harness
- [ ] Plugin para detectar e bloquear `cd <dir> && <cmd>` (substituir por `workdir`)
- [ ] Métricas de eval: latência média de cada agente, taxa de retry, tempo entre commit e validator approval
- [ ] Dashboard local lendo `docs/specs/*/state/integration-state.json` para visão consolidada de features em progresso
- [ ] Plugin para alertar quando `CONTEXT.md` ficar > X bytes (sintoma de spec inchada)
- [ ] Hook para detectar quando `plan.md` é editado **depois** do início da implementação (sintoma de drift)
- [ ] Política de retenção: depois de UNIFY, mover `state/tasks/task-N/runtime.json` antigos para `state/archive/`

### 12.4 Skills
- [ ] Skill `j.spec-writing` (atualmente o agente segue o template diretamente — vale extrair regras)
- [ ] Skill `j.plan-writing` simétrica (regras para `plan.md`: granularidade de task, depends, waves, files explícitos)
- [ ] Skill `j.context-writing` para `CONTEXT.md` — estrutura padronizada (vocabulário, identifiers, anti-patterns, key files)
- [ ] Skill `j.commit-message-writing` (mensagens de commit que referenciem task id e intent)
- [ ] Revisar todas skills `j.*-writing` para incluir seção "checklist de aceitação" usada pelo validator

### 12.5 Custom tools
- [ ] `juninho_status` — tool que devolve resumo do estado atual (active plan, tasks pendentes, último check status)
- [ ] `juninho_ask_principle` — busca em `docs/principles/` por palavra-chave
- [ ] `juninho_ask_domain` — busca em `docs/domain/` por palavra-chave (já parcialmente coberto pelo carl-inject, mas como tool consultiva ajuda)
- [ ] `juninho_diff_plan_vs_code` — compara plan.md tasks vs commits reais na `feature/{slug}` (auxilia o `/j.unify`)
- [ ] Tool para listar todos os write targets ativos com seus status atuais (cleanup, integration, branch ahead/behind)

### 12.6 Workspace
- [ ] Adicionar `~/repos/scripts/` (shared) para bootstraps comuns (clone+setup de projetos novos)
- [ ] Snippet de instalação rápida para configurar este harness em uma nova máquina
- [ ] Adicionar pre-push hook que valida que nenhuma config sensível foi staged
- [ ] Criar `~/repos/CHANGELOG.md` para o harness — versionar mudanças em agentes/plugins/skills

---

## 13. Comandos de referência rápida

| Comando | O que faz |
|---|---|
| `/j.spec <feature>` | Entrevista 5-fases → `spec.md` + `CONTEXT.md` |
| `/j.plan <goal>` | Planner 3-fases → `plan.md` aprovado |
| `/j.activate-plan <repo|plan-path>` | Refresca `active-plan.json` para apontar outra feature |
| `/j.implement` | Executa o plano ativo inteiro |
| `/j.implement-task [proj:]<slug>/task<id>` | Executa exatamente uma task |
| `/j.check` | Quality gate completo + multi-pass review |
| `/j.lint` | Apenas o structure lint do pre-commit |
| `/j.test` | Apenas os testes change-scoped |
| `/j.sync-docs` | Refresca AGENTS, domain docs e principle docs a partir do código |
| `/j.finish-setup` | Bootstrap: gera `AGENTS.md` hierárquicos, popula `skill-map.json`, cria docs base |
| `/j.pr-review` | Review advisory do diff atual da branch |
| `/j.status` | Resumo do `execution-state.md` |
| `/j.unify` | Fecha o loop (docs/cleanup/PR conforme config) |
| `/j.start-work <task>` | Inicializa sessão focada em uma task |
| `/j.handoff` | Gera doc de handoff para próxima sessão |
| `/j.ulw-loop` | Modo "máximo paralelismo" (uso especializado) |

---

## 14. Convenções

- **Specs:** `docs/specs/{feature-slug}/{spec.md, CONTEXT.md, plan.md, state/**}`
- **Domain docs:** `docs/domain/{domain}/*.md`, indexados em `docs/domain/INDEX.md`
- **Principles:** `docs/principles/{topic}.md`, registrados em `docs/principles/manifest`
- **Sync markers:** `<!-- juninho:sync source=… hash=… -->` para detectar drift doc↔código
- **Branch:** sempre `feature/{slug}` para todo o ciclo de vida de uma feature (do primeiro commit ao PR)
- **Commits:** exatamente 1 por task de implementação; artefatos de state opcionalmente em 1 commit no UNIFY
- **AGENTS.md hierárquicos:** `~/repos/AGENTS.md` (global) → `<projeto>/AGENTS.md` → `<projeto>/src/AGENTS.md` → `<projeto>/src/{módulo}/AGENTS.md`

---

## 15. Como rodar comandos do harness

Dentro do opencode TUI, basta digitar `/` e selecionar o comando, ou digitar a invocação completa: `/j.implement-task seller-creation-service/task1`.

Os comandos `/j.*` **delegam para subagentes** (`@j.*`) — o orchestrator nunca executa o trabalho diretamente. Esta separação é o que mantém o sistema escalável e auditável.

---

## 16. CLI utilitário do harness (`package.json`)

Algumas operações repetitivas no `juninho-config.json` e no `state/` (trocar modelo dos agentes, ativar plano, inspecionar/limpar state) **não exigem uma sessão do opencode**. Pra essas, existe um CLI utilitário em TypeScript rodando direto no [Bun](https://bun.sh) — sem dependências, sem `npm install`, sem `node_modules`.

### 16.1 Pré-requisito

```bash
bun --version   # já vem instalado neste workspace
```

> **Por que Bun?** Os plugins/lib/tools do harness já são TypeScript executados pelo opencode em runtime Bun. Reaproveitar o runtime mantém o `package.json` zero-deps. Como Bun aceita scripts customizados sem `run`, a sintaxe fica `bun model:set-strong …` em vez de `npm run model:set-strong …`.

### 16.2 Comandos disponíveis

Todos rodam a partir de `~/repos/`:

| Script | O que faz | Exemplo |
|--------|-----------|---------|
| `bun config:show` | Imprime o `juninho-config.json` formatado | `bun config:show` |
| `bun config:validate` | Valida chaves desconhecidas + tipos básicos | `bun config:validate` |
| `bun model:list` | Lista modelos `strong/medium/weak` ativos | `bun model:list` |
| `bun model:set-strong <id>` | Troca o modelo `strong` (usado por planner, implementer, validator…) | `bun model:set-strong github-copilot/claude-opus-4.7` |
| `bun model:set-medium <id>` | Troca o modelo `medium` | `bun model:set-medium github-copilot/gpt-5.5` |
| `bun model:set-weak <id>` | Troca o modelo `weak` (explore, librarian) | `bun model:set-weak github-copilot/claude-haiku-4.5` |
| `bun toggle <key.path> <value>` | Edita qualquer toggle em `workflow.*` (prefixo `workflow.` é inferido se omitido) | `bun toggle unify.createPullRequest true` |
| `bun plan:active` | Mostra o plano ativo (writeTargets + referenceProjects) | `bun plan:active` |
| `bun plan:activate <project> <slug>` | Ativa um plano existente em um repo (single write target) | `bun plan:activate olxbr/trp-seller-api seller-creation-service` |
| `bun plan:clear` | Remove o `state/active-plan.json` | `bun plan:clear` |
| `bun state:show` | Imprime `active-plan.json` + `execution-state.md` | `bun state:show` |
| `bun state:clear-task <slug> <task-id>` | Remove o diretório de state de uma task em todos os write targets | `bun state:clear-task seller-creation-service task-5` |
| `bun skills:list` | Lista todas as skills + descrição | `bun skills:list` |
| `bun agents:list` | Lista todos os subagentes + descrição | `bun agents:list` |

### 16.3 Caso de uso típico — trocar modelo strong sem abrir sessão

```bash
cd ~/repos
bun model:list
# strong:  github-copilot/gpt-5.5
# medium:  github-copilot/gpt-5.5
# weak:    github-copilot/claude-haiku-4.5

bun model:set-strong github-copilot/claude-opus-4.7
# strong: github-copilot/gpt-5.5 → github-copilot/claude-opus-4.7

bun config:validate
# config válida
#   strong:  github-copilot/claude-opus-4.7
#   ...
```

Próxima sessão do opencode já pega o modelo novo via `loadJuninhoConfig()` (lib/j.juninho-config.ts).

### 16.4 Caso de uso — desligar criação de PR temporariamente

```bash
bun toggle unify.createPullRequest false
# workflow.unify.createPullRequest: true → false
```

O caminho curto (`unify.createPullRequest`) é expandido automaticamente para `workflow.unify.createPullRequest` quando a primeira parte é uma seção conhecida (`automation`, `implement`, `unify`, `documentation`).

### 16.5 Onde os scripts vivem

- **Definição:** `~/repos/package.json` (`scripts` block — zero deps, zero lockfile).
- **Implementação:** `~/repos/.opencode/cli/*.ts` — cada script é um arquivo TypeScript pequeno que importa tipos de `lib/j.juninho-config.ts` para garantir consistência com o runtime do harness.
- **Helper compartilhado:** `~/repos/.opencode/cli/_lib.ts` (read/write JSON, set/get nested paths, parse de valores).

### 16.6 Adicionar um novo script

1. Crie `~/repos/.opencode/cli/<nome>.ts` (use os existentes como template).
2. Adicione a entrada em `package.json` → `scripts`.
3. Documente nesta tabela.
4. Mantenha o critério: **1 script = 1 ação repetitiva**. Se virar canivete suíço, divida.

---

> **Nota final:** este workspace é deliberadamente minimalista no que versiona. O valor está no `.opencode/` (harness) e no `package.json` (CLI utilitário) — é o que torna repetível meu fluxo de desenvolvimento spec-driven com agentes. Tudo o resto (código de produto, builds, dependências) vive nos repositórios filhos.

---

## 17. Shell helpers compartilhados (multi-target / multi-stack)

Os scripts em `.opencode/scripts/` são desenhados para operar em **qualquer write target** do plano ativo (Node, Maven/Java, Terraform), sem que o agente precise saber qual stack está rodando. Três helpers tornam isso possível e ficam disponíveis para qualquer script novo:

### 17.1 `_resolve-repo.sh` — resolução de target repo

```bash
source "$(dirname "$0")/_resolve-repo.sh"
resolve_repo "$@"   # exporta WORKSPACE_ROOT, TARGET_REPO_ROOT, ROOT_DIR e faz `cd $ROOT_DIR`
```

- Aceita `--repo <path>` ou `--target <project>`; sem args, usa o write target atual do `active-plan.json`.
- Se o target resolvido for o próprio workspace (`~/repos`), exige `ALLOW_WORKSPACE_GIT=1` (proteção contra commit acidental no harness).
- Substitui o boilerplate de `git rev-parse` espalhado nos scripts antigos.

### 17.2 `_read-config.sh` — leitura tipada do `juninho-config.json`

```bash
source "$(dirname "$0")/_read-config.sh"
SKIP_LINT=$(config_get_workflow_bool   "implement.skipLintOnPrecommit" false)
SCOPE=$(config_get_workflow_string     "implement.preCommitScope"      "related")
```

- Funções `config_get_workflow_string` e `config_get_workflow_bool` aceitam dotted-path sob `workflow.*` + valor default obrigatório.
- Parser tenta `node` → `bun` → `python3` na ordem; falha silenciosa retorna o default (não quebra o script).
- Procura config em `TARGET_REPO_ROOT/.opencode/juninho-config.json` primeiro, caindo para `WORKSPACE_ROOT/.opencode/juninho-config.json`.

### 17.3 `_detect-stack.sh` — detecção de stack via FS markers

```bash
source "$(dirname "$0")/_detect-stack.sh"
case "$(detect_stack)" in
  maven)     "$(maven_runner)" -q -DskipTests verify ;;
  terraform) terraform fmt -check -recursive && terraform validate ;;
  node)      npx --no-install vitest run --changed ;;
  *)         echo "stack desconhecido — pulando"; exit 0 ;;
esac
```

- `detect_stack` ecoa `maven|terraform|node|unknown` baseado em markers no CWD: `pom.xml`/`mvnw` → `*.tf` → `package.json` → `unknown`.
- `maven_runner` retorna `./mvnw` se existir, senão `mvn`.
- `pom_has_plugin <artifactId>` faz match seguro em `pom.xml` (usado para detectar spotless/checkstyle).
- Honra `JUNINHO_FORCE_STACK=maven|terraform|node` para testes/CI.

### 17.4 Scripts já adaptados

`lint-structure.sh`, `test-related.sh`, `build-verify.sh`, `run-test-scope.sh`, `pre-commit.sh` e `check-all.sh` usam os três helpers acima. Adicionar suporte a uma nova stack (ex.: Gradle/Kotlin) é trivial: estende-se `detect_stack` + adiciona um `case` em cada script.

### 17.5 `harness-feature-integration.sh --all-targets`

O script de integração de feature aceita `--all-targets <action>` para rodar a mesma ação (`ensure`, `switch`, `cleanup`) em todos os write targets do plano ativo. Útil para preparar/limpar branches `feature/{slug}` em N repos com um comando só.
