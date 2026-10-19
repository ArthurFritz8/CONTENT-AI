# ADR-087 - Diagnostico seguro da conexao Auray

Data: 19/10/2026. Escopo: monitoramento e mensagem de bloqueio, sem geracao.

## Objetivo

Exibir a causa conhecida de uma consulta Auray interrompida, distinguindo acesso
recusado de falta de creditos, sem revelar respostas privadas ou inventar saldo.

## Contexto

O worker agendado consultava o provedor antes de localizar a carteira cadastrada.
Uma recusa nessa consulta impedia adquirir e encerrar o lease do monitor, deixando
o painel sem o diagnostico. A inspecao de leitura em 19/10 encontrou planos e
contrato publicos com HTTP 200 e `/me` autenticado com HTTP 403. Isso comprova
recusa de acesso, nao sua causa exata nem o esgotamento da franquia.

## Solucao

O modo `--connected` localiza primeiro o unico monitor cadastrado. Sem cadastro,
nao consulta a Auray. Com mais de um, exige escolha explicita por `--wallet`;
nao tenta chaves ou contas para descobrir uma correspondencia. O monitor
continua verificando o fingerprint da conta antes de observar saldo ou jobs.

O encerramento grava somente codigos permitidos e a data da tentativa. Falhas
invalidam a atualidade do saldo sem apagar seu ultimo valor. A assinatura antiga
da RPC permanece compativel; uma consulta bem-sucedida limpa o erro anterior.
O painel explica a recusa de acesso e preserva a carteira separada das demais.

Nao existe chamada de geracao, mudanca de plano, troca de chave, liberacao de
carteira ou fallback de motor nesta entrega. Uma falha de acesso exige conferir
a conexao no provedor; alterar o monitor nao restaura permissoes externas.

## Prevencao

Testes do monitor cobrem acesso recusado, chave ausente, contas ambiguas,
fingerprint divergente, erros privados normalizados, saldo zero real e retomada.
Os testes SQL verificam lease, codigos limitados, saldo historico, isolamento e
compatibilidade com chamadas antigas. O navegador verifica a mensagem sem
acessar a Auray ou gerar videos, inclusive em viewport de celular.

A migracao deve preceder a execucao do novo worker. CNAPS permanece na fase
`quota_rejected`: esta entrega nao modifica checkpoints nem reenvia seu teste.