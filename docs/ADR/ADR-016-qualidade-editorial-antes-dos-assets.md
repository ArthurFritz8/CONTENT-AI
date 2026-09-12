# ADR-016 — Qualidade editorial antes de consumir imagens e áudio

## Objetivo

Implementar o QA determinístico previsto nos ADR-007/008/015 enquanto o operador configura o Supabase. Impedir gasto com roteiros que violam regras verificáveis, sem nova infraestrutura, API, dependência, estado ou migration.

## Contexto

O contrato Zod já valida a estrutura do roteiro; não será duplicado nem substituído. `system_config.fact_check` já contém os padrões bloqueados, mas nenhum worker os aplicava. Um JSON estruturalmente válido podia introduzir fontes alheias à pesquisa, narração divergente ou disclosure ausente do áudio. `qa_score` e os eventos `qa_passed`/`qa_failed` existem no banco, mas não comprovam qualidade factual por si.

Foram revisitados schemas, prompts, hash editorial, handlers de research/script/assets, logger, leases, seed, testes, ADRs e plano. O gerador de research ainda não persiste grounding metadata: esta entrega não resolve essa lacuna nem certifica veracidade por comparação de strings.

## Solução

1. **Validador compartilhado** `packages/core/src/validators/script-quality.ts`, posterior ao Zod. Verifica concatenação da narração por `order`, pares `claim/source_url` copiados da pesquisa, protocolo web sem credenciais, flags comerciais, disclosure literal no CTA e nas duas descrições, destaques presentes na narração e padrões em textos públicos. Não descarta query/fragmentos para comparar URLs. Normalização NFC e whitespace não alteram a afirmação.
2. **Política obrigatória** lida de `system_config.fact_check`, com validação antes de chamar Gemini. `require_source_per_claim` deve continuar `true`. Configuração ausente, vazia ou inválida gera `QA_CONFIG_INVALID`, sem gasto nem avanço. `risk_level` e `allowed_categories` existentes continuam orientações editoriais; não são classificadores semânticos implementados por esta entrega.
3. **Emenda ao ADR-007:** padrões aceitam frases literais e boundaries opcionais `\m`/`\M`, em vez de regex arbitrária executável. A definição de início/fim de palavra vem da [documentação PostgreSQL](https://www.postgresql.org/docs/17/functions-matching.html#POSIX-CONSTRAINT-ESCAPES-TABLE); a implementação usa letras/números Unicode e underscore. A comparação ignora caixa/acentos, por decisão editorial. Expressões fora dessa gramática falham explicitamente; não são ignoradas. Evita regex com custo explosivo no runtime Edge. O seed existente é compatível.
4. **Repair limitado:** `generate-script` executa QA após parse. Usa a única tentativa de repair já existente, com erros e pesquisa original no prompt; não refaz grounding. O JSON parseável completo é mantido no repair para não truncar cenas. Reprovação persistente gera `failed`, razão `script_quality_failed`, origem `research`. Erro puramente estrutural mantém a razão existente. A promoção usa comparação do estado e confirma a linha atualizada; resultado vazio não retorna sucesso falso.
5. **Auditoria obrigatória:** eventos existentes `qa_passed`/`qa_failed`, com `scope=script_deterministic`, relatório versionado, hash do roteiro, hash da política, etapa e tentativa. Falha de persistência bloqueia avanço; logger diagnóstico continua best-effort. Sucesso também salva `metadata.script_qa` junto ao roteiro. O evento prova as checagens daquela versão, não aprovação de publicação ou conclusão da transição. Não preenche `qa_score`.
6. **Revalidação antes de assets:** cada invocação usa roteiro, pesquisa e política atuais, sem confiar em relatório anterior. Reprovação registra evento e interrompe antes de buscar/gerar assets; origem do `failed` é `script`. Pesquisa ausente é erro explícito. Configuração inválida ou falha de banco preserva estado/checkpoints para nova tentativa. Retomadas válidas não repetem eventos de QA aprovado a cada cena.
7. **Limite explícito:** todo relatório traz `factual_verification=requires_human_review`. Não há score de verdade, comparação semântica, prova de que todas as frases narradas possuem suporte, inspeção real da página, avaliação de licenças ou QA audiovisual. Mesmo com correspondência de fontes, a pesquisa pode estar errada. A revisão humana e o trabalho de grounding continuam necessários.

### Impacto e reversibilidade

- `generate-script/index.ts` passa a ser entrypoint fino; implementação existente extraída para `handler.ts` para testes HTTP sem iniciar servidor. Não há segundo gerador.
- Roteiros antigos que violam as novas regras serão bloqueados antes de assets. Corrigir conteúdo/pesquisa e voltar ao estado de origem; nunca fabricar um relatório aprovado para liberar o episódio.
- Sem alteração de schema, seed ou máquina de estados. `metadata.script_qa` é evidência de geração; pode ficar obsoleta após edição e não é autorização. Publishers futuros precisam de validação própria vinculada ao render exato.
- Configs customizadas com regex fora da gramática devem ser convertidas em frases explícitas. A política não pode ser desligada com `require_source_per_claim=false`.
- Reversão: pausar `pipeline.enabled`, reimplantar o commit anterior e manter dados/eventos. Isso remove a proteção nova, portanto não habilitar publicação durante rollback.

## Prevenção

- Testes unitários de coerência, evidência inventada/alterada, URLs, Unicode, boundaries, padrões inválidos, disclosure e destaques.
- Integrações HTTP simuladas exercitam repair, limite de tentativas, orçamento reservado, gravação obrigatória, concorrência na promoção, edição anterior a assets e configuração inválida.
- Teste existente de checkpoints de áudio/legendas continua usando o handler real e agora passa também pelo QA.
- Fixture de roteiro extraída de arquivo de testes: importá-la não registra novamente a suíte de schema. A redução de testes duplicados não representa perda de cobertura.
- CI mantém typecheck Node/Deno, suites de core/renderer/Edge, PostgreSQL com concorrência, render FFmpeg real e síntese Piper. Cloud, grounding e aprovação humana exigem validação própria.
