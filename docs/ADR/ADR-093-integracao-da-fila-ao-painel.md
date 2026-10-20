# ADR-093 - Integracao da fila ao painel

Data: 20/10/2026. Estado: integracao implementada; reservas reais nao ativadas.

## Objetivo

Conectar capitulos preparados, fila persistente e planejador da ADR-091 ao painel,
sem gerar videos, consultar provedores ou reservar credito durante uma leitura.

## Contexto

A ADR-092 ja persiste fila/cursor e reserva um capitulo atomicamente. Faltava um
chamador com dados autorizados e uma tela para a pessoa acompanhar as esperas.
Recriar planejamento, saldo ou dispatcher seria redundante e aumentaria o risco.

## Solucao

`studio_video_queue_snapshot` e uma RPC privada com verificacao de membro. Le
capitulos `fiction.animation`, hashes congelados, aprovacao atual do anterior,
trabalhos ativos da serie e reservas da carteira fisica em todos os workspaces.
Nao retorna episodios ou homologacoes de outros workspaces. Reutiliza observacoes
financeiras Modal e `studio_modal_eligible`; nao inventa cotacoes para outras fontes.

O adaptador do servidor chama `planProductionQueue` usando o relogio do banco.
A identidade interna de cada oferta e a carteira, pois varias carteiras podem
usar o mesmo contrato Modal; nada muda os IDs de provedores nos jobs existentes.
Cada capitulo e cotado numa unica oferta. Carteiras incertas ficam indisponiveis.
A previsao desconta reservas globais e margem, preservando unidades independentes.

A rota `/api/stories/queue` exige sessao verificada. O GET devolve somente resumo,
sem planos, prompts, caminhos, hashes de midia ou cotacoes privadas. O POST aceita
apenas cadastro/cancelamento estritos, verifica origem e deriva workspace/ator da
sessao; perfil e episodio sao conferidos pelo snapshot e pelo banco. Nao aceita
um plano financeiro do navegador e nao expoe comando de reserva ou despacho.

A tela de pautas mostra ordem, estimativa, fonte e esperas, com refresh, cadastro
idempotente e cancelamento sujeito a revisao. Recarregar preserva a fila do banco.
Falhas de leitura sao explicitas; nao parecem fila vazia. O componente Auray com
alteracoes pendentes nao foi modificado nem incluido nesta entrega.

## Prevencao

Testes unitarios cobrem planejamento real, sigilo, saldo, revisao, dados invalidos,
relogio e comandos recusados. SQL transacional cobre snapshot por workspace,
cotacoes, cadastro sem reserva e carteira compartilhada em conciliacao. Playwright
exercita autenticacao, origem, rejeicao de planos, cadastro, recarga, cancelamento,
falha explicita e screenshots desktop/mobile em backend sem saida externa.

CI inclui a suite SQL e verifica permissoes da RPC. A migracao e somente aditiva:
nao modifica flags, jobs existentes, fontes, revisoes ou publicacoes.

## Limites

`reservation_enabled` continua falso. O novo painel nao possui botao para ativar
reservas, enviar video ou disparar o executor legado. Esta entrega nao ativa GPU,
nao repete LTX/CNAPS e nao conecta contratos nativos Puter/Auray a um plano generico.
O planejador confirma previsoes, nao homologacao artistica ou cobranca final.

A janela e limitada a 100 capitulos ativos. Ao detectar excedente, a previsao e
suspensa e a tela informa o limite; nao calcula capacidade parcial como total.
Paginacao completa e integracao de contratos nativos ficam para etapa propria.
Depois disso, qualquer execucao real deve usar a reserva atomica existente e
autorizacao explicita, nunca habilitar a fonte como efeito de abrir o painel.