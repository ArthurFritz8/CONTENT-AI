# ADR-090 - Recibo Gradio ausente nao confirma falha do modelo

Data: 19/10/2026. Complementa e corrige o diagnostico da ADR-089.

## Objetivo

Separar a perda de um recibo de uma resposta de processamento sem arquivo,
preservando o envio original e impedindo duplicacao ou fallback indevido.

## Contexto

A unica submissao LTX foi aceita e a primeira leitura gerou `contract_changed`.
A retomada foi classificada pelo cliente como `generation_failed` porque todo
`event:error` nao reconhecido recebia essa categoria. O detalhe original nao foi
preservado; nao e possivel reconstruir sua causa a partir do checkpoint.

Na investigacao de leitura, o evento existente respondeu erro de recibo ausente.
Os logs de runtime do Space retornaram HTTP 403. Nao houve nova geracao, upload,
reinicio do Space, mensagem ao mantenedor, troca de conta ou alteracao da quota.

O codigo oficial do Gradio 6.9.0 confirma que `simple_predict_get` usa
`event:error` tanto para falhas de processamento quanto para erros de transporte
e sessao. `queue_data_helper` pode emitir uma excecao 404 pelo mesmo canal.
Logo, esse envelope nao prova que a inferencia falhou.

## Solucao

O parser reconhece somente mensagens padronizadas completas de recibo ausente,
como `404: Not Found`, e retorna `receipt_unavailable`. Nao classifica uma frase
arbitraria contendo essas palavras como prova. Uma saida completa `[null,seed]`
permanece `generation_failed`; quota e autenticacao mantem suas categorias.

Os erros carregam apenas diagnosticos enumerados: `receipt_missing`,
`empty_result`, `unexpected_payload`, `output_url_rejected` ou `provider_error`.
O log local registra a categoria, nunca a resposta bruta, prompt, URL privada
ou dados do servidor. Recibo ausente sinaliza `reconciliation_required=true` e
`new_submission_allowed=false`. A retomada continua sendo leitura do mesmo ID.

O checkpoint LTX existente nao e apagado, desbloqueado ou reescrito para fingir
um novo estado remoto. Seu codigo historico `generation_failed` documenta a
classificacao antiga; esta ADR registra a evidencia posterior e sua incerteza.
Nem o resultado original nem o consumo de GPU foram esclarecidos. A fonte nao
foi homologada, nao entrou na galeria e nao recebeu uma tentativa substituta.

## Prevencao

Testes reproduzem SSE fragmentado, recibos ausentes, resultado nulo, JSON
incompativel, URL externa recusada e erros privados. Uma leitura de evento
aceito usa um unico GET; resultado aceito ou desconhecido continua impedindo
fallback. A classificacao corrigida foi verificada por leitura do MESMO evento
real, sem modificar seu checkpoint.

Fonte: [Gradio 6.9.0 routes.py](https://github.com/gradio-app/gradio/blob/gradio%406.9.0/gradio/routes.py).
As limitacoes de acesso a logs de terceiros permanecem; nao autorizar nova
inferencia ou concluir causa de falha sem evidencia e autorizacao apropriadas.