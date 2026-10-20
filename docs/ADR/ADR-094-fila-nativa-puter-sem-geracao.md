# ADR-094 - Fila nativa Puter sem geracao

Data: 20/10/2026. Estado: integracao de planejamento; nenhuma reserva ou geracao
ativada por esta entrega.

## Objetivo

Mostrar e persistir capitulos nativos Puter na fila, conferindo perfil aprovado,
continuidade, saldo e orcamento integral sem consumir creditos.

## Contexto

O fluxo Puter usa tres tomadas nativas de cinco segundos, audio do provedor e
perfil proprio de 720x1280/30 FPS. A fila generica usa tomadas com audio externo
e outro contrato. Converter um no outro violaria o padrao aprovado da novela.
O projeto ja possui contas privadas, hold fisico e `puterBudget`; nao precisamos
de outro ledger financeiro, outra cotacao ou outro executor.

## Solucao

`studio_puter_queue` registra somente espera, perfil e fingerprint congelados,
com prioridade, revisao e request idempotente. Nao referencia credenciais nem
cria holds. O mesmo endpoint de cadastro/cancelamento decide o contrato no
servidor; membro/workspace continuam derivados da sessao. Chaves de request sao
serializadas e nao podem ser reaproveitadas entre as duas filas.

`studio_puter_queue_snapshot` verifica a preparacao existente, perfil Puter,
exemplo revisado, estilo e aceite de variantes de voz, alem da aprovacao atual
do capitulo anterior. Nao altera imagens, vozes ou estilo. Fingerprint alterado,
cancelamento, trabalho ativo ou incerto ficam explicitos e nao sao reenviados.
Le apenas `studio_puter_view`, sem Vault, token, contato com API ou consulta nova.

O servidor reutiliza `puterBudget` e o contrato vigente: 990 creditos estimados
para tres tomadas. Trata isso como estimativa empirica conservadora, nao cotacao
do provedor ou certificacao artistica. Verifica saldo observado ha ate dois
minutos, gratuidade e ocupacao/hold global da conta, inclusive outros workspaces.
Cada capitulo cabe em uma conta inteira. Nao soma duas contas insuficientes nem
mistura Puter com Modal/Auray. Saldo simulado so e descontado de entradas pendentes;
capitulos preparados fora da fila nao inflam a capacidade confirmada.

A tela apresenta Puter separadamente, valor disponivel, estimativa e esperas por
saldo, conexao, gratuidade, revisao ou conciliacao. Perfil, draft, fingerprint,
conta privada e checkpoints nunca vao para o navegador. Cadastro e cancelamento
continuam estritos e protegidos por origem, sessao, CAS e isolamento no banco.

## Prevencao

Testes cobrem saldo de 677,7 insuficiente para 990, independencia de contas,
ocupacao/hold, saldo vencido, gratuidade, perfil nao revisado, revisao humana,
simulacao sem mutacao, chave reaproveitada, cadastro idempotente e cancelamento
antes de run. A suite SQL nativa existente foi estendida, sem duplicar fixtures.
Depois de existir um run, cancelar a entrada nao pode liberar o hold nativo.
Playwright testa cadastro, recarga, orcamento separado, cancelamento e layout
desktop/mobile num backend que recusa geracao e trafego externo nao previsto.

RLS e permissoes das tabelas/RPCs e wrappers legados sao gates estruturais.
A migracao nao modifica flags, cursor de rodizio, credito observado, jobs,
fontes, scheduler ou publicacoes. Auray e suas alteracoes locais ficam intocadas.

## Limites

Este e planejamento: nao liga a fila ao worker Puter nem muda o executor legado.
Cancelar a entrada remove a espera, nao cancela preparacao ou runner legado;
trabalho ja aceito continua sob o fluxo nativo de conciliacao. A fila nao e uma
trava global de todos os fluxos preexistentes. Nao habilitar flags nem usar um
episodio real para testar reserva como efeito desta entrega.

A previsao conjunta segue a janela maxima de 100 entradas; excedente suspende
a estimativa. O Puter permanece na propria fonte e nao participa de troca para
outro motor. So tres tomadas sao elegiveis neste contrato. Piloto completo,
homologacao artistica e execucao real precisam de autorizacao propria e saldo
gratuito suficiente. Nenhuma nova tentativa LTX/CNAPS e permitida por esta ADR.