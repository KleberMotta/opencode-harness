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
├── opencode.template.json  # template do runtime opencode (committed)
├── juninho-config.json     # source of truth: modelos, workflow toggles
├── opencode.json           # GERADO (não commitado) — `npm run sync`
├── .opencode/              # HARNESS JUNINHO — o coração deste workspace
│   ├── agents/             # subagentes especializados (markdown declarativo)
│   ├── cli/                # scripts TS do CLI utilitário (config, model, plan, state)
│   ├── commands/           # comandos /j.* expostos no CLI
│   ├── plugins/            # plugins runtime em TypeScript (hooks do opencode)
│   ├── lib/                # bibliotecas compartilhadas dos plugins
│   ├── scripts/            # shell scripts (check-all, pre-commit, activate-plan…)
│   ├── skills/             # SKILL.md da camada workspace (docs, shell, meta; as de convenção Kotlin vivem em {contexto}/agent-context/skills/)
│   ├── skill-map.json      # mapeia file pattern → skill
│   ├── state/              # estado de sessão (active-plan, persistent-context)
│   ├── templates/          # templates para artefatos (spec, CONTEXT, plan…)
│   ├── tools/              # custom tools (find_pattern, lsp_*, ast_grep_*, …)
│   ├── evals/              # baterias de eval (structural, behavioral)
│   └── hooks/              # shim do hook do workspace (symlinked em .git/hooks/)
├── docs/                   # documentação versionada do workspace
└── tmp/                    # rascunhos descartáveis (não versionado)
```

### Por que `.gitignore` usa allowlist?

```
# Ignore everything by default
/*

# Then unignore the allowed entries
!/.gitignore
!/AGENTS.md
!/opencode.template.json
!/juninho-config.json
!/.opencode
!/docs
/docs/specs
!/tmp
!README.md
!/package.json
!/.github

# Inside tmp/, ignore all contents (keep the folder via .gitkeep if desired)
/tmp/*
```

O padrão `/*` ignora **tudo** na raiz por padrão. As linhas `!` re-incluem apenas o que é meu (incluindo `.github/` para CI). Isto garante que clonar um projeto novo dentro de `~/repos/olxbr/` **nunca** vai aparecer como untracked aqui — cada projeto tem seu próprio git, e este workspace só rastreia o harness. Note que `docs/specs/` é ignorado — os artefatos de spec por feature não são versionados neste repo.

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

O `active-plan.json` centraliza os paths dos artefatos de spec no workspace root:
- **`planPath`/`specPath`/`contextPath`**: paths relativos ao workspace root (ex.: `docs/specs/{slug}/plan.md`)
- **`writeTargets`**: repos onde código será modificado (apenas `project` + `targetRepoRoot`).
- **`referenceProjects`**: repos lidos apenas para contexto/referência.

Um único `plan.md` unificado contém todas as tasks de todos os repos; não há duplicação per-target.

Exemplo real (`seller-creation-service`):

```json
{
  "slug": "seller-creation-service",
  "planPath": "docs/specs/seller-creation-service/plan.md",
  "specPath": "docs/specs/seller-creation-service/spec.md",
  "contextPath": "docs/specs/seller-creation-service/CONTEXT.md",
  "writeTargets": [
    { "project": "olxbr/trp-seller-api", "targetRepoRoot": "/Users/.../trp-seller-api" },
    { "project": "olxbr/trp-infra",      "targetRepoRoot": "/Users/.../trp-infra" }
  ],
  "referenceProjects": [
    { "project": "olxbr/trp-partner-api",   "reason": "Contrato de criação de seller; somente leitura." },
    { "project": "olxbr/trp-financial-api", "reason": "Padrão MessagingService/XB3; somente leitura." }
  ]
}
```

### 4.3 `/j.implement` — Execução do plano inteiro

Delega para `@j.implementer`, que roda o loop **READ → ACT → COMMIT** task a task, com **uma branch canônica `feature/{slug}`** por feature.

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
    │ 6. STATE: grava em                          │
    │    docs/specs/{slug}/state/tasks/task-N/    │
    │    - execution-state.md  (lease + status)   │
    │    - validator-work.md   (quando a task é   │
    │      de validação)                          │
    │    - retry-state.json                       │
    │    - runtime.json                           │
    └─────────────────────────────────────────────┘
```

**Validação NÃO é automática.** O implementer não invoca `@j.validator` após cada commit (regra `NO AUTO-VALIDATION` em `.opencode/agents/j.implementer.md`) — isso economiza tempo e tokens. Validação vem de tasks **explícitas** no `plan.md` com `- **Agent**: j.validator` (e `- **Agent**: j.test-writer` para trabalho concentrado de testes), colocadas pelo planner em pontos estratégicos. O `/j.implement` executa essas tasks como qualquer outra: quando a task declara um agent, o orchestrator spawna aquele agente em vez de um child `@j.implementer`.

Regras críticas:
- **1 commit por task** na branch `feature/{slug}`. Sem commits adicionais para state.
- Cada child session começa com **contexto limpo** — protege a janela de contexto do orchestrator.
- Estado fica isolado **por write target** quando o plano é multi-projeto.

### 4.3.1 Single Task Mode (`singleTaskMode: true`)

Quando `workflow.implement.singleTaskMode` está ativado, `/j.implement` muda de comportamento: em vez de executar o plano inteiro de uma vez, ele executa **uma task por invocação** e retorna ao developer com um relatório de progresso.

```
Developer roda /j.implement
        │
        ▼
┌──────────────────────────────────┐
│ 1. Identifica próxima task       │
│    pendente (wave order,         │
│    respeitando depends)          │
│                                  │
│ 2. Executa loop completo:        │
│    READ → ACT → COMMIT           │
│                                  │
│ 3. PARA e reporta:              │
│    - Task id + resumo            │
│    - Status (COMPLETE/FAILED)    │
│    - Commit SHA                  │
│    - Arquivos modificados        │
│    - Próxima task pendente       │
│    - Progresso: {N}/{total}      │
└──────────────────────────────────┘
        │
        ▼
Developer revisa ──► pede correções? ──► agente corrige
        │                                    │
        ▼                                    ▼
Developer roda /j.implement          Auto-Learning loop
(próxima task)                       (ver seção 4.8)
```

**Por que usar**: permite revisão humana granular entre tasks. Ideal para features complexas onde o developer quer validar padrões/abordagem antes que os erros se propaguem para tasks seguintes.

**Ativação**:
```json
{ "workflow": { "implement": { "singleTaskMode": true } } }
```

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
   │   adapta para maven, terraform ou node)
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

**Dependências locais (Maven/Spring):** quando o repo Maven tem `Makefile` com target `dependencies:`, testes Spring (`@SpringBootTest`/`@DataJpaTest`/`@WebMvcTest`) e o docker-compose down, o `check-all.sh` roda `make dependencies` automaticamente antes do `verify` e aguarda os containers subirem (até ~30s). Só falha — com instruções de fix — se os containers não subirem nem assim (veja `.opencode/scripts/check-all.sh` e os helpers `maven_dependencies_required`/`maven_compose_running` em `_detect-stack.sh`).

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
│ 4. Se cleanupIntegratedTaskBookkeeping:      │
│    cleanup de bookkeeping em                 │
│    integration-state.json                    │
│                                              │
│ 5. Se commitFeatureArtifacts: commit dos     │
│    arquivos de docs/specs/{slug}/state/**    │
│                                              │
│ 6. Se createPullRequest: gh pr create        │
│    (corpo rico se createDeliveryPrBody)      │
└──────────────────────────────────────────────┘
```

Pré-requisitos: `gh auth login` ok, todas as tasks `COMPLETE` (incluindo as tasks de validação do plano com `APPROVED`), `/j.check` passou.

### 4.8 Auto-Learning — Aprendizado contínuo do harness

O harness possui uma **diretriz canônica de auto-aprendizado** (definida em `AGENTS.md`). Sempre que o developer instrui correções a uma implementação feita pelo agente, um fluxo automático é disparado:

```
Developer pede correção
(ex.: "o nome do método deveria ser X",
 "esse padrão está errado, use Y")
        │
        ▼
┌──────────────────────────────────┐
│ 1. CORRIGIR: aplica a correção  │
│    solicitada                     │
│                                  │
│ 2. AUTO-AVALIAR: o que causou    │
│    o erro?                        │
│    - Skill insuficiente?         │
│    - AGENTS.md faltando regra?   │
│    - Domain doc incompleto?      │
│    - Principle doc ausente?      │
│    - find_pattern sem exemplo?   │
│                                  │
│ 3. PROPOR: apresenta ao dev     │
│    - Onde: arquivo exato         │
│    - O quê: regra/exemplo        │
│    - Por quê: previne recorrência│
│                                  │
│ 4. PERGUNTAR:                    │
│    "Deseja que eu atualize X     │
│     com essa regra?"             │
│                                  │
│ 5. AGIR ou PULAR:               │
│    Dev aprova → aplica update    │
│    Dev rejeita → segue em frente │
└──────────────────────────────────┘
```

**Regras do auto-learning:**
- Nunca atualiza harness/skills/docs sem aprovação explícita do developer
- Propostas são atômicas — uma preocupação por proposta
- Propostas devem ser concretas (arquivo exato + conteúdo exato), não sugestões vagas
- Artefatos da feature ativa (`plan.md`, `spec.md`, `CONTEXT.md`) são imutáveis durante implementação
- Aplica-se a **todos os agentes** que recebem feedback de correção, não só ao implementer

**Interação com singleTaskMode**: quando combinados, o fluxo natural é:
1. `/j.implement` → executa 1 task → para
2. Developer revisa → pede correções se necessário
3. Agente corrige + propõe auto-learning update
4. Developer aprova/rejeita updates ao harness
5. Developer roda `/j.implement` novamente → próxima task (que já se beneficia dos updates)

Este ciclo cria um loop de melhoria contínua onde cada task revisada torna o harness mais preciso.

---

## 5. `juninho-config.json` — toggles do workflow

Arquivo: `~/repos/juninho-config.json` (também procurado em projetos descendentes via `ancestorConfigCandidates`).

### 5.1 Modelos

Os modelos dos agentes são definidos em `juninho-config.json` (source of truth) sob `models.strong`, `models.medium`, `models.weak`. O `opencode.json` é **gerado automaticamente** a partir do template `opencode.template.json` + config.

**Setup inicial (uma vez após clone):**

```bash
bun install   # o prepare hook roda o sync (gera opencode.json) + `bun run setup`
```

O hook `prepare` do `package.json` executa duas coisas em sequência:
1. **Sync** (`bun run sync`) — gera `opencode.json` a partir de `opencode.template.json` + `juninho-config.json`.
2. **Guia de setup** (`bun run setup`) — um doctor pós-install que verifica tudo que o harness precisa nesta máquina: `opencode` no PATH, provider autenticado (`opencode auth`), `opencode.json` gerado, tiers de modelo completos, pre-commit hooks nos repos-alvo do plano ativo, docker rodando e (se habilitado) o CLI do graphify. Nunca falha — imprime o próximo passo exato para cada item pendente.

`bun run setup` pode ser re-rodado a qualquer momento para reconferir o ambiente.

**Trocar um modelo:**

```bash
npm run model:set -- strong github-copilot/claude-opus-4.7
npm run model:set -- medium github-copilot/gpt-5.4
npm run model:set -- weak github-copilot/claude-haiku-4.5

# Regenerar manualmente (se editou juninho-config.json na mão):
npm run sync

# Ver tiers atuais:
npm run model:list
```

Próxima sessão do opencode já usa o modelo novo.

> **Zero setup extra** — `bun install` é tudo. Sem env vars, sem direnv, sem wrappers.

### 5.2 Stack detection

O harness detecta a stack do projeto alvo automaticamente via filesystem markers (`_detect-stack.sh`):
- `pom.xml` ou `mvnw` → **maven** (Java/Kotlin)
- `*.tf` na raiz → **terraform**
- `package.json` → **node**
- Nenhum marker → **unknown** (skips gracefully)

Override: `JUNINHO_FORCE_STACK=maven|node|terraform|unknown`

> **Nota:** O campo `projectType` foi removido do config. Nenhum script usa-o em runtime — a detecção é sempre por FS markers.

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
| `singleTaskMode` | `false` | Em `true`, `/j.implement` executa **uma task por vez** e retorna ao developer para revisão antes de prosseguir (ver seção 4.3.1) |
| `enforcePlanScope` | `false` | Em `true`, o `j.intent-gate` **bloqueia** Write/Edit fora do escopo de Files do plano ativo (`tool.execute.before` lança); em `false`, só emite warnings pós-edit (ver "Loop engineering") |
| `maxCheckReentries` | `2` | Teto de reentradas check→implement; controlado pela linha `Reentry count:` do `check-review.md` — atingido o teto, o checker escala ao humano |

### 5.5 `workflow.unify`

| Chave | Default | O que faz |
|---|---|---|
| `enabled` | `true` | Liga/desliga `/j.unify` por completo |
| `updatePersistentContext` | `true` | Reconcilia `.opencode/state/persistent-context.md` |
| `updateDomainDocs` | `true` | Refresca `docs/domain/` por target |
| `updateDomainIndex` | `true` | Atualiza `docs/domain/INDEX.md` |
| `cleanupIntegratedTaskBookkeeping` | `true` | Marca cleanup do bookkeeping das tasks integradas |
| `commitDocUpdates` | `true` | Cria um commit gated com as atualizações de docs feitas pelo UNIFY (persistent-context/domain docs) |
| `refreshGraphify` | `false` no default, `true` aqui | No UNIFY, faz refresh incremental do grafo Graphify de cada target |
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
| `replicateSpecToTargetRepos` | `false` | Em `true`, copia `spec.md`/`plan.md`/`CONTEXT.md` para `docs/specs/{slug}/` dentro de cada write target |

### 5.7 Configuração ativa

```json
{
  "models": {
    "strong": "github-copilot/claude-opus-4.6",
    "medium": "github-copilot/claude-sonnet-4.6",
    "weak": "github-copilot/claude-haiku-4.5"
  },
  "workflow": {
    "automation": {
      "nonInteractive": false,
      "autoApproveArtifacts": false
    },
    "implement": {
      "preCommitScope": "related",
      "skipLintOnPrecommit": false,
      "skipTestOnPrecommit": false,
      "postImplementFullCheck": true,
      "reenterImplementOnFullCheckFailure": true,
      "watchdogSessionStale": false,
      "refreshExecutionHeartbeat": false,
      "singleTaskMode": true
    },
    "unify": {
      "enabled": true,
      "updatePersistentContext": true,
      "updateDomainDocs": true,
      "updateDomainIndex": true,
      "cleanupIntegratedTaskBookkeeping": true,
      "commitDocUpdates": true,
      "refreshGraphify": true,
      "commitFeatureArtifacts": false,
      "createPullRequest": false,
      "createDeliveryPrBody": false
    },
    "graphify": {
      "enabled": true,
      "outputDir": "docs/domain/graphify",
      "staleAfterDays": 7,
      "maxCacheMb": 100,
      "installMethod": "pipx"
    },
    "documentation": {
      "preferAgentsMdForLocalRules": true,
      "preferDomainDocsForBusinessBehavior": true,
      "preferPrincipleDocsForCrossCuttingTech": true,
      "syncMarkers": true,
      "replicateSpecToTargetRepos": false
    }
  }
}
```

A configuração local **desativou** PR automation (`createPullRequest`/`createDeliveryPrBody`) e watchdog/heartbeat — e **ativou** `singleTaskMode`, os doc updates do UNIFY (`updateDomainDocs`/`updateDomainIndex`/`commitDocUpdates`) e o Graphify (`graphify.enabled` + `refreshGraphify`) — porque o workflow atual é supervisionado: o developer revisa cada task individualmente e os PRs são abertos manualmente, mas docs e knowledge graph são mantidos frescos automaticamente no fechamento.

---

## 5.8 Pre-commit hook

### Arquitetura

```
TARGET REPO (ex: trp-seller-api/)
├── scripts/
│   └── pre-commit.sh          ← gerado por install-target-hooks.sh (stack-aware)
└── .git/hooks/
    └── pre-commit             ← symlink → ../../scripts/pre-commit.sh

WORKSPACE (~/repos/)
├── .opencode/scripts/
│   ├── install-target-hooks.sh   ← gera + instala hook em qualquer target repo
│   ├── pre-commit.sh             ← hook do próprio workspace
│   ├── lint-structure.sh         ← lint stack-aware (chamado pelo hook)
│   ├── build-verify.sh           ← build verification (chamado pelo hook)
│   └── test-related.sh           ← testes de arquivos alterados (chamado pelo hook)
└── .opencode/hooks/
    └── pre-commit             ← shim do workspace (.git/hooks/ symlinked aqui)
```

### O que o hook faz

O `scripts/pre-commit.sh` gerado no target repo:
1. Coleta staged files via `git diff --cached`
2. Localiza o workspace root (onde `.opencode/scripts/` vive)
3. Lê toggles do `juninho-config.json` (`skipLintOnPrecommit`, `skipTestOnPrecommit`)
4. Delega para os scripts do harness (`lint-structure.sh`, `build-verify.sh`, `test-related.sh`)
5. Esses scripts detectam a stack automaticamente via FS markers e executam os comandos apropriados

### Instalação

```bash
# Instalar hook em um target repo específico:
.opencode/scripts/install-target-hooks.sh --repo /path/to/target-repo

# O /j.finish-setup já chama isso automaticamente na Phase 6.
```

O `@j.implementer` verifica que `.git/hooks/pre-commit` existe antes de commitar. Se não existir, falha com instruções claras.

### Requisito para target repos

Todo target repo que participa do fluxo `/j.implement` **deve** ter:
- `scripts/pre-commit.sh` — gerado e commitado no repo
- `.git/hooks/pre-commit` — symlink local (não versionado, instalado por `install-target-hooks.sh`)

---

## 6. Roster de agentes

| Agente | Papel |
|---|---|
| `@j.spec-writer` | Entrevista 5-fases → `spec.md` + `CONTEXT.md` rico |
| `@j.planner` | Pipeline 3-fases (Metis/Prometheus/Momus) → `plan.md` + `CONTEXT.md` enriquecido |
| `@j.explore` | Read-only research no codebase. Spawn pelo planner Phase 1 |
| `@j.librarian` | Read-only research em docs externas (Context7, MCPs). Spawn pelo planner Phase 1 |
| `@j.plan-reviewer` | Gate de executabilidade do plano. Approval bias, ≤3 issues. Interno ao planner |
| `@j.implementer` | READ→ACT→COMMIT. Wave-based, 1 commit/task em `feature/{slug}`. Não auto-valida |
| `@j.validator` | Gate de validação via tasks explícitas `Agent: j.validator` no plano. BLOCK/FIX/NOTE/APPROVED. Pode corrigir FIX-tier diretamente |
| `@j.test-writer` | (Sonnet/medium) Escreve e conserta **apenas** testes unit/controller nas convenções da org (JUnit5, Mockito-Kotlin, AAA, `@MockitoBean`). Nunca toca código de produção — reporta bugs encontrados. Invocado via tasks `Agent: j.test-writer` colocadas pelo planner e executadas pelo fluxo do `/j.implement` |
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
| `j.graphify-inject` | First tool call | Injeta resumo do `GRAPH_REPORT.md` do Graphify no início de cada sessão (quando `graphify.enabled`) |
| `j.graphify-stale-warn` | tool.after | Avisa quando o output do Graphify está mais velho que `staleAfterDays` |

Os helpers compartilhados (`j.state-paths`, `j.feature-state-paths`, `j.workspace-paths`, `j.juninho-config`, `j.tool-compat`) ficam em `.opencode/lib/`.

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

> **Nota — skills nativas do opencode:** a partir do opencode ≥ 1.17 existe um mecanismo nativo de skills (tool `skill`, carregada sob demanda quando a descrição da skill dá match com a tarefa — modelo *pull*). O harness mantém o plugin `j.skill-inject` como camada de **enforcement** *push* por padrão de arquivo: a skill certa é injetada no momento em que o arquivo é tocado, sem depender do agente decidir carregá-la. Os dois mecanismos coexistem.

Família atual, por camada:

**No contexto `olxbr` (`olxbr/agent-context/skills/`):**

- **Padrões de escrita Kotlin/Spring (TRP):** `j.controller-writing`, `j.service-writing`, `j.repository-writing`, `j.entity-writing`, `j.dto-writing`, `j.mapper-writing`, `j.model-writing`, `j.exception-writing`, `j.configuration-writing`, `j.listener-writing`, `j.utility-writing`, `j.client-writing`, `j.api-client-writing`, `j.seller-domain-model-writing`, `j.migration-writing`
- **Tests:** `j.test-writing`

**No workspace (`.opencode/skills/`):**

- **Documentação:** `j.agents-md-writing`, `j.domain-doc-writing`, `j.principle-doc-writing`, `j.planning-artifact-writing`
- **Automação:** `j.shell-script-writing`
- **Meta:** `skill-creator` (cria/refina skills, define cenários de eval)

> As skills que vivem em `{contexto}/agent-context/skills/` **não são vistas pela tool nativa `skill` do opencode** (ela só descobre `.opencode/skills/`); o enforcement delas é feito pelo plugin `j.skill-inject`, que resolve `SKILL.md` com precedência projeto > contexto > workspace. Use `npm run skills:list` para ver as duas camadas.

Cada `SKILL.md` contém: quando aplicar, regras canônicas, exemplos do código real, anti-padrões e checklist.

---

## 9.1 Graphify — Knowledge Graph opcional

[Graphify](https://graphify.net) é uma ferramenta open-source que gera knowledge graphs a partir de código. O harness Juninho integra-o **opcionalmente** como camada de contexto para os agentes.

### Instalação

```bash
pipx install graphifyy       # instala o CLI `graphify` (installMethod padrão do harness)
graphify opencode install    # instala skill + plugin globais para o opencode
```

> `uv tool install graphifyy` também funciona se você já usa `uv` — o harness só precisa do binário `graphify` no PATH. O método declarado em `juninho-config.json` (`workflow.graphify.installMethod`) é `pipx`, e é o que o `bun run setup` sugere quando o CLI está ausente.

### Como funciona no harness

1. **Build**: `npm run graphify:build -- --repo <target-repo> --force` gera o grafo a partir do AST do código-fonte.
2. **Output canônico**: os artefatos ficam em `<target-repo>/docs/domain/graphify/`:
   - `graph.json` — grafo queryable (nós = classes/funções/conceitos, arestas = dependências/chamadas)
   - `GRAPH_REPORT.md` — relatório com god nodes, surprises e perguntas sugeridas
   - `graph.html` — visualização interativa
   - `cache/` — cache incremental
3. **Consulta pelos agentes**: via CLI no bash (não MCP):
   ```bash
   graphify query "what are the most coupled classes" --graph <target>/docs/domain/graphify/graph.json
   graphify path "ClassA" "ClassB" --graph <path>
   graphify explain "ClassName" --graph <path>
   ```
4. **Injeção automática**: o plugin `j.graphify-inject` injeta um resumo do `GRAPH_REPORT.md` na primeira tool call de cada sessão. O plugin `j.graphify-stale-warn` emite warnings quando o output está velho.

### Controle via config

Em `juninho-config.json` (estado atual deste workspace — **habilitado**, com `installMethod: pipx`):
```json
{
  "workflow": {
    "graphify": {
      "enabled": true,
      "outputDir": "docs/domain/graphify",
      "staleAfterDays": 7,
      "maxCacheMb": 100,
      "installMethod": "pipx"
    }
  }
}
```

- `enabled: false` (default) → nenhum build automático; smoke manual com `--force`
- `enabled: true` (**config atual**) → `/j.finish-setup` Phase 7 faz build; `/j.unify` faz refresh incremental quando `workflow.unify.refreshGraphify` também está ligado (está, neste workspace)

### Quando usar

| Situação | Usar? |
|----------|-------|
| Entender god nodes antes de refatorar | ✓ `graphify query` |
| Verificar acoplamento entre 2 classes | ✓ `graphify path` |
| Cross-domain edge review | ✓ `graphify explain` |
| Buscar uma definição exata de classe | ✗ use grep/LSP |
| Substituir leitura de código | ✗ Graphify é hint, não verdade |

### Skills relacionadas

- `graphify` (oficial) — instrui o assistente a rodar o pipeline `/graphify` completo
- `j.graphify-usage` — regras de uso seguro pelos agents internos do harness

---

## 10. Estado persistente

### 10.1 Estado global (`.opencode/state/`, **não versionado**)

| Arquivo | Conteúdo |
|---|---|
| `active-plan.json` | Ponteiro para o plano ativo (slug, planPath, specPath, contextPath, writeTargets, referenceProjects) |
| `execution-state.md` | Resumo de sessão global (objetivo ativo, plano, log de sessão) |
| `persistent-context.md` | Memória de longo prazo do projeto (atualizada pelo UNIFY) |

### 10.2 Estado por feature (`docs/specs/{slug}/state/`, versionado no **workspace root**)

| Arquivo | Conteúdo |
|---|---|
| `implementer-work.md` | Log append-only do implementer (decisões, retries, deviations) |
| `check-review.md` | Último relatório de `/j.check` + Reentry Contract |
| `check-all-output.txt` | Transcript bruto do `check-all.sh` |
| `functional-validation-plan.md` | Plano de validação funcional (gerado pela task final de validação colocada pelo planner no plano) |
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
`spec.md` + `CONTEXT.md` viram contratos verificáveis. O `@j.validator` — via tasks de validação explícitas no plano — valida o trabalho **contra a spec**, não contra "achismo". Code review (`@j.reviewer`) é multi-pass com critérios explícitos.

### 11.4 Multi-projeto nativo
Um único plano unificado (`docs/specs/{slug}/plan.md` no workspace root) pode abranger N repositórios (write targets) + M referências. O estado de toda a feature vive centralizado em `docs/specs/{slug}/state/` no workspace — branches consistentes (`feature/{slug}` em cada repo), e cleanups coordenados.

### 11.5 Forward-only history
Tasks `COMPLETE` nunca são reabertas — correções viram follow-up tasks. Histórico git fica linear, auditável, e cada commit tem contexto rastreável até a spec original.

### 11.6 Configurabilidade granular
Praticamente todo passo automatizado tem um toggle em `juninho-config.json`. Em ambientes manuais, desligo `createPullRequest` e gerencio PRs no GitHub. Em ambientes batch, ligo `nonInteractive` e `autoApproveArtifacts`.

### 11.7 Skills como documentação executável
Em vez de "documentação que ninguém lê", as skills são injetadas **exatamente quando** o agente toca um arquivo daquele padrão. Conhecimento de pattern vira lei aplicada — não sugestão ignorada.

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
- [ ] **Avaliar possibilidade de tornar comportamentos importantes que estão via prompt em plugins com hooks para ser mais determinístico** (ex.: `singleTaskMode` stop-after-one-task, auto-learning proposal trigger — hoje são instruções em markdown no agente, sem enforcement em código)
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
| `/j.patch <sha> <instrução>` | Edição cirúrgica de um commit histórico da feature branch via rebase interativo — com guards (SHA ancestral de HEAD, nunca trunk, worktree limpa) e branch de backup automática |
| `/j.check` | Quality gate completo + multi-pass review |
| `/j.lint` | Apenas o structure lint do pre-commit |
| `/j.test` | Apenas os testes change-scoped |
| `/j.sync-docs` | Refresca AGENTS, domain docs e principle docs a partir do código |
| `/j.finish-setup` | Bootstrap: gera `AGENTS.md` hierárquicos, popula `skill-map.json`, cria docs base — convenções medidas por `analyze-conventions.sh` |
| `/j.learn <falha>` | Auto-learning governado: 1 falha observada → mudança mínima em 1 superfície do harness, com change contract + gate de regressão + registro em `docs/harness-changes/` |
| `/j.pr-review` | Review advisory do diff atual da branch |
| `/j.status` | Resumo do `execution-state.md` |
| `/j.unify` | Fecha o loop (docs/cleanup/PR conforme config) |
| `/j.start-work <task>` | Inicializa sessão focada em uma task |
| `/j.handoff` | Gera doc de handoff para próxima sessão |
| `/j.ulw-loop` | Modo "máximo paralelismo" (uso especializado) |

---

## 14. Convenções

- **Specs:** `docs/specs/{feature-slug}/{spec.md, CONTEXT.md, plan.md, state/**}` — sempre no **workspace root**, nunca nos target repos (a menos que `replicateSpecToTargetRepos: true`)
- **Domain docs:** `docs/domain/{domain}/*.md`, indexados em `docs/domain/INDEX.md` — permanecem em cada target repo
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

Algumas operações repetitivas no `juninho-config.json` e no `state/` (trocar modelo dos agentes, ativar plano, inspecionar/limpar state) **não exigem uma sessão do opencode**. Pra essas, existe um CLI utilitário em TypeScript rodando direto no [Bun](https://bun.sh) — zero-deps, sem `node_modules`.

### 16.1 Pré-requisito

```bash
bun --version   # já vem instalado neste workspace
bun install     # prepare hook: sync (gera opencode.json) + guia de setup (necessário após clone)
```

O `prepare` roda `bun run sync` e em seguida `bun run setup` — o guia de configuração que verifica opencode no PATH, auth do provider, hooks de pre-commit, docker e graphify (ver seção 5.1). `bun run setup` pode ser re-rodado a qualquer momento.

> **Por que Bun?** Os plugins/lib/tools do harness já são TypeScript executados pelo opencode em runtime Bun. Reaproveitar o runtime mantém o `package.json` zero-deps.

### 16.2 Comandos disponíveis

Todos rodam a partir de `~/repos/`:

| Script | O que faz | Exemplo |
|--------|-----------|---------|
| `npm run sync` | Gera `opencode.json` a partir do template + config | `npm run sync` |
| `bun run setup` | Guia de configuração (doctor): verifica opencode/PATH, auth, hooks, docker, graphify — re-rodável a qualquer momento | `bun run setup` |
| `npm run model:list` | Mostra tiers atuais (strong/medium/weak) | `npm run model:list` |
| `npm run model:set -- <tier> <model>` | Atualiza tier no config e regenera opencode.json | `npm run model:set -- strong github-copilot/claude-opus-4.7` |
| `npm run config:show` | Imprime o `juninho-config.json` formatado | `npm run config:show` |
| `npm run config:validate` | Valida chaves desconhecidas + tipos básicos | `npm run config:validate` |
| `npm run toggle -- <key.path> <value>` | Edita qualquer toggle em `workflow.*` | `npm run toggle -- unify.createPullRequest true` |
| `npm run plan:active` | Mostra o plano ativo (writeTargets + referenceProjects) | `npm run plan:active` |
| `npm run plan:activate -- <project> <slug>` | Ativa um plano existente em um repo | `npm run plan:activate -- olxbr/trp-seller-api seller-creation-service` |
| `npm run plan:clear` | Remove o `state/active-plan.json` | `npm run plan:clear` |
| `npm run state:show` | Imprime `active-plan.json` + `execution-state.md` | `npm run state:show` |
| `npm run state:clear-task -- <slug> <task-id>` | Remove o diretório de state de uma task | `npm run state:clear-task -- seller-creation-service task-5` |
| `npm run skills:list` | Lista todas as skills + descrição | `npm run skills:list` |
| `npm run agents:list` | Lista todos os subagentes + descrição | `npm run agents:list` |
| `npm run hooks:install -- --repo <path>` | Gera `scripts/pre-commit.sh` + instala symlink no target repo | `npm run hooks:install -- --repo olxbr/trp-seller-api` |
| `bun run loop -- --slug <feature>` | Outer loop: reinvoca o opencode headless até a feature concluir, com guardas determinísticas (ver "Loop engineering") | `bun run loop -- --slug seller-creation-service` |

### 16.3 Caso de uso típico — trocar modelo strong

```bash
npm run model:set -- strong github-copilot/claude-opus-4.7
# ✓ juninho-config.json: models.strong = github-copilot/claude-opus-4.7
# ✓ opencode.json gerado (strong=github-copilot/claude-opus-4.7, medium=..., weak=...)
```

Próxima sessão do opencode já usa o modelo novo.

### 16.4 Caso de uso — desligar criação de PR temporariamente

```bash
npm run toggle -- unify.createPullRequest false
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
- Procura config em `TARGET_REPO_ROOT/juninho-config.json` primeiro, caindo para `WORKSPACE_ROOT/juninho-config.json`.

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

---

## Camada de contexto e knowledge base (OKF)

As pastas de 1º nível deste workspace (ex.: `olxbr/`) são **contextos**: agrupam repositórios que compartilham convenções, vocabulário e conhecimento de negócio. Cada contexto carrega seus ativos em `agent-context/`:

```
olxbr/
└── agent-context/
    ├── AGENTS.md          # regras do contexto, herdadas por todos os repos dele
    ├── skills/            # skills específicas do contexto
    ├── skill-map.json     # file pattern → skill, no escopo do contexto
    ├── lint-rules/        # regras de lint customizadas do contexto
    ├── references.json    # referências cross-repo do contexto
    └── knowledge/         # base de conhecimento em OKF
        ├── log.md         # log do bundle: promoções, revisões
        ├── drafts/        # status: draft — intenção, ainda não implementada
        ├── domains/       # status: consolidated — verdade de negócio implementada
        └── decisions/     # decisões registradas — verdade implementada
```

**Precedência: projeto > contexto > workspace.** O `AGENTS.md` do repo vence o do contexto, que vence o global (`~/repos/AGENTS.md`). O mesmo vale para skills e regras de lint — a camada mais específica ganha.

**OKF (formato olxbr-knowledge):** todo documento da knowledge base tem frontmatter `type`/`status`/`tags`. A regra de leitura vale para qualquer agente:

- `status: draft` (em `drafts/`) = **intenção não implementada** — nunca é fato; nenhum agente pode citar um draft como comportamento atual do sistema.
- `domains/` e `decisions/` (`status: consolidated`) = **verdade implementada** — podem ser citados como fato e usados como constraint.

**Fluxo draft → produção:**

1. Uma ideia é discutida e registrada como draft em `knowledge/drafts/` (trade-offs, alternativas, decisões preliminares).
2. `/j.spec --from <path-do-draft>` — o `@j.spec-writer` lê o draft, trata os trade-offs já discutidos como respostas de entrevista (menos perguntas) e **cita o conceito de origem** no `CONTEXT.md`.
3. `/j.plan` e `/j.implement` seguem o fluxo normal — a spec carrega a intenção do draft como trabalho novo, nunca como fato.
4. No `/j.unify`, se os artefatos da feature citam o draft, o harness **propõe** a promoção draft→consolidated (mover para `domains/` ou `decisions/`, flip do `status`, entrada no `log.md` do bundle) — sempre proposta aprovável pelo dev, nunca automática (gate: `workflow.unify.proposeKnowledgePromotion`).

---

## Loop engineering

O **outer loop** é o driver determinístico que reinvoca o opencode em modo headless até a feature concluir — sem um humano precisar digitar `/j.implement` → `/j.check` → … a cada rodada:

```bash
bun run loop -- --slug <feature>
```

A cada iteração o driver executa o próximo comando pendente do ciclo e lê os **sensores** persistidos em `docs/specs/{slug}/state/` para decidir se continua. As guardas são determinísticas:

| Guarda | Sinal | Efeito |
|---|---|---|
| Max iterations | nº de invocações ultrapassa o teto | para e escala ao humano |
| Stall | iteração termina sem novos commits/estado | para |
| Repetição de falha | mesmo `Failure fingerprint:` no `check-review.md` em duas rodadas seguidas | para (beco sem saída, não persistência) |
| Regressão | o conjunto de falhas cresce após uma rodada de fix | para e escala |
| Reentry cap | `Reentry count:` ≥ `workflow.implement.maxCheckReentries` | o checker instrui parada + escalonamento |

**Critério de parada é sempre por sensor** (verificação determinística), nunca por "confiança do modelo": o loop só termina com o check verde e o unify concluído, ou com escalonamento ao humano portando o evidence disponível (`check-review.md` com fingerprint history, `check-all-output.txt`). O loop nunca contorna gates — apenas reentra nos mesmos comandos que um developer rodaria.

### Evidence bundle e failure routing no `/j.check`

Além do `Reentry Contract` e do `## Loop State` (failure fingerprint + reentry count), o `@j.checker` anexa duas seções ao `check-review.md`, ambas construídas a partir de evidência que ele mesmo possui (`check-all-output.txt` + relatório persistido do reviewer): `## Evidence Bundle` — uma linha por check executado, incluindo o que ele **não** cobre — e `## Failure Routing` — cada falha classificada numa rota tipada (`FORMAT` → autofix no próximo commit; `INFRA` → instruções de ambiente, nunca reentry de código; `COVERAGE_GAP` → follow-up task com `Agent: j.test-writer`; `STYLE_RECURRENT` → candidata a regra detekt no `lint-rules/` do contexto; `UNKNOWN` → escalada). Nenhuma rota existe sem citar sua evidência (a linha exata do `check-all-output.txt` ou o `{file:line}` do finding), e o `Next action` do Reentry Contract é expresso por essas rotas — nunca prosa livre.

### Telemetria (`metrics.jsonl`)

O plugin `j.telemetry` escuta o bus de eventos do opencode e appenda uma linha JSONL por evento relevante — step-finish com custo/tokens, mensagens do assistant, criação/idle de sessão, arquivos editados, comandos executados — em `docs/specs/{slug}/state/metrics.jsonl` (fallback: `.opencode/state/metrics.jsonl` quando não há plano ativo com slug). É puramente observacional: nunca injeta contexto, nunca bloqueia, e eventos com shape inesperado são ignorados em silêncio. Gate: `workflow.telemetry.enabled` (default `true`), relido por mtime do config — desligar não exige restart.

### `enforcePlanScope` — scope guard bloqueante

`workflow.implement.enforcePlanScope` (default `false`) promove o `j.intent-gate` de advisory para bloqueante: um Write/Edit fora do escopo de Files do plano ativo é rejeitado em `tool.execute.before`, com instrução explícita de criar follow-up task, perguntar ao developer ou desligar o toggle. Paths de bookkeeping do workflow (`docs/specs/`, `.opencode/`, `AGENTS.md`) continuam graváveis mesmo sob enforcement. Em `false`, vale o comportamento clássico: warning pós-edit, sem bloqueio.

### `/j.learn` — auto-learning governado do harness

`/j.learn <falha observada>` transforma uma falha real do harness (correção do dev, finding recorrente do check, trace de sessão) em **uma** mudança mínima em **uma** superfície nomeada (agente, comando, plugin, script, skill, `skill-map.json`, `AGENTS.md` do contexto ou `lint-rules/`), sob um **change contract** escrito antes do apply: mecanismo da falha, evidência verbatim, efeito esperado, invariantes preservadas, eval falsificadora e rollback exato. A suite completa de evals é o **gate de regressão** — qualquer regressão rejeita a proposta (sem iterar "até passar"); aplicar exige aprovação humana explícita (superfícies de segurança exigem-na mesmo em `nonInteractive`); e o registro permanente vai para `docs/harness-changes/NNN-<slug>.md`. Sem evidência não há proposta; `--dry-run` roda tudo menos o apply.

### `analyze-conventions.sh` no `/j.finish-setup`

A Phase 3 do `/j.finish-setup` é *measure first*: `.opencode/scripts/analyze-conventions.sh <repo> --json` emite fatos determinísticos sobre o repo — indentação dominante, p95 de comprimento de linha, sufixos CamelCase de classe, distribuição de prefixos de commit, ratio teste/fonte, frameworks de teste e formatter/linter configurado — cada número acompanhado de `samples` reais (paths/linhas do próprio repo). Skills e `AGENTS.md` gerados só afirmam uma convenção como regra com ≥3 exemplos citados; campo omitido no JSON significa "sem evidência" e nunca é preenchido por palpite.
