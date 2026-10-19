# ADR-091 - Planejamento de fila e rodizio por carteira

Data: 19/10/2026. Estado: nucleo de planejamento implementado; despacho e painel
nao ativados nesta entrega.

## Objetivo

Ordenar capitulos e propor uma fonte gratuita homologada para cada um, sem
duplicar quota compartilhada, consumir credito ou alterar o padrao da novela.

## Contexto

O roteador existente filtrava disponibilidade, gratuidade, qualidade, perfil e
saldo, mas selecionava sempre a primeira fonte elegivel. O orcamento existente
ja exigia capacidade para o capitulo inteiro. Esses controles sao reutilizados,
nao substituidos por um novo executor ou por novas carteiras.

O rodizio distribui trabalho entre saldos independentes. Nao aumenta a quota de
uma conta HF ao alternar Spaces, nao recupera um envio incerto por outro motor e
nao homologa LTX, Auray, CNAPS ou qualquer outra fonte automaticamente.

## Solucao

`routeVideoShot` aceita um cursor opcional do ultimo grupo de quota usado.
A escolha avanca por carteira, preservando a ordem dos grupos mesmo quando a
carteira anterior esta sem capacidade. Sem cursor valido, conserva a ordem de
elegibilidade anterior. Endpoints da mesma carteira nao ganham lugares extras.

`planProductionQueue`, exportado pelo core, recebe capitulos preparados,
provedores homologados, snapshots financeiros e o cursor. Ordena por prioridade,
data de entrada e ID. Confere identidade da serie, numero de capitulo, perfil
unico, tomadas distintas e dependencia editorial antes de propor trabalho.

Cada capitulo e orcado integralmente numa unica fonte compativel. Se nenhuma
fonte isolada o comportar, aguarda; nao mistura motores dentro do capitulo nem
consome saldo simulado de um plano parcial. Outras novelas independentes podem
continuar. Valores de carteiras diferentes permanecem em suas proprias unidades.
Saldos desconhecidos, vencidos, pagos, promocionais ou nao homologados nao entram.

O retorno distingue:

- `planned`: proposta completa, ainda nao reservada nem enviada;
- `waiting_capacity`: falta fonte/capacidade compativel;
- `waiting_review`: falta aprovacao do anterior ou revisao da midia concluida;
- `waiting_previous_chapter`: existe capitulo anterior ou tentativa ativa da serie;
- `reconciliation_required`: o envio foi aceito ou seu resultado e incerto.

Envios aceitos/incertos pausam sua carteira fisica, incluindo aliases. Uma recusa
confirmada antes do aceite pode considerar outra carteira homologada, mas nao
outro endpoint da mesma conta nem uma fonte diferente da fixada pelo usuario.
Continuacoes nao podem furar a aprovacao humana por terem prioridade maior.

O retorno inclui alocacoes, saldo simulado por carteira e
`proposed_after_quota_group`, com `estimate=true` e `dispatch_enabled=false`.
Nao modifica os argumentos, arquivos, banco, jobs, quotas ou configuracoes.

## Prevencao

Testes verificam rodizio entre contas, aliases, carteira anterior indisponivel,
reservas, unidades independentes, custo do capitulo inteiro, saldo insuficiente,
prioridade, revisao humana, fonte fixada, recusa, envio incerto, dados duplicados,
perfil trocado e imutabilidade das entradas. Os chamadores anteriores continuam
usando a assinatura de tres argumentos do roteador.

## Integracao Restante

Este nucleo nao e uma fila persistida nem uma nova tela operacional. Os
consumidores devem fornecer dados autorizados do workspace e fontes realmente
homologadas. Os contratos nativos de cada motor continuam independentes.

Antes de despacho real, o servidor deve persistir a decisao e o cursor SOMENTE
apos uma reserva atomica, revalidando saldo, perfil, revisao, concorrencia e
versao dos dados. Duas leituras do mesmo plano nao representam duas reservas.
O painel deve consultar esse estado confirmado e mostrar os motivos de espera.
Nenhuma geracao ou publicacao foi necessaria para implementar esta etapa.