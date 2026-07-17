# 0001 — remove-graphify

## Change contract

- surface: subsistema `graphify` inteiro (skills `graphify` + `j.graphify-usage`, plugins `j.graphify-inject` + `j.graphify-stale-warn`, `scripts/graphify-build.sh`, CLIs `graphify-build.ts` + `graphify-status.ts`, bloco `workflow.graphify` + `workflow.unify.refreshGraphify`, `getGraphifyPath`, e as menções nos prompts/docs)

- failure_mechanism: a camada foi projetada como *hint opcional*, mas nenhuma das pontas fecha o circuito — os agentes instruídos a rodar o CLI não têm bash, o gate de injeção exige um artefato que nenhum comando produz, e o único aviso que dispara é sobre a ausência do próprio artefato. O subsistema não podia produzir valor nem em teoria; o custo era 100% fixo (prompt + manutenção) e o retorno, estruturalmente zero.

- evidence:
  - **Zero artefatos em 2,5 meses**, em qualquer repo do workspace. O único `GRAPH_REPORT.md` que existiu (commit `89da4ce`, 30/04) morreu em branch abandonada e nunca chegou na `main`.
  - **Agentes sem bash instruídos a rodar CLI**: `j.explore`, `j.reviewer` e `j.librarian` declaram `bash: false` no frontmatter e mesmo assim mandavam usar `graphify query` / `graphify explain`. `j.explore` chegava a anunciar "optional Graphify CLI tools" na própria descrição de tools.
  - **`graphify-build.sh --incremental` é no-op**: os dois ramos do `if` são byte-idênticos.
  - **`graphify update` sempre sai 1** por bug upstream (`NameError`), mascarado com `|| true` — falha silenciosa por construção.
  - **`j.graphify-inject` NUNCA injeta**: o gate exige um `GRAPH_REPORT.md` que nenhum fluxo produz. **`j.graphify-stale-warn` SEMPRE emite ruído** sobre o artefato ausente. Os dois plugins, juntos, só sabiam reclamar do vazio.
  - **Skill vendored de 1297 linhas, ~70% Whisper/Obsidian/Neo4j** — conteúdo irrelevante ao harness; precisou de exemption no teste estrutural para não reprovar.
  - **Sinal ruim mesmo quando roda**: nos `.kt` reais, 3 dos 4 "god nodes" apontados eram classes de teste.
  - **Custo**: 1761 linhas + 52 linhas de prompt distribuídas em 8 agentes/comandos.

- expected_effect: nenhuma mudança de comportamento observável nos fluxos reais (o subsistema nunca executou com efeito). O que muda: `j.graphify-stale-warn` para de emitir ruído sobre artefato ausente; 8 prompts perdem 52 linhas de instrução inexecutável (incluindo instruções contraditórias de CLI para agentes sem bash); `workflow.graphify` e `workflow.unify.refreshGraphify` passam a ser chaves desconhecidas e o `config:validate` reprova quem as deixar no `juninho-config.json`.

- preserved_invariants:
  - Frases pinadas por testes estruturais intactas: `Reentry Contract`, `Artifact Contract`, `follow-up task`, `pass only the user's`, `already the worker`, `python3 scripts/`.
  - `/j.unify`: a ordem dos steps e o contrato de **um único commit doc-sync** seguem iguais — só sai o Step 5.25 e a entrada `docs/domain/graphify/**` do allowlist (o `docs/**` já a cobria).
  - `/j.finish-setup`: Phase 7 era a última fase; steps terminam em 20, sem renumeração de fases.
  - `j.reviewer`: lista renumerada 6–11 → 5–10; as três passes de review preservadas.
  - `j.implementer`: READ step 12 → 11; regra de task boundary preservada.
  - `commandPath` em `setup-guide.ts` preservado (ainda usado por opencode/detekt).
  - `DEFAULT_ENTRIES` em `j.skill-map.ts` nunca citou graphify — nada a remover.

- falsifying_eval: a suíte determinística completa (`TMPDIR=~/repos/tmp npm run eval`) é o gate. Ela cobre estrutura do harness, contrato dos plugins e resolução de skill-map — uma remoção que quebrasse import, skill-map ou prompt pinado reprovaria. Falsificador direto e barato: `grep -rn -i graphify` no harness deve dar zero (exceto este registro e os reports históricos de eval), e `bun run config:validate` deve reprovar um `juninho-config.json` que ainda declare `workflow.graphify`.

- rollback: `git revert` do commit desta remoção. O CLI **segue instalado** e independente do harness (`~/.local/share/uv/tools/graphifyy`, binário em `~/.local/bin/graphify`) — quem quiser continua rodando `graphify query|path|explain` à mão, sem nada disto de volta. Reverter só faz sentido junto com uma correção dos mecanismos acima (agentes com bash, gate que dispara, `--incremental` de verdade), não como restauração pura.

## Evals

- full suite: PASS (66/66, 0 fail, 425 expect calls, 4 arquivos)
- `bun run sync` · `bun run config:validate` · `bun run setup`: PASS (único pendente do setup é `rules.jar`/CLI detekt do contexto olxbr — pré-existente, sem relação)
- import-check dos 14 plugins restantes: PASS
- impact: superfície inclui plugins/CLI/skill-map → suíte completa exigida e rodada

## Decision

- APPLIED — decisão tomada por kleber em 2026-07-17, executada sob auditoria com evidência.
