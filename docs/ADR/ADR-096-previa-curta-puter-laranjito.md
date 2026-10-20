# ADR-096 - Previa curta Puter de Laranjito

Data: 20/10/2026. Estado: previa gerada; revisao humana pendente.

## Objetivo

Atender ao pedido explicito de gerar algo menor que o piloto de quinze segundos,
sem liberar o capitulo completo nem contornar o orcamento integral da novela.

## Contexto

O saldo gratuito nao comportava os 990 creditos estimados para tres tomadas.
O usuario autorizou uma geracao menor. O contrato existente aceita tomadas de
cinco segundos com estimativa conservadora de 330 creditos, nao uma cotacao.
A previa antiga de Malu ja estava concluida e seu checkpoint foi preservado.

## Solucao

Executada uma unica previa independente de Laranjito, no mesmo modelo Puter,
720x1280, 30 FPS, com imagem aprovada e fala solicitada "A outra passagem e sua."
Nao e capitulo completo, fallback de motor ou homologacao de continuidade.

Reutilizado `PuterVideoProvider`: inspecao da conta gratuita, ausencia de
assinatura/cartao/addons, contrato fixado e saldo suficiente para uma tomada.
A conta ficou protegida por lease durante a operacao. Intencao persistida antes
do POST; contador de rede limitado a uma geracao. Resposta incerta nao autorizaria
uma nova submissao. Coleta usou o arquivo privado deterministico, nao URL externa.

O original e o checkpoint ficaram somente na pasta ignorada
`output/puter-laranjito-short-preview-20261020/`. Nenhuma credencial, identificador
de conta ou URL privada foi versionado. A copia remota nao foi removida.

## Evidencias

- Uma submissao; MP4 original recolhido com 6.007.767 bytes.
- SHA256: `9ad45f7974a56ee2b182c1a5e92cc2ab842fe36bd48b0d77b508a9a029093457`.
- FFprobe: H.264, 720x1280, 30 FPS, 150 quadros, video de 5 segundos.
- Audio AAC presente; conteiner de aproximadamente 5,038 segundos.
- Decodificacao de video e audio completa, sem erro. Original nao recodificado.
- Saldo observado: 677,058148 antes e 357,054544 creditos depois.
- Debito observado do pool: aproximadamente 320,003605 creditos; nao e cotacao.
- Conta sem lease/hold restante. Capitulo completo permanece planning_only,
  sem run nativo e sem jobs novos de producao.

## Prevencao

Sete testes existentes do adaptador passaram antes da operacao. Checkpoint novo
recusa resubmissao; testes antigos e arquivos de Malu, LTX e CNAPS nao mudaram.
Foi gerada apenas uma folha de quadros auxiliar. Quadros amostrados mostram
expressao e movimento; isso nao comprova fala exata, lip-sync ou qualidade final.
Nada foi publicado, aprovado artisticamente ou adicionado a galeria homologada.
Outra geracao ou publicacao exige autorizacao propria.