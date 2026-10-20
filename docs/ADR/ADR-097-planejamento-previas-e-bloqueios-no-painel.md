# ADR-097 - Planejamento, previas e bloqueios no painel

Data: 20/10/2026. Estado: consolidacao do painel sem geracao.

## Objetivo

Separar planejamento de geracao real nos contadores e controles, integrar a
previa aprovada de Laranjito a galeria privada e apresentar pendencias juntas.

## Contexto

O piloto planning_only era corretamente recusado pelo executor, mas contava como
geracao ativa e cota diaria consumida. O cartao antigo mostrava awaiting_capacity
e oferecia retomada. A previa aprovada existia somente no arquivo local. Isso
confundia o usuario apesar das travas financeiras corretas.

## Solucao

`studio_episode_planning_only` reconhece somente preparacao marcada, ainda em
research, sem render e sem run/job real. `studio_generation_counts` separa
planejamento de geracoes. A visao de historias, a visao geral e a admissao manual
usam os mesmos contadores. Uma execucao real continua consumindo atividade/cota;
marcar planejamento nao oculta jobs existentes. Limites de pautas e outras
politicas editoriais permanecem. Nenhuma flag de fonte/pipeline foi alterada.

O wrapper de progresso rotula planning_only explicitamente. Os cartoes nao
oferecem retomar/encerrar execucao para esse estado. A fila apresenta pendencias
simultaneas, como trava de planejamento, saldo vencido e revisao anterior,
sem fingir que remover uma delas resolve todas as outras.

A previa existente e importada pelo comando ja usado pelo projeto, com metadados
versionados e hash. Upload privado e conferido por leitura antes do ready. A
opcao explicita `--approve` registra membro, hash, data e escopo sample_only numa
tabela privada imutavel. A aprovacao veio do usuario nesta conversa; nao e
aprovacao de capitulo completo, identidade vocal entre cenas ou publicacao.

A galeria existente e reutilizada. A secao "Previas aprovadas" usa o player
autenticado ja existente, sem URL publica nem link assinado exposto. O arquivo
original nao muda e nao e commitado. A aprovacao e limitada aos mesmos bytes.

## Prevencao

SQL prova contadores zerados para planejamento, cota disponivel, admissao manual
real permitida, execucao real contada e progresso com rotulo correto. Aprovacao
testa ready, hash, membro, idempotencia, imutabilidade e permissao privada.

Playwright confere ausencia de retomada, pendencias, player privado com no-store,
escopo de aprovacao e screenshots desktop/mobile. Testes de galeria anteriores
sao preservados. CI inclui a nova suite SQL e typecheck do importador.

Alteracoes Auray/ADR-088 preexistentes continuam fora da entrega, inclusive os
hunks no mesmo componente. Nao houve geracao, nova consulta ao Puter, liberacao
do piloto ou publicacao em plataformas sociais nesta consolidacao.

## Limites

A previa nao constitui capitulo completo ou nova fonte de rodizio. O piloto
permanece bloqueado, sem reserva. Contratos nativos e limites financeiros nao
sao substituidos pelos contadores de interface. Este ajuste de admissao cobre
o fluxo manual comum; os limites legados de automacao e publicacao nao foram
relaxados. A execucao real da fila continua dependendo de autorizacao propria.