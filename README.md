# Workspace `~/repos` — harness Juninho sobre opencode

Este repositório raiz é um **workspace**, não um produto. Ele versiona o harness; produtos vivem com Git próprio sob a árvore `contexts/`, ao lado de `.context/` versionados pelo repositório `contexts`.

O **harness Juninho** é uma camada de orquestração sobre o [opencode](https://opencode.ai) que transforma "chat com tools" num fluxo spec-driven. A tese tem quatro partes. **O agente principal nunca implementa**: ele delega para subagentes com responsabilidade única, cada um começando com contexto limpo. **O estado mora em disco**, não na janela de contexto — `docs/specs/{slug}/state/` sobrevive a compactação, reinício de sessão e ao próprio modelo. **Os gates são determinísticos**: quem decide se o código passa são shell scripts (`check-all.sh`, `pre-commit.sh`) e sensores em arquivo, nunca a confiança do modelo. **Os padrões vêm do contexto**: skills medidas do canon do time chegam por dois caminhos — por pattern de arquivo, no instante em que o agente toca o arquivo, e por declaração da própria task no plano, antes de ela escrever a primeira linha.

O fluxo canônico é `/j.spec` → `/j.plan` → `/j.implement` → `/j.check` → `/j.unify`. Cada passo produz artefatos em disco que o passo seguinte lê. Você aprova a spec e o plano; o resto é executado por subagentes sob gates. Com `singleTaskMode` ligado (o caso hoje), o `/j.implement` para depois de **uma** task para você revisar. Se quiser autonomia, `bun run loop -- --slug <feature>` reinvoca o opencode headless até acabar — com guardas que abortam em vez de insistir.

Este README é um guia de uso. A referência completa (comandos, CLI, config, diretórios, agentes, plugins) está no fim.

---

## Começando (5 minutos)

```bash
cd ~/repos
bun install
```

O hook `prepare` do `package.json` roda duas coisas em sequência:

1. **`bun .opencode/cli/sync-config.ts`** — gera o `opencode.json` (não versionado) a partir de `opencode.template.json` + `juninho-config.json`. É aqui que os tiers de modelo e as `references` dos contextos são materializados.
2. **`bun .opencode/cli/setup-guide.ts`** — o doctor. **Nunca falha** (sempre exit 0): imprime ✓/⚠/✗ e, para cada pendência, o comando exato de correção.

Rode `bun run setup` sempre que quiser reconferir. O que cada check significa:

| Check | Significa | Se falhar |
|---|---|---|
| `opencode no PATH` | binário encontrado via `command -v opencode` | instale (`curl -fsSL https://opencode.ai/install \| bash`) ou, se já existe em `~/.opencode/bin`, adicione ao profile: `export PATH="$HOME/.opencode/bin:$PATH"` — os evals behavioral também dependem disso |
| `opencode.json gerado` | o sync rodou | `bun run sync` |
| `modelos configurados` | `models.strong/medium/weak` presentes no `juninho-config.json` | `bun run model:list` / `bun run model:set -- <tier> <modelo>` |
| `provider autenticado` | `~/.local/share/opencode/auth.json` tem ao menos um provider | `opencode auth login` (github-copilot) |
| `pre-commit hook` | por repo-alvo do plano ativo: `.git/hooks/pre-commit` existe e o symlink não está pendurado | `bun run hooks:install -- --repo <path-do-repo>` |
| `docker rodando` | `docker info` responde | suba o Docker — repos Spring precisam de containers para os testes de integração (o `/j.check` tenta subir sozinho via `make dependencies`) |
| `contexto ok em contexts/{ctx}` | o contexto tem `skills/` e `knowledge/` | crie o que faltar |
| `references materializadas` | algum contexto tem `references.json` e o `opencode.json` tem o bloco `references` | `bun run sync` |

Sem plano ativo, o check de hooks vira um aviso — instale o hook em cada repo-alvo antes do primeiro `/j.implement`:

```bash
bun run hooks:install -- --repo /Users/kleber.motta/repos/contexts/trp/trp-seller-api
```

Isso gera `scripts/pre-commit.sh` **dentro** do repo-alvo (stack-aware, commitável) e instala o symlink `.git/hooks/pre-commit → ../../scripts/pre-commit.sh` (local, não versionado). O `@j.implementer` verifica que o hook existe antes de commitar e falha com instruções se não existir. É idempotente — pode re-rodar.

> Os scripts do `package.json` só chamam `bun`, então `npm run <script>` e `bun run <script>` são equivalentes. Este guia usa `bun run`.

---

## Uso diário — o caminho de ouro

Tudo abaixo roda dentro do TUI do opencode (`opencode` a partir de `~/repos`), exceto o que estiver marcado como shell.

### 0. (Opcional) Rascunhe na knowledge base

Se a feature ainda é ideia, escreva um draft no `.context/knowledge/drafts/` herdado mais próximo (TRP: `contexts/trp/.context/knowledge/drafts/`). Draft é **intenção, nunca fato**.

### 1. `/j.spec <feature>` — entrevista de descoberta

```
/j.spec reprocessar validação de identidade de seller recusada por qualidade de imagem
/j.spec --from contexts/trp/.context/knowledge/drafts/seller-identity-retry.md
```

Delega para `@j.spec-writer`, que primeiro spawna `@j.explore` para pré-pesquisa no código e depois conduz uma entrevista de 5 fases (Discovery → Requirements → Contract → Data → Review). Classifica os repos em **write targets** (onde o código muda) e **reference projects** (leitura só).

**Ele pergunta.** Na fase Review, apresenta a spec e **espera aprovação explícita** — nada é escrito antes disso (a menos que `workflow.automation.autoApproveArtifacts` seja `true`; é `false`).

**Artefatos** (no workspace root, nunca nos repos-alvo — salvo `replicateSpecToTargetRepos: true`, que é `false`):
- `docs/specs/{slug}/spec.md` — fonte da verdade do negócio
- `docs/specs/{slug}/CONTEXT.md` — **obrigatório**: achados dos exploradores, vocabulário, mapeamento de identificadores, contratos de integração, restrições, decisões, anti-padrões, arquivos-chave. É a memória durável que todos os agentes seguintes leem inteira.

### 2. `/j.plan <goal>` — planejamento em 3 fases

```
/j.plan implementar o reprocessamento de identidade conforme a spec de seller-identity-retry
```

Delega para `@j.planner`, que roda Metis (classifica intent, spawna `@j.explore` + `@j.librarian` em paralelo) → Prometheus (entrevista você proporcional à complexidade, enriquece o `CONTEXT.md`, escreve o `plan.md`) → Momus (loop com `@j.plan-reviewer` até OKAY; approval bias, ≤3 issues).

**Ele pergunta duas vezes**: na entrevista do Prometheus e na **aprovação explícita** do plano no fim.

**Artefatos:**
- `docs/specs/{slug}/plan.md` — um único plano unificado com todas as tasks de todos os repos (sem duplicação por target). Cada task declara `Files`, `depends`, `wave` e, quando aplicável, `Agent`.
- `docs/specs/{slug}/CONTEXT.md` — enriquecido
- `.opencode/state/active-plan.json` — o ponteiro que todo o resto lê:

```json
{
  "slug": "seller-identity-retry",
  "planPath": "docs/specs/seller-identity-retry/plan.md",
  "specPath": "docs/specs/seller-identity-retry/spec.md",
  "contextPath": "docs/specs/seller-identity-retry/CONTEXT.md",
  "writeTargets": [
    { "project": "trp-seller-api", "targetRepoRoot": "/Users/kleber.motta/repos/contexts/trp/trp-seller-api" }
  ],
  "referenceProjects": [
    { "project": "olxbr/trp-financial-api", "reason": "Canon de teste/client; somente leitura." }
  ]
}
```

**Validação não é automática.** O implementer não chama `@j.validator` sozinho. Se você quer validação, ela precisa estar no plano como task explícita com `- **Agent**: j.validator` (e `- **Agent**: j.test-writer` para trabalho concentrado de teste). O planner coloca essas tasks em pontos estratégicos; se o plano não tem nenhuma, peça na entrevista.

### 3. `/j.implement` — uma task por vez

```
/j.implement
```

Com `workflow.implement.singleTaskMode: true` (o valor **atual** deste workspace; o default do código é `false`), cada invocação:

1. identifica a próxima task pendente (ordem de wave, respeitando `depends`);
2. spawna um `@j.implementer` filho com contexto fresco e paths absolutos;
3. o filho lê `CONTEXT.md` inteiro + `spec.md` + `plan.md` + os arquivos da task, edita o código, escreve testes;
4. roda o pre-commit rápido (`lint-structure.sh` → `build-verify.sh` → `test-related.sh`);
5. faz **1 commit** na branch canônica `feature/{slug}` (só código/config — nada de state). Se já existe commit para essa task (tentativa interrompida), usa `git commit --amend` para manter exatamente um commit por task;
6. grava state em `docs/specs/{slug}/state/tasks/task-{id}/` (`execution-state.md`, `retry-state.json`, `runtime.json`) e o bookkeeping em `state/integration-state.json`;
7. **para** e reporta: task id, status, SHA do commit, arquivos, próxima task pendente, progresso `{N}/{total}`.

Você revisa e roda `/j.implement` de novo para a próxima. **Em `singleTaskMode` o `/j.check` NÃO roda a cada task** — o check completo (formatação + suíte inteira) é caro e pertence ao fim da feature.

Task cirúrgica, quando você quer só uma:

```
/j.implement-task seller-identity-retry/task3
/j.implement-task trp-seller-api:seller-identity-retry/task3
```

Se o `{project}` for omitido e a task existir em múltiplos write targets, o orchestrator **para e pergunta** — nunca chuta.

### 3-alt. `bun run loop` — autonomia (shell, fora do TUI)

```bash
bun run loop -- --slug seller-identity-retry
```

Driver determinístico: reinvoca `opencode run <comando>` até a feature fechar. Cada iteração lê os sensores em disco (`plan.md`, `integration-state.json`, `execution-state.md`, `check-review.md`), decide o próximo comando, executa e mede o efeito. Máquina de estados: task pendente → `/j.implement`; tudo completo e sem check → `/j.check`; check BLOCKED → reentrada; check GREEN → `/j.unify`.

| Flag | Default | O que faz |
|---|---|---|
| `--slug <feature>` | slug do `active-plan.json` | qual feature (erro claro se não houver plano ativo) |
| `--until implement\|check\|unify` | `unify` | até onde ir |
| `--max-iterations N` | `25` | teto de invocações |
| `--iteration-timeout-min N` | `30` | timeout por iteração (mata o filho) |
| `--dry-run` | — | imprime sensores + a decisão da iteração atual e sai, sem executar nem escrever state |

Comece por `--dry-run` para ver o que ele faria. Exit codes: **0** = done · **1** = erro de uso/ambiente · **2** = abortado por guarda (precisa de humano). A memória do driver fica em `docs/specs/{slug}/state/loop-state.json`.

### 4. `/j.check` — o gate completo

```
/j.check
```

Delega para `@j.checker`. Para cada write target: roda `.opencode/scripts/check-all.sh` (typecheck + lint + suíte inteira, adaptando-se a maven/terraform/node), lê o `CONTEXT.md` e o `functional-validation-plan.md` quando existe, e delega ao `@j.reviewer` um review multi-pass (correctness/bugs/edge cases → alinhamento com spec/plano/domínio → padrões do projeto, simplicidade, bloat).

**Artefatos** em `docs/specs/{slug}/state/`:
- `check-all-output.txt` — transcript bruto
- `check-review.md` — o relatório, com quatro seções que fecham o loop: `## Loop State` (`Verdict: GREEN|BLOCKED`, `Failure fingerprint:`, `Reentry count:`), `## Evidence Bundle` (uma linha por check executado, incluindo o que ele **não** cobre), `## Failure Routing` (cada falha numa rota tipada com evidência citada) e `## Reentry Contract` (paths exatos + próxima ação).

**Dependências locais (Maven/Spring):** quando o repo tem `Makefile` com target `dependencies:`, testes Spring e o docker-compose down, o `check-all.sh` roda `make dependencies` sozinho antes do `verify` e espera os containers subirem (polling de 2 em 2s, até ~30s). Só falha — com instruções de fix — se nem assim subirem.

**Regra forward-only:** se uma correção atinge uma task já `COMPLETE`, o harness cria uma **nova task de follow-up** em vez de reabrir a antiga. O histórico git fica linear.

### 5. `/j.unify` — fechamento

```
/j.unify
```

Delega para `@j.unify`, que lê `workflow.unify.*` e executa **apenas** os passos habilitados: reconcilia `plan.md` vs git diff (DONE/PARTIAL/SKIPPED), atualiza `persistent-context.md`, refresca `docs/domain/` + `INDEX.md`, faz cleanup do bookkeeping, e **propõe** promoção de drafts da knowledge base. Nesta config, `createPullRequest` e `createDeliveryPrBody` estão **desligados** — o PR você abre na mão.

Pré-requisitos: todas as tasks `COMPLETE` (incluindo as de validação, com `APPROVED`), `/j.check` verde e — se for ligar PR — `gh auth login`.

### Exemplo de ponta a ponta

Feature: reprocessar validação de identidade de seller recusada por qualidade de imagem, no `trp-seller-api`.

```bash
# shell, uma vez
cd ~/repos
bun run setup                                                   # tudo ✓?
bun run hooks:install -- --repo ~/repos/contexts/trp/trp-seller-api
opencode                                                        # abre o TUI
```

```
# no TUI
/j.spec reprocessar identidade de seller recusada por qualidade de imagem
    → entrevista 5 fases; você aprova
    → docs/specs/seller-identity-retry/spec.md + CONTEXT.md

/j.plan implementar o reprocessamento conforme a spec de seller-identity-retry
    → entrevista + review; você aprova
    → docs/specs/seller-identity-retry/plan.md  (ex.: 5 tasks, task5 com Agent: j.validator)
    → .opencode/state/active-plan.json  (writeTargets: [trp-seller-api])

/j.implement    → task1 COMPLETE · commit a1b2c3d em feature/seller-identity-retry · próxima: task2 · 1/5
                  [você revisa o diff]
/j.implement    → task2 COMPLETE · commit e4f5g6h · 2/5
/j.implement    → task3, task4 …
/j.implement    → task5 (j.validator) APPROVED · 5/5

/j.check        → check-all.sh + review multi-pass
                  → state/check-review.md  →  Verdict: GREEN

/j.unify        → plan vs diff reconciliado, docs atualizadas
                  → PR: abra manualmente (createPullRequest=false nesta config)
```

O mesmo, autônomo, depois do `/j.plan`:

```bash
bun run loop -- --slug seller-identity-retry --dry-run   # veja a decisão
bun run loop -- --slug seller-identity-retry             # implement→check→unify
```

---

## Quando algo dá errado

### `/j.check` voltou BLOCKED

O `check-review.md` já traz o diagnóstico tipado. Leia nesta ordem: `## Loop State` (o verdict e o `Reentry count`), `## Failure Routing` (o que fazer, por falha) e `## Reentry Contract` (a próxima ação, expressa pelas rotas — nunca prosa livre).

Rode `/j.implement` de novo: ele lê o `check-review.md` e reentra. O teto é `workflow.implement.maxCheckReentries` — **default `2`** (a chave está ausente do `juninho-config.json` local, então vale o default). Atingido o teto, o checker **escala para você** com a evidência em vez de continuar reentrando. Um `/j.check` re-rodado sozinho **não** consome reentrada — só conta quando houve um implement de verdade no meio.

### As sete rotas de falha

| Rota | Significa | O que acontece / o que você faz |
|---|---|---|
| `FORMAT` | formatação | autofix no próximo commit (o pre-commit já aplica `spotless:apply`); nada a fazer |
| `COMPILE` | não compila | reentrada na task dona do arquivo (o relatório nomeia task + arquivo) |
| `TEST_FAILURE` | teste quebrado | reentrada com diagnóstico comportamental (task + teste + arquivo) |
| `COVERAGE_GAP` | falta teste | vira **follow-up task** com `Agent: j.test-writer` — nunca reabre task completa |
| `INFRA` | ambiente | **você** repara: `make dependencies`, Docker de pé. Nunca é reentrada de código e **nunca consome** o cap de reentradas |
| `STYLE_RECURRENT` | mesmo padrão de estilo em ≥2 features | candidata a virar regra detekt no `lint-rules/` do contexto — o checker propõe |
| `UNKNOWN` | sem evidência citável | escala para você |

Toda rota cita a evidência (a linha exata do `check-all-output.txt` ou o `{file:line}` do finding). Sem evidência → `UNKNOWN`.

### O loop abortou (exit 2)

O driver aborta em vez de insistir. A razão fica em `loop-state.json` (`abortReason`) e é impressa no terminal:

| Guarda | Quando dispara | O que fazer |
|---|---|---|
| **STALL (implement)** | 2 iterações de `/j.implement` sem mudar nada no state | leia o diagnóstico com os statuses impressos; provavelmente task travada em pergunta ou contexto ruim |
| **STALL (check)** | 2 iterações de `/j.check` sem gerar `check-review.md` novo | o check está morrendo antes de escrever — veja `check-all-output.txt` |
| **Repetição** | mesmo `Failure fingerprint:` em duas **gerações distintas** do `check-review.md` | beco sem saída, não persistência: corrija à mão ou replaneje |
| **Regressão** | o nº de falhas **aumentou** após uma rodada de fix | o loop **imprime** (não executa) `git reset --hard <último validatedCommit>` — decida você |
| **Reentry cap** | `Reentry count` ≥ `maxCheckReentries` | escala com a evidência |
| **INFRA 2x** | duas rodadas 100% INFRA | ambiente quebrado: `make dependencies`, Docker, e re-rode o loop |
| **Max iterations** | passou de `--max-iterations` (25) | ninguém convergiu; investigue antes de aumentar o teto |
| **`/j.unify` falhou** | exit ≠ 0 no unify | unify não é retryável com segurança — investigue à mão |

Timeout por iteração (`--iteration-timeout-min`, default 30) mata o filho e registra `TIMEOUT` no `loop-state.json`.

### Preciso corrigir um commit que já está no histórico

```
/j.patch 2077218 mover SellerIdentityData para dentro de SellerEntityData.kt e deletar o arquivo separado
```

Edição cirúrgica de **um** commit da feature branch via rebase interativo. Guards que recusam antes de começar: SHA inexistente, SHA que não é ancestral de `HEAD`, SHA em trunk (`main`/`master`/`trunk`/`develop`), worktree suja, rebase/merge em andamento, PR já mergeado. Cria **branch de backup** (`backup/pre-patch-<sha>-<timestamp>`) antes de tocar em qualquer coisa e imprime o nome. Não auto-resolve conflito no replay (para e devolve o controle) e **não faz push** — imprime o `git push --force-with-lease` para você rodar.

Não use para: fix em vários commits (faça `git rebase -i` à mão), fix que deveria ser commit novo (só commite), ou commit em branch compartilhada (abra outro PR).

### Onde eu estou?

```
/j.status                  # tasks, progresso, blockers, SHAs validados — leitura direta de state, sem agente
/j.status <feature-slug>   # de uma feature específica
/j.handoff                 # doc de handoff: feito / em progresso / bloqueado / próximo passo exato
```

Fora do TUI:

```bash
bun run state:show                                          # active-plan.json + execution-state.md
bun run plan:active                                         # writeTargets + referenceProjects
bun run state:clear-task -- seller-identity-retry task-3     # zera o state de uma task
```

### O plano ativo está errado / apontando para outra feature

```
/j.activate-plan /Users/kleber.motta/repos/contexts/trp/trp-seller-api/docs/specs/{slug}/plan.md
```
```bash
bun run plan:activate -- contexts/trp/trp-seller-api seller-identity-retry
bun run plan:clear
```

---

## Contextos hierárquicos — como os padrões são garantidos

Qualquer pasta agrupadora sob `contexts/` pode conter `.context/` e repos irmãos. Um repo herda o `.context` mais próximo e todos os ancestrais. Assim, `contexts/olxbr/.context` pode definir canon organizacional opcional e `contexts/olxbr/trp/.context` especializá-lo para o time.

**Precedência: evidência e padrões do repo > `.context` mais próximo > `.context` ancestrais > workspace.** Divergência pequena segue canon; divergência forte exige esclarecimento e documentação local no repo.

A cadeia que faz o código sair no padrão, do mais suave ao mais duro:

| Elo | Onde | O que garante |
|---|---|---|
| **Skills medidas** | `.context/skills/` | como escrever cada tipo de arquivo e tecnologia. Skills maduras têm `SKILL.md`, `SYSTEM.md` e `GOTCHAS.md` |
| **skill-map por pattern** | `.context/skill-map.json` | pattern de path → skill, com nearest `.context` vencendo ancestrais |
| **AGENTS.md do contexto** | `.context/AGENTS.md` | regras transversais herdadas |
| **AGENTS.md hierárquicos** | `~/repos/AGENTS.md` → `{repo}/AGENTS.md` → `{repo}/src/.../AGENTS.md` | o plugin `j.directory-agents-injector` empilha do root até a pasta do arquivo, a cada Read |
| **references** | `.context/references.json` | references materializadas recursivamente por `bun run sync` |
| **ktfmt/spotless no pre-commit** | hook gerado nos repos-alvo | com `workflow.implement.autoFixFormatOnCommit` (default **`true`**), o hook roda `spotless:apply` nos arquivos staged (ktfmt) antes do commit; o `lint-structure.sh` roda `spotless:check` quando o `pom.xml` tem o `spotless-maven-plugin`. Arquivos **parcialmente staged** são pulados pelo autofix — o hook avisa, e o CI pode reprovar |
| **detekt custom** | `.context/lint-rules/` | o nearest contexto com lint-rules fornece o gate |
| **autoImprove** | `workflow.implement.autoImprove` | após cada task commit, `j.auto-improver` compara o diff com padrões locais/canon, atualiza e commita contexto quando necessário, ou reabre a mesma task para amend |
| **validator / reviewer** | tasks `Agent: j.validator` no plano; `@j.reviewer` no `/j.check` | validação semântica contra a spec e review multi-pass |

### Atenção: o detekt custom está inativo nesta máquina

O `lint-structure.sh` só roda o detekt quando **três** condições valem ao mesmo tempo: existe `lint-rules/rules.jar`, existe `lint-rules/detekt.yml` **e** o CLI `detekt` está no PATH. Hoje o `detekt.yml` existe, mas o **`rules.jar` não** (é buildado, e `build/` é gitignored) e o **`detekt` não está no PATH** — ou seja, a regra `NoMockBean` não está bloqueando nada. Sem as três, o script segue em silêncio para o spotless. Para ativar:

```bash
brew install detekt                            # CLI no PATH
cd ~/repos/contexts/trp/.context/lint-rules
gradle build && cp build/libs/rules.jar ./rules.jar
```

### Como estender

**Auditar cobertura de skill num repo** (mecânico — usa a mesma resolução que o plugin faz em runtime, então os números são os que o agente realmente recebe):

```bash
bun run skills:coverage -- --repo ~/repos/contexts/trp/trp-seller-api
bun run skills:coverage -- --repo ~/repos/contexts/trp/trp-seller-api --json
```

Ele lista os arquivos `.kt`/`.java` que casam com algum pattern, os que o agente escreveria **às cegas**, e os clusters sem cobertura — a fila de trabalho para skills novas.

**Transformar uma falha real em regra** — `/j.learn`:

```
/j.learn o implementer criou DTO com data class mutável de novo; dev corrigiu no PR #91 (diff anexo)
/j.learn --dry-run <falha>
```

Governado: **1 falha observada → 1 mudança mínima em 1 superfície** (agente, comando, plugin, script, skill, `skill-map.json`, `AGENTS.md` do contexto ou `lint-rules/`), sob change contract escrito antes do apply (mecanismo, evidência verbatim, efeito esperado, invariantes, eval falsificadora, rollback exato). Recusa sem evidência concreta, com mais de um mecanismo de raiz, com mais de uma superfície, com worktree suja nos arquivos alvo, ou se a mudança não for falsificável. A suíte de evals é o **gate de regressão**; aplicar exige sua aprovação explícita; o registro fica em `docs/harness-changes/NNN-<slug>.md`.

**Bootstrap de repo novo** — `/j.finish-setup`: escaneia a estrutura (via `@j.explore`), gera `AGENTS.md` hierárquicos, descobre patterns e gera skills, popula docs e instala o pre-commit hook (Phase 6). A Phase 3 é *measure first*: `.opencode/scripts/analyze-conventions.sh <repo> --json` emite fatos determinísticos (indentação dominante, p95 de comprimento de linha, sufixos de classe, prefixos de commit, ratio teste/fonte, frameworks, formatter/linter), cada número com `samples` reais. **Uma convenção só vira regra com ≥3 exemplos citados**; menos que isso vira `[tentative]`, e campo ausente no JSON significa "sem evidência" — nunca é preenchido por palpite.

---

## Knowledge base (OKF)

`.context/knowledge/` é a base de conhecimento de negócio no formato **OKF** (markdown + frontmatter YAML). A regra de leitura vale para **todo** agente:

| Pasta | `status` | Significa |
|---|---|---|
| `drafts/` | `draft` | **intenção não implementada** — nunca é fato; nenhum agente pode citar um draft como comportamento atual do sistema |
| `domains/` | `consolidated` | **verdade implementada** — pode ser citada como fato e usada como constraint |
| `decisions/` | `consolidated` | decisões registradas com contexto e consequências — verdade implementada |

Estrutura: `index.md` (índice curado), `log.md` (log de promoções/revisões), `drafts/TEMPLATE.md` (ponto de partida).

**Como o time escreve:** uma ideia discutida vira draft (trade-offs, alternativas, decisões preliminares) a partir do `TEMPLATE.md`. Enquanto for draft, é proposta.

**Como vira spec:**

```
/j.spec --from contexts/trp/.context/knowledge/drafts/seller-identity-retry.md
```

O `@j.spec-writer` lê o draft, trata os trade-offs já discutidos como respostas de entrevista (menos perguntas) e **cita o conceito de origem** no `CONTEXT.md`. `/j.plan` e `/j.implement` seguem normalmente — a spec carrega a intenção do draft como **trabalho novo**, nunca como fato.

**Promoção no unify:** se os artefatos da feature citam um path com `/knowledge/drafts/`, o `@j.unify` **propõe** a promoção — mover para `domains/` (conceito de negócio) ou `decisions/` (decisão), virar o frontmatter para `status: consolidated` e registrar no `log.md` (data, documento, slug, motivo em uma linha). Gate: `workflow.unify.proposeKnowledgePromotion` (default **`true`**). É sempre proposta aprovável por você — nunca automática — e é pulada quando `workflow.automation.nonInteractive` é `true` (não há quem aprove).

---

## Referência

### Comandos `/j.*`

| Comando | O que faz |
|---|---|
| `/j.spec <feature>` · `/j.spec --from <draft> [nome]` | Entrevista 5 fases → `spec.md` + `CONTEXT.md` (aprovação sua) |
| `/j.plan <goal>` | Planner 3 fases (Metis/Prometheus/Momus) → `plan.md` + `active-plan.json` (aprovação sua) |
| `/j.activate-plan <repo\|plan-path>` | Repõe o `active-plan.json` apontando para outra feature |
| `/j.implement` | Executa o plano ativo (1 task por invocação quando `singleTaskMode`) |
| `/j.implement-task [proj:]<slug>/task<id>` | Executa exatamente uma task, em um único write target |
| `/j.check` | Gate completo: `check-all.sh` + review multi-pass → `check-review.md` |
| `/j.unify` | Fecha o loop conforme `workflow.unify.*` |
| `/j.patch <sha> <instrução>` | Edita cirurgicamente um commit histórico da feature branch (guards + branch de backup, sem push) |
| `/j.learn <falha>` | Auto-learning governado: 1 falha → 1 mudança mínima + change contract + gate de regressão |
| `/j.finish-setup` | Bootstrap de repo: `AGENTS.md`, skills, docs, hook — convenções medidas |
| `/j.status [slug]` | Tasks, progresso, blockers, SHAs (leitura direta de state) |
| `/j.handoff` | Doc de handoff para a próxima sessão |
| `/j.lint [repo]` | Só o structure lint do pre-commit |
| `/j.test [repo] [pattern]` | Só os testes change-scoped |
| `/j.pr-review` | Review advisory do diff atual da branch |
| `/j.sync-docs` | Refresca `AGENTS.md`, domain docs e principle docs a partir do código |
| `/j.start-work <task>` | Inicializa sessão focada numa task |
| `/j.ulw-loop` | Modo "máximo paralelismo" (uso especializado) |

Os `/j.*` **delegam para subagentes** — o orchestrator nunca executa o trabalho.

### CLI (`bun run <script>`, a partir de `~/repos`)

| Script | O que faz |
|---|---|
| `bun install` | `prepare`: sync + setup guide |
| `bun run setup` | Doctor do ambiente (re-rodável, nunca falha) |
| `bun run sync` | Gera `opencode.json` do template + config |
| `bun run model:list` | Tiers atuais |
| `bun run model:set -- <tier> <model>` | Atualiza o tier **e** regenera o `opencode.json` |
| `bun run config:show` | Imprime o `juninho-config.json` |
| `bun run config:validate` | Valida chaves desconhecidas + tipos |
| `bun run toggle -- <key.path> <value>` | Edita um toggle (ver nota abaixo) |
| `bun run plan:active` · `plan:activate -- <project> <slug>` · `plan:clear` | Plano ativo |
| `bun run state:show` · `state:clear-task -- <slug> <task-id>` | Estado |
| `bun run skills:list` · `agents:list` | Inventário (skills: as duas camadas) |
| `bun run skills:coverage -- --repo <path> [--json]` | Auditoria mecânica de cobertura de skill |
| `bun run hooks:install -- --repo <path>` | Gera `scripts/pre-commit.sh` + symlink no repo-alvo |
| `bun run loop -- --slug <feature> [flags]` | Outer loop headless |
| `bun run eval` | Suíte determinística (structural + hooks + context + state) |
| `bun run eval:behavioral` | Smoke behavioral (precisa de `opencode` no PATH) |

> **Nota do `toggle`:** o atalho só expande para `workflow.*` quando a primeira parte é `automation`, `implement`, `unify` ou `documentation`. Para `telemetry` use o caminho completo: `bun run toggle -- workflow.telemetry.enabled false`. O `toggle` **não** regenera o `opencode.json` (só o `model:set` faz) — se mexer em `models`, rode `bun run sync`.

Rodar a suíte:

```bash
cd ~/repos && TMPDIR=~/repos/tmp bun run eval
```

### `juninho-config.json` — defaults reais e valor atual

Fonte da verdade: `DEFAULT_CONFIG` em `.opencode/lib/j.juninho-config.ts`. O arquivo local sobrescreve por seção (merge raso por seção); chave ausente = default do código.

**`workflow.automation`**

| Chave | Default | Aqui | O que faz |
|---|---|---|---|
| `nonInteractive` | `false` | = | Em `true`, agentes não perguntam — assumem decisões padrão |
| `autoApproveArtifacts` | `false` | = | Em `true`, planner/spec-writer não pedem aprovação antes de escrever |
| `idleNotifications` | `true` | = (ausente) | Notificação local em sessão parada (`j.notify`) |
| `idleNotificationsOnlyWhenBackground` | `true` | = (ausente) | No macOS, notifica somente se o terminal do OpenCode não estiver em foco |
| `idleNotificationsSilent` | `false` | `true` | Em `true`, envia a notificação sem som; tem prioridade sobre `idleNotificationSound` |
| `idleNotificationSound` | `"Glass"` | `"Glass"` | Som nativo do macOS quando a notificação não é silenciosa, por exemplo `"Glass"` ou `"Ping"` |

**`workflow.implement`**

| Chave | Default | Aqui | O que faz |
|---|---|---|---|
| `preCommitScope` | `"related"` | = | `related` (só testes dos arquivos staged) ou `full` |
| `skipLintOnPrecommit` | `false` | = | Em `true`, o pre-commit pula o `lint-structure.sh` |
| `skipTestOnPrecommit` | `false` | = | Em `true`, o pre-commit pula o `test-related.sh` |
| `postImplementFullCheck` | `true` | = | Ao fim do plano (não de cada task), dispara `/j.check` |
| `reenterImplementOnFullCheckFailure` | `true` | = | Check falhou → reentra no `/j.implement` com o `check-review.md` |
| `maxCheckReentries` | `2` | = (ausente) | Teto de reentradas check→implement; atingido, o checker escala |
| `autoFixFormatOnCommit` | `true` | = (ausente) | Hook aplica `spotless:apply`/`prettier` nos arquivos staged |
| `enforcePlanScope` | `false` | = (ausente) | Em `true`, o `j.intent-gate` **bloqueia** Write/Edit fora do escopo de `Files` do plano (em `tool.execute.before`); paths de bookkeeping (`docs/specs/`, `.opencode/`, `AGENTS.md`) seguem graváveis. Em `false`, só warning pós-edit |
| `watchdogSessionStale` | `true` | **`false`** | Monitora sessões de child implementer; pode disparar 1 retry |
| `refreshExecutionHeartbeat` | `false` | = | Reescreve periodicamente o `execution-state.md` para sinalizar vida |
| `singleTaskMode` | `false` | **`true`** | 1 task por invocação do `/j.implement`, com report e parada |
| `autoImprove` | `false` | **`true`** | Audita cada commit de task contra canon/local patterns; canon vai para `contexts`, harness fica sem commit e código volta por amend quando necessário |

**`workflow.unify`**

| Chave | Default | Aqui | O que faz |
|---|---|---|---|
| `enabled` | `true` | = | Liga/desliga o `/j.unify` |
| `updatePersistentContext` | `true` | = | Reconcilia o `persistent-context.md` |
| `updateDomainDocs` · `updateDomainIndex` | `true` | = | Refresca `docs/domain/` e o `INDEX.md` por target |
| `cleanupIntegratedTaskBookkeeping` | `true` | = | Cleanup do bookkeeping das tasks integradas |
| `commitDocUpdates` | `true` | = | Commit gated das docs atualizadas pelo unify |
| `commitFeatureArtifacts` | `false` | = | Commit opcional de `docs/specs/{slug}/state/**` |
| `createPullRequest` | `true` | **`false`** | `gh pr create` |
| `createDeliveryPrBody` | `true` | **`false`** | Corpo de PR rico (purpose/problem/solution/changes/validation) |
| `proposeKnowledgePromotion` | `true` | = (ausente) | Propõe promoção draft → consolidated |

**`workflow.telemetry`**

| Chave | Default | Aqui | O que faz |
|---|---|---|---|
| `enabled` | `true` | = (ausente) | `j.telemetry` appenda JSONL por evento (custo/tokens, mensagens, sessões, edits, comandos) em `docs/specs/{slug}/state/metrics.jsonl` (fallback `.opencode/state/metrics.jsonl`). Observacional: nunca injeta contexto, nunca bloqueia. Relido por mtime — desligar não exige restart |

**`workflow.documentation`**

| Chave | Default | Aqui | O que faz |
|---|---|---|---|
| `preferAgentsMdForLocalRules` | `true` | = | Regra de pasta vai no `AGENTS.md` daquela pasta |
| `preferDomainDocsForBusinessBehavior` | `true` | = | Comportamento de negócio em `docs/domain/` |
| `preferPrincipleDocsForCrossCuttingTech` | `true` | = | Regra técnica transversal em `docs/principles/` |
| `syncMarkers` | `true` | = | `<!-- juninho:sync source=… hash=… -->` para detectar drift doc↔código |
| `replicateSpecToTargetRepos` | `false` | = | Em `true`, copia spec/plan/CONTEXT para dentro de cada write target |

Modelos (`models.strong/medium/weak`) vivem no mesmo arquivo e são materializados no `opencode.json` pelo sync. Hoje: `github-copilot/claude-opus-4.6` / `claude-sonnet-4.6` / `claude-haiku-4.5`.

### Mapa de diretórios

```
~/repos/
├── AGENTS.md                # contrato global de agentes (inclui a diretriz de auto-learning)
├── juninho-config.json      # source of truth: modelos + toggles de workflow
├── opencode.template.json   # template do runtime (versionado)
├── opencode.json            # GERADO por `bun run sync` (não versionado)
├── package.json             # CLI utilitário (zero-deps, roda em Bun)
├── .opencode/
│   ├── agents/              # subagentes (markdown declarativo)
│   ├── commands/            # comandos /j.*
│   ├── cli/                 # scripts TS do CLI (+ _lib.ts)
│   ├── lib/                 # libs compartilhadas (config, skill-map, state paths)
│   ├── plugins/             # plugins runtime (hooks do opencode)
│   ├── scripts/             # shell: check-all, pre-commit, lint, test, detect-stack…
│   ├── skills/              # skills da camada workspace
│   ├── skill-map.json       # pattern → skill (camada workspace)
│   ├── state/               # active-plan.json, execution-state.md, persistent-context.md
│   ├── templates/ · tools/ · evals/ · hooks/
├── docs/
│   ├── specs/{slug}/        # spec.md, CONTEXT.md, plan.md, state/**  (GITIGNORED)
│   ├── domain/ · principles/ · harness-changes/ · reports/
├── contexts/                # repo Git dos .context; produtos são ignorados
│   └── trp/
│       ├── .context/        # AGENTS, skills, knowledge, lint-rules
│       ├── trp-seller-api/  # Git de produto
│       └── trp-financial-api/
└── tmp/                     # rascunhos descartáveis
```

**Estado global** (`.opencode/state/`, não versionado): `active-plan.json` (ponteiro do plano ativo), `execution-state.md` (resumo de sessão), `persistent-context.md` (memória de longo prazo, atualizada pelo unify).

**Estado por feature** (`docs/specs/{slug}/state/`, no workspace root — e **gitignored** aqui): `implementer-work.md` (log append-only), `check-review.md`, `check-all-output.txt`, `functional-validation-plan.md`, `integration-state.json` (manifesto task → commit validado), `loop-state.json`, `metrics.jsonl`, `tasks/task-{id}/{execution-state.md,validator-work.md,retry-state.json,runtime.json,auto-improve-*}`, `sessions/{sessionID}-runtime.json`.

### Agentes

| Agente | Papel |
|---|---|
| `@j.spec-writer` | Entrevista 5 fases → `spec.md` + `CONTEXT.md`. Write só em `docs/specs/` |
| `@j.planner` | Pipeline 3 fases → `plan.md` + `CONTEXT.md` enriquecido |
| `@j.explore` | Research read-only no código. Spawn pelo planner (Phase 1) e pelo finish-setup |
| `@j.librarian` | Research read-only em docs externas. Spawn pelo planner (Phase 1) |
| `@j.plan-reviewer` | Gate de executabilidade do plano (approval bias, ≤3 issues). Interno ao planner |
| `@j.implementer` | READ→ACT→COMMIT, 1 commit/task em `feature/{slug}`. Não auto-valida |
| `@j.auto-improver` | Gate opcional pós-commit: audita canon/padrões, commita contexto, deixa harness sem commit e exige amend da mesma task quando necessário |
| `@j.validator` | Juiz semântico: lê a spec **antes** do código. BLOCK/FIX/NOTE/APPROVED; corrige FIX-tier direto. Só via task `Agent: j.validator` |
| `@j.test-writer` | Escreve/conserta **apenas** testes nas convenções da org. Nunca toca produção — reporta bugs. Só via task `Agent: j.test-writer` |
| `@j.checker` | Orquestra o `check-all.sh` + delega review; escreve o `check-review.md` |
| `@j.reviewer` | Review multi-pass read-only (correctness/intent/patterns) |
| `@j.unify` | Fecha o loop conforme `workflow.unify.*` |

`j.plan` e `j.spec` também existem como entrypoints `primary` (selecionáveis por tab), delegando para `@j.planner` e `@j.spec-writer`.

### Plugins runtime (`.opencode/plugins/`)

| Plugin | Hook | Função |
|---|---|---|
| `j.directory-agents-injector` | Read | Empilha todo `AGENTS.md` da árvore (root → arquivo) |
| `j.env-protection` | tool.before | Bloqueia leitura/escrita de `.env`, `*.pem`, `id_rsa`, `*.key`, "secret"/"credential" |
| `j.auto-format` | Write/Edit | prettier/black/gofmt/rustfmt conforme extensão |
| `j.plan-autoload` | chat.message + compaction + Read | Injeta o plano ativo nas child sessions (só a seção `## Task {id}` quando a sessão é task-scoped) **e** a `SKILL.md` de cada skill declarada na linha `- **Skills**:` da task |
| `j.carl-inject` | Read + compaction | Injeta princípios + domain docs por content match |
| `j.skill-inject` | Read/Write | Injeta skill local, nearest `.context`, contextos ancestrais e workspace |
| `j.task-runtime` | Task spawn + session created | Persiste runtime/lease/heartbeat |
| `j.auto-improve` | task completion | Agenda auditoria de canon por task quando `autoImprove` está ativo |
| `j.auto-improve-guard` | Write/Edit | Impede o auditor de editar código de produto diretamente |
| `j.task-board` | tool.after + compaction | Board por task no state da feature |
| `j.intent-gate` | Write/Edit | Warning (ou bloqueio, se `enforcePlanScope`) fora do escopo do plano |
| `j.todo-enforcer` | Write/Edit + compaction | Re-injeta tasks pendentes |
| `j.memory` | 1ª tool call + compaction | Injeta o `persistent-context.md` |
| `j.comment-checker` | Write/Edit | Flagga comentários óbvios |
| `j.notify` | session idle | Notificação local (gate: `automation.idleNotifications`) |
| `j.telemetry` | event bus | JSONL observacional (gate: `telemetry.enabled`) |

Helpers compartilhados em `.opencode/lib/`: `j.juninho-config`, `j.skill-map`, `j.state-paths`, `j.feature-state-paths`, `j.workspace-paths`, `j.tool-compat`.

### Custom tools (`.opencode/tools/`)

`find_pattern` (exemplo canônico curado por tipo de pattern) · `next_version` (próximo nome de migration/schema) · `lsp_diagnostics` · `lsp_goto_definition` · `lsp_find_references` · `lsp_prepare_rename` · `lsp_rename` · `lsp_workspace_symbols` / `lsp_document_symbols` · `ast_grep_search` · `ast_grep_replace` (com `dryRun`).

### Skills

Skills são pacotes de conhecimento **dirigidos por pattern de arquivo**: quando você lê/escreve um arquivo cujo path casa uma entrada do skill-map, a `SKILL.md` correspondente é injetada. Cada uma traz quando aplicar, regras canônicas, exemplos do código real, anti-padrões e checklist.

- **Contexto TRP** (`contexts/trp/.context/skills/`): skills específicas como `j.spring-test-writing`, `j.spring-domain-service-writing`, `j.spring-jpa-entity-writing`, `j.spring-feign-client-writing`, `j.flyway-migration-writing`, `j.kotlin-domain-model-writing` e `j.python-runtime-validation-writing`
- **Workspace** (`.opencode/skills/`): `j.agents-md-writing`, `j.domain-doc-writing`, `j.principle-doc-writing`, `j.planning-artifact-writing`, `j.shell-script-writing`, `j.auto-improve`, `j.frontend-test-writing`, `j.python-test-writing`, `skill-creator`

> A tool nativa `skill` do opencode (modelo *pull*, o agente decide carregar) só enxerga `.opencode/skills/`. As skills do contexto são garantidas pelo plugin `j.skill-inject` (modelo *push*, por pattern). Os dois mecanismos coexistem. `bun run skills:list` mostra as duas camadas.

### Shell helpers (`.opencode/scripts/`)

Os scripts operam em **qualquer** write target sem que o agente saiba a stack:

- **`_resolve-repo.sh`** — `resolve_repo "$@"` aceita `--repo <path>` ou `--target <project>`; sem args, usa o write target do `active-plan.json`. Exporta `WORKSPACE_ROOT`/`TARGET_REPO_ROOT`/`ROOT_DIR`. Se o target for o próprio workspace, exige `ALLOW_WORKSPACE_GIT=1` (proteção contra commit acidental no harness).
- **`_read-config.sh`** — `config_get_workflow_bool`/`config_get_workflow_string` com dotted-path sob `workflow.*` + default obrigatório. Tenta `node` → `bun` → `python3`; falha silenciosa devolve o default.
- **`_detect-stack.sh`** — `detect_stack` ecoa `maven|terraform|node|unknown` por FS markers (`pom.xml`/`mvnw` → `*.tf` → `package.json`). Também: `maven_runner`, `pom_has_plugin`, `maven_has_dependencies_target`, `maven_has_integration_tests`, `maven_compose_running`, `maven_dependencies_required`, `maven_check_java_version`. Override: `JUNINHO_FORCE_STACK=maven|node|terraform|unknown`.

Usam os três: `lint-structure.sh`, `test-related.sh`, `build-verify.sh`, `run-test-scope.sh`, `pre-commit.sh`, `check-all.sh`. Adicionar stack nova = estender `detect_stack` + um `case` em cada script. O `harness-feature-integration.sh --all-targets <ensure|switch|cleanup>` roda a mesma ação de branch em todos os write targets.

---

## Notas de design (por que é assim)

- **Determinismo sobre estocasticidade.** Cada decisão vive num agente isolado com contrato escrito, gates automatizados e estado persistido. A terminação do loop é por **sensor** (arquivo em disco), nunca por "confiança do modelo": ou o check fica verde e o unify conclui, ou escala para humano com a evidência (`check-review.md` + `check-all-output.txt`). O loop nunca contorna gates — só reentra nos mesmos comandos que você rodaria.
- **Proteção da janela de contexto.** Child session começa limpa; o orchestrator não acumula leitura por task. Os plugins re-injetam só o necessário e sobrevivem a compactação.
- **Task-local correction.** Com `autoImprove`, uma task só fica `COMPLETE` após auditoria; desvios encontrados antes disso voltam à mesma task e entram via amend. Achados posteriores de `/j.check` continuam forward-only.
- **Multi-projeto nativo.** Um `plan.md` unificado cobre N write targets + M referências, com estado centralizado e `feature/{slug}` consistente em cada repo.
- **Skills como documentação executável.** Em vez de doc que ninguém lê, a skill é injetada no instante em que o agente toca o arquivo daquele pattern.
- **Push + pull nas skills.** O opencode ≥1.17 tem skills nativas (pull, por descrição). O harness mantém o `j.skill-inject` como enforcement push por pattern — a skill certa chega sem depender do agente decidir carregá-la.
- **`projectType` foi removido do config.** Nenhum script usa: a stack é sempre detectada por FS markers.
