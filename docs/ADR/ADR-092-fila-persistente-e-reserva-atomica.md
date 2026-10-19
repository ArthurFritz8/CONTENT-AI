# ADR-092 - Fila persistente e reserva atomica

Data: 19/10/2026. Estado: backend implementado; reserva desativada por padrao.

## Objetivo

Persistir capitulos e o cursor do rodizio, reservando o capitulo inteiro no banco
sem duplicar saldo ou perder consistencia entre requisicoes concorrentes.

## Contexto

O planejador da ADR-091 simula escolhas; nao autoriza gastos. O banco ja tem
carteiras fisicas, homologacao por serie/perfil/execucao e uma reserva completa
com bloqueio de saldo compartilhado. Recriar esse controle seria redundante.

## Analise Critica

Concordamos com persistir antes de conectar painel e despacho. Vetamos ledger
paralelo, reserva parcial e ativacao de fontes para testar a infraestrutura.
Reaproveitamos `studio_reserve_video`, incluindo seus wrappers de roteiro,
perfil, fonte fixada, montagem integral e evidencias financeiras.

## Solucao

A migration `20261019020000_video_queue_reservations.sql` cria fila por episodio
e cursor por workspace. Cadastro tem chave idempotente e congela hashes de
roteiro e perfil. Cancelamento so vale antes de reservar; nao libera jobs.

`studio_video_queue_reserve` confere revisoes da entrada e do cursor, membro,
episodio, perfil atual, capitulo anterior aprovado e sem aprovacao obsoleta.
Bloqueia o episodio anterior durante a conferencia, exige uma unica carteira,
fonte e execucao para o capitulo, e pausa carteiras com envios em conciliacao.
Entao chama a reserva existente. Jobs, entrada e cursor confirmam na mesma
transacao. Recusa ou rollback nao avanca o rodizio. Replay devolve os mesmos
jobs sem reservar novamente. A carteira fisica e compartilhada entre workspaces.

`studio_video_queue_view` retorna ate 100 entradas do workspace com motivos
controlados, sem roteiros, planos, credenciais, URLs ou IDs de jobs externos.
Todas as tabelas tem RLS e as quatro RPCs sao exclusivas de `service_role`, com
verificacao de membro. O chamador futuro deve usar a sessao verificada, jamais
repassar identidade/workspace fornecidos livremente pelo navegador.

`video_queue.reservation_enabled=false` nasce por padrao e nenhuma configuracao
existente e substituida. Nao existe novo scheduler, botao ou despacho desta fila.
O campo `dispatch_enabled=false` identifica a ausencia desse novo despachante,
nao desliga o executor legado. **Ativar a reserva cria jobs `queued` normais**,
que podem ser encontrados pelo fluxo de animacao existente. Portanto, nao ativar
essa chave nem reservar episodios reais como smoke test desta entrega.

## Prevencao

Suite transacional cobre cadastro e reserva idempotentes, isolamento, roteiro
alterado, CAS, plano parcial/misto, creditos promocionais, saldo vencido ou
insuficiente, homologacao revogada, conciliacao, cancelamento e revisao humana
atual/obsoleta. A fixture compartilha um capitulo completo de cinco tomadas.

Doze clientes concorrem em dois cenarios: dois workspaces disputam saldo para
um capitulo; um workspace disputa um cursor com saldo para todos. Cada cenario
deve confirmar exatamente um capitulo, cinco jobs, uma requisicao e um avanco
do cursor. A CI executa os cenarios numa copia isolada do PostgreSQL descartavel,
sem GPU ou APIs. As fixtures concorrentes nao alteram a contagem de episodios dos
testes legados de limite diario, que continuam no banco original.
Verificacoes estruturais impedem exposicao de tabelas/RPCs.

## Limites e Proxima Integracao

Esta entrega persiste e confirma uma proposta, mas nao conecta automaticamente
`planProductionQueue` a um scheduler. Prioridade e escolha de rodizio continuam
no planejador, nao sao um claim automatico de proximo trabalho no SQL. A leitura
limitada precisara de paginacao antes de uma tela historica completa.

O cadastro exige `fiction.animation`; contratos nativos Puter/Auray permanecem
fora desta fila ate integracao especifica. Cancelamento e terminal para a entrada
do episodio: nao recria o mesmo episodio nem reenfileira trabalho incerto.

Antes de ativar: alimentar o planejador com dados autorizados e cotacoes atuais,
conectar seu resultado a esta RPC com revisoes, integrar cada contrato nativo,
e apresentar esperas no painel. Nao inferir homologacao, multiplicar cotas HF,
repetir LTX/CNAPS, contornar recusas ou habilitar planos pagos. Nenhuma geracao
ou publicacao e necessaria para validar esta etapa.